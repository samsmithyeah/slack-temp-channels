import type { App } from "@slack/bolt";
import { planBlocks } from "../agentBlocks";
import { isUserActive, markActive, markInactive } from "../services/activeTaskTracker";
import { generatePlan } from "../services/agentPlanner";
import { ApiKeyMissingError, getOpenAIClient } from "../services/openai";
import { createPlanId, type PlanData, storePlan } from "../services/planStore";
import { isChannelMember } from "../utils";

// --- Registration ---

export function registerAppMentionHandler(app: App): void {
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

    if (isUserActive(userId)) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "You already have an agent task in progress. Please wait for it to finish.",
        });
      } catch {
        // best-effort
      }
      return;
    }

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

    markActive(userId);
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
    } finally {
      markInactive(userId);
    }
  });
}
