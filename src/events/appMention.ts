import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { type AgentPlan, generatePlan } from "../services/agentPlanner";
import { ApiKeyMissingError, createOpenAIClient } from "../services/openai";
import { createPlanId, type PlanData, storePlan } from "../services/planStore";
import { isChannelMember } from "../utils";

// --- Block builders (shared with agentTask.ts — duplicated for simplicity) ---

const SLACK_SECTION_CHAR_LIMIT = 3000;

function textSectionBlocks(text: string): KnownBlock[] {
  if (text.length <= SLACK_SECTION_CHAR_LIMIT) {
    return [{ type: "section", text: { type: "mrkdwn", text } }] as KnownBlock[];
  }

  const blocks: KnownBlock[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SLACK_SECTION_CHAR_LIMIT) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: remaining },
      } as unknown as KnownBlock);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", SLACK_SECTION_CHAR_LIMIT);
    if (splitAt <= 0) splitAt = SLACK_SECTION_CHAR_LIMIT;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: remaining.slice(0, splitAt) },
    } as unknown as KnownBlock);
    remaining = remaining.slice(splitAt + 1);
  }
  return blocks;
}

function planBlocks(plan: AgentPlan, planId: string): KnownBlock[] {
  const stepsText = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n");

  return [
    ...textSectionBlocks(`*AI Agent Plan*\n\n${plan.summary}`),
    ...(plan.steps.length > 0 ? textSectionBlocks(`*Steps:*\n${stepsText}`) : []),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Accept" },
          style: "primary",
          action_id: "agent_plan_accept",
          value: planId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Decline" },
          style: "danger",
          action_id: "agent_plan_decline",
          value: planId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Refine" },
          action_id: "agent_plan_refine",
          value: planId,
        },
      ],
    },
  ] as KnownBlock[];
}

// --- Registration ---

export function registerAppMentionHandler(app: App): void {
  let openaiClient: ReturnType<typeof createOpenAIClient> | undefined;

  function getOpenAIClient() {
    openaiClient ??= createOpenAIClient();
    return openaiClient;
  }

  app.event("app_mention", async ({ event, client, logger }) => {
    const channelId = event.channel;
    const userId = event.user as string | undefined;

    if (!channelId || !userId) return;

    // Ignore mentions in DMs (channel IDs starting with "D")
    if (channelId.startsWith("D")) return;

    // Extract task description by stripping the bot @mention
    const taskDescription = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

    if (!taskDescription) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "Please include a task description after the @mention. For example: `@bot summarize the discussion`",
        });
      } catch (error) {
        logger.error("Failed to send ephemeral hint:", error);
      }
      return;
    }

    // Check channel membership
    if (!(await isChannelMember(client, channelId, userId))) return;

    // Detect thread scope
    const threadTs = event.thread_ts;

    // Open DM with user
    let dmChannelId: string;
    try {
      const dm = await client.conversations.open({ users: userId });
      if (!dm.channel?.id) {
        logger.error("Failed to open DM: channel ID missing");
        return;
      }
      dmChannelId = dm.channel.id;
    } catch (error) {
      logger.error("Failed to open DM for @mention agent task:", error);
      return;
    }

    // Send initial status
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

    try {
      const planResult = await generatePlan(
        getOpenAIClient(),
        client,
        channelId,
        taskDescription,
        undefined,
        threadTs,
      );
      const { plan, planMessages } = planResult;

      // Store plan and show approval in DM
      const planId = createPlanId();
      const planData: PlanData = {
        id: planId,
        userId,
        channelId,
        taskDescription,
        plan,
        planMessages,
        threadTs,
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
    } catch (error) {
      logger.error("Failed to generate agent plan from @mention:", error);
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
    }
  });
}
