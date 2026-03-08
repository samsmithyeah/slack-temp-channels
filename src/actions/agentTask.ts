import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { planBlocks, textSectionBlocks } from "../agentBlocks";
import { type AgentRefineMetadata, agentRefineModal } from "../modals/agentRefine";
import { type AgentTaskMetadata, agentTaskModal } from "../modals/agentTask";
import { isUserActive, markActive, markInactive } from "../services/activeTaskTracker";
import {
  type AgentPlan,
  type ExecutionResult,
  executePlan,
  generatePlan,
} from "../services/agentPlanner";
import {
  createExecutionId,
  deleteExecution,
  getExecution,
  storeExecution,
} from "../services/executionStore";
import { ApiKeyMissingError, getOpenAIClient } from "../services/openai";
import { createPlanId, deletePlan, getPlan, type PlanData, storePlan } from "../services/planStore";
import type { ActionBody } from "../types";
import { isChannelMember } from "../utils";

const BUSY_TEXT = "You already have an agent task in progress. Please wait for it to finish.";

function resultBlocks(result: ExecutionResult, executionId: string): KnownBlock[] {
  const detailLines = result.details.join("\n");
  const summaryText = result.summary || "Agent task completed.";

  return [
    ...textSectionBlocks(`*Agent task complete*\n\n${summaryText}`),
    ...textSectionBlocks(
      `*Details:* ${result.stepsCompleted} steps completed, ${result.stepsFailed} failed${detailLines ? `\n${detailLines}` : ""}`,
    ),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Post Summary to Channel" },
          style: "primary",
          action_id: "agent_post_summary",
          value: executionId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Skip" },
          action_id: "agent_skip_summary",
          value: executionId,
        },
      ],
    },
  ] as KnownBlock[];
}

function summaryBlocks(summaryText: string, userId: string): KnownBlock[] {
  return [
    ...textSectionBlocks(summaryText),
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `AI agent task triggered by <@${userId}>` }],
    } as unknown as KnownBlock,
  ];
}

const EXPIRED_TEXT = ":warning: This action has expired. Please start a new task.";

/** Try to update the DM message with an expiry notice. */
async function showExpired(
  client: Parameters<typeof executePlan>[1],
  body: unknown,
  logger: { error: (...args: unknown[]) => void },
): Promise<void> {
  const actionBody = body as ActionBody;
  const dmChannelId = actionBody.channel?.id;
  const messageTs = (body as { message?: { ts?: string } }).message?.ts;
  if (!dmChannelId || !messageTs) return;
  try {
    await client.chat.update({
      channel: dmChannelId,
      ts: messageTs,
      text: EXPIRED_TEXT,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: EXPIRED_TEXT } }],
    });
  } catch (error) {
    logger.error("Failed to show expiry notice:", error);
  }
}

// --- Execution helper ---

interface ExecuteAndNotifyParams {
  openai: ReturnType<typeof getOpenAIClient>;
  client: Parameters<typeof executePlan>[1];
  channelId: string;
  plan: AgentPlan;
  taskDescription: string;
  userId: string;
  dmChannelId: string;
  planMessages?: ChatCompletionMessageParam[];
  threadTs?: string;
}

async function executeAndNotify(params: ExecuteAndNotifyParams): Promise<void> {
  const {
    openai,
    client,
    channelId,
    plan,
    taskDescription,
    userId,
    dmChannelId,
    planMessages,
    threadTs,
  } = params;

  const result = await executePlan(
    openai,
    client,
    channelId,
    plan,
    taskDescription,
    planMessages,
    threadTs,
    userId,
  );

  const executionId = createExecutionId();
  storeExecution({
    id: executionId,
    userId,
    channelId,
    summary: result.summary,
    createdAt: Date.now(),
  });

  await client.chat.postMessage({
    channel: dmChannelId,
    text: "Agent task complete",
    blocks: resultBlocks(result, executionId),
  });
}

// --- Registration ---

export function registerAgentTaskHandlers(app: App): void {
  // 1. Button from pinned welcome message (in-channel)
  app.action("agent_task", async ({ ack, body, client, logger }) => {
    const actionBody = body as unknown as ActionBody;
    const channelId = actionBody.channel?.id;
    const userId = actionBody.user?.id;
    // Fire ack without awaiting so views.open gets the trigger_id before it
    // expires (3 s lifetime, socket mode delivery eats into that window).
    ack();
    if (!channelId || !userId) return;

    if (!(await isChannelMember(client, channelId, userId))) return;

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: agentTaskModal(channelId),
      });
    } catch (error) {
      logger.error("Failed to open agent task modal:", error);
    }
  });

  // 2. Button from App Home (regex pattern like other home buttons)
  app.action(/^home_agent_task_/, async ({ ack, body, client, logger }) => {
    const actionBody = body as unknown as ActionBody;
    const action = actionBody.actions?.[0];
    const userId = actionBody.user?.id;
    ack();
    if (action?.type !== "button" || !action?.value || !userId) return;
    const channelId = action.value;

    if (!(await isChannelMember(client, channelId, userId))) return;

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: agentTaskModal(channelId),
      });
    } catch (error) {
      logger.error("Failed to open agent task modal from home:", error);
    }
  });

  // 3. Modal submission — generate plan, then execute or await approval
  app.view("agent_task_submit", async ({ ack, view, body, client, logger }) => {
    await ack();

    const userId = body.user.id;
    const { channelId } = JSON.parse(view.private_metadata) as AgentTaskMetadata;
    const taskDescription = view.state.values.task_description.task_description_input.value!;
    const yoloChecked = view.state.values.yolo_mode?.yolo_mode_input?.selected_options?.length ?? 0;
    const isYolo = yoloChecked > 0;

    if (!(await isChannelMember(client, channelId, userId))) return;

    if (isUserActive(userId)) {
      try {
        const dm = await client.conversations.open({ users: userId });
        if (dm.channel?.id) {
          await client.chat.postMessage({ channel: dm.channel.id, text: BUSY_TEXT });
        }
      } catch {
        // best-effort
      }
      return;
    }

    // Open DM channel with the user
    let dmChannelId: string;
    try {
      const dm = await client.conversations.open({ users: userId });
      if (!dm.channel?.id) {
        logger.error("Failed to open DM: channel ID missing");
        return;
      }
      dmChannelId = dm.channel.id;
    } catch (error) {
      logger.error("Failed to open DM for agent task:", error);
      return;
    }

    // Send initial status message
    let statusMsg: Awaited<ReturnType<typeof client.chat.postMessage>>;
    try {
      statusMsg = await client.chat.postMessage({
        channel: dmChannelId,
        text: ":hourglass_flowing_sand: Generating plan for your task...",
      });
    } catch (error) {
      logger.error("Failed to send status DM:", error);
      return;
    }

    markActive(userId);
    try {
      const planResult = await generatePlan(getOpenAIClient(), client, channelId, taskDescription);
      const { plan, planMessages } = planResult;

      if (isYolo) {
        await client.chat.update({
          channel: dmChannelId,
          ts: statusMsg.ts!,
          text: `Executing plan: ${plan.summary}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:rocket: *YOLO mode* — executing plan immediately\n\n${plan.summary}`,
              },
            },
          ],
        });

        await executeAndNotify({
          openai: getOpenAIClient(),
          client,
          channelId,
          plan,
          taskDescription,
          userId,
          dmChannelId,
          planMessages,
        });
      } else {
        // Store plan and show approval DM
        const planId = createPlanId();
        const planData: PlanData = {
          id: planId,
          userId,
          channelId,
          taskDescription,
          plan,
          planMessages,
          dmChannelId,
          dmMessageTs: statusMsg.ts!,
          createdAt: Date.now(),
        };
        storePlan(planData);

        await client.chat.update({
          channel: dmChannelId,
          ts: statusMsg.ts!,
          text: `Plan: ${plan.summary}`,
          blocks: planBlocks(plan, planId),
        });
      }
    } catch (error) {
      logger.error("Failed to generate/execute agent plan:", error);
      const errorMessage =
        error instanceof ApiKeyMissingError
          ? "OpenAI API key is not configured."
          : `Failed to generate plan: ${error instanceof Error ? error.message : "unknown error"}`;
      try {
        await client.chat.update({
          channel: dmChannelId,
          ts: statusMsg.ts!,
          text: errorMessage,
        });
      } catch (updateError) {
        logger.error("Failed to update DM with error:", updateError);
      }
    } finally {
      markInactive(userId);
    }
  });

  // 4. Accept plan
  app.action("agent_plan_accept", async ({ ack, body, client, logger }) => {
    await ack();
    const actionBody = body as unknown as ActionBody;
    const planId = actionBody.actions?.[0]?.value;
    if (!planId) return;
    const planData = getPlan(planId);
    if (!planData || actionBody.user?.id !== planData.userId) {
      await showExpired(client, body, logger);
      return;
    }

    if (isUserActive(planData.userId)) {
      try {
        await client.chat.postMessage({ channel: planData.dmChannelId, text: BUSY_TEXT });
      } catch {
        // best-effort
      }
      return;
    }

    // Update DM to "executing..."
    try {
      await client.chat.update({
        channel: planData.dmChannelId,
        ts: planData.dmMessageTs,
        text: ":gear: Executing plan...",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: ":gear: Executing plan..." },
          },
        ],
      });
    } catch (error) {
      logger.error("Failed to update DM to executing state:", error);
    }

    markActive(planData.userId);
    try {
      await executeAndNotify({
        openai: getOpenAIClient(),
        client,
        channelId: planData.channelId,
        plan: planData.plan,
        taskDescription: planData.taskDescription,
        userId: planData.userId,
        dmChannelId: planData.dmChannelId,
        planMessages: planData.planMessages,
        threadTs: planData.threadTs,
      });
    } catch (error) {
      logger.error("Agent execution failed:", error);
      const reason = error instanceof Error ? error.message : "unknown error";
      try {
        await client.chat.update({
          channel: planData.dmChannelId,
          ts: planData.dmMessageTs,
          text: `Execution failed: ${reason}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:x: Execution failed: ${reason}. Please try again.`,
              },
            },
          ],
        });
      } catch (updateError) {
        logger.error("Failed to update DM with execution error:", updateError);
      }
    } finally {
      markInactive(planData.userId);
    }

    deletePlan(planId);
  });

  // 5. Decline plan
  app.action("agent_plan_decline", async ({ ack, body, client, logger }) => {
    await ack();
    const actionBody = body as unknown as ActionBody;
    const planId = actionBody.actions?.[0]?.value;
    if (!planId) return;
    const planData = getPlan(planId);
    if (!planData || actionBody.user?.id !== planData.userId) {
      await showExpired(client, body, logger);
      return;
    }

    try {
      await client.chat.update({
        channel: planData.dmChannelId,
        ts: planData.dmMessageTs,
        text: "Plan declined.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":x: Plan declined. No actions were taken.",
            },
          },
        ],
      });
    } catch (error) {
      logger.error("Failed to update DM for declined plan:", error);
    }

    deletePlan(planId);
  });

  // 6. Refine — open modal for refinement instructions
  app.action("agent_plan_refine", async ({ ack, body, client, logger }) => {
    await ack();
    const actionBody = body as unknown as ActionBody;
    const planId = actionBody.actions?.[0]?.value;
    if (!planId) return;
    const planData = getPlan(planId);
    if (!planData || actionBody.user?.id !== planData.userId) {
      await showExpired(client, body, logger);
      return;
    }

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: agentRefineModal(planId),
      });
    } catch (error) {
      logger.error("Failed to open refine modal:", error);
    }
  });

  // 7. Post execution summary to channel
  app.action("agent_post_summary", async ({ ack, body, client, logger }) => {
    await ack();
    const actionBody = body as unknown as ActionBody;
    const executionId = actionBody.actions?.[0]?.value;
    if (!executionId) return;
    const exec = getExecution(executionId);
    if (!exec || actionBody.user?.id !== exec.userId) {
      await showExpired(client, body, logger);
      return;
    }

    try {
      await client.chat.postMessage({
        channel: exec.channelId,
        text: exec.summary,
        blocks: summaryBlocks(exec.summary, exec.userId),
      });
    } catch (error) {
      logger.error("Failed to post summary to channel:", error);
    }

    // Update DM to remove buttons
    const dmChannelId = actionBody.channel?.id;
    const messageTs = (body as unknown as { message?: { ts?: string } }).message?.ts;
    if (dmChannelId && messageTs) {
      try {
        await client.chat.update({
          channel: dmChannelId,
          ts: messageTs,
          text: "Agent task complete — summary posted to channel",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":white_check_mark: Agent task complete — summary posted to channel.",
              },
            },
          ],
        });
      } catch (error) {
        logger.error("Failed to update DM after posting summary:", error);
      }
    }

    deleteExecution(executionId);
  });

  // 8. Skip posting summary
  app.action("agent_skip_summary", async ({ ack, body, client, logger }) => {
    await ack();
    const actionBody = body as unknown as ActionBody;
    const executionId = actionBody.actions?.[0]?.value;
    if (!executionId) return;
    const exec = getExecution(executionId);
    if (!exec || actionBody.user?.id !== exec.userId) {
      await showExpired(client, body, logger);
      return;
    }

    const dmChannelId = actionBody.channel?.id;
    const messageTs = (body as unknown as { message?: { ts?: string } }).message?.ts;
    if (dmChannelId && messageTs) {
      try {
        await client.chat.update({
          channel: dmChannelId,
          ts: messageTs,
          text: "Agent task complete",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":white_check_mark: Agent task complete.",
              },
            },
          ],
        });
      } catch (error) {
        logger.error("Failed to update DM after skipping summary:", error);
      }
    }

    deleteExecution(executionId);
  });

  // 9. Refine submission — re-generate plan, update same DM
  app.view("agent_refine_submit", async ({ ack, view, body, client, logger }) => {
    await ack();

    const { planId } = JSON.parse(view.private_metadata) as AgentRefineMetadata;
    const planData = getPlan(planId);
    if (!planData || body.user.id !== planData.userId) return;

    const refinement = view.state.values.refinement.refinement_input.value!;

    if (isUserActive(planData.userId)) {
      try {
        await client.chat.postMessage({ channel: planData.dmChannelId, text: BUSY_TEXT });
      } catch {
        // best-effort
      }
      return;
    }

    // Update DM to loading state
    try {
      await client.chat.update({
        channel: planData.dmChannelId,
        ts: planData.dmMessageTs,
        text: ":hourglass_flowing_sand: Re-generating plan...",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":hourglass_flowing_sand: Re-generating plan with your feedback...",
            },
          },
        ],
      });
    } catch (error) {
      logger.error("Failed to update DM to loading state:", error);
    }

    markActive(planData.userId);
    try {
      const planResult = await generatePlan(
        getOpenAIClient(),
        client,
        planData.channelId,
        planData.taskDescription,
        refinement,
        planData.threadTs,
      );
      const { plan: newPlan, planMessages: newPlanMessages } = planResult;

      // Update stored plan in place
      planData.plan = newPlan;
      planData.planMessages = newPlanMessages;
      storePlan(planData);

      // Update same DM message with new plan
      await client.chat.update({
        channel: planData.dmChannelId,
        ts: planData.dmMessageTs,
        text: `Revised plan: ${newPlan.summary}`,
        blocks: planBlocks(newPlan, planId),
      });
    } catch (error) {
      logger.error("Failed to refine plan:", error);
      try {
        await client.chat.update({
          channel: planData.dmChannelId,
          ts: planData.dmMessageTs,
          text: "Failed to refine plan. Please try again.",
        });
      } catch (updateError) {
        logger.error("Failed to update DM with refine error:", updateError);
      }
    } finally {
      markInactive(planData.userId);
    }
  });
}
