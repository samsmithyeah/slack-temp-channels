import type { App } from "@slack/bolt";
import { planBlocks } from "../agentBlocks";
import { isUserActive, markActive, markInactive } from "../services/activeTaskTracker";
import { executePlan, generatePlan } from "../services/agentPlanner";
import {
  addReaction,
  getOutcomeReaction,
  removeReaction,
  shouldYolo,
} from "../services/agentReactions";
import { ApiKeyMissingError, getOpenAIClient } from "../services/openai";
import { createPlanId, storePlan } from "../services/planStore";
import { isChannelMember } from "../utils";

// Deduplicate Slack event retries using event_ts (kept for 60s)
const MAX_RECENT_EVENTS = 10_000;
const recentEvents = new Set<string>();

// --- Registration ---

export function registerAppMentionHandler(app: App): void {
  app.event("app_mention", async ({ event, client, logger }) => {
    const eventId = event.event_ts ?? event.ts;
    if (recentEvents.has(eventId)) return;
    if (recentEvents.size >= MAX_RECENT_EVENTS) recentEvents.clear();
    recentEvents.add(eventId);
    setTimeout(() => recentEvents.delete(eventId), 60_000).unref();

    const channelId = event.channel;
    const userId = event.user as string | undefined;

    if (!channelId || !userId) return;

    // Ignore mentions in DMs (channel IDs starting with "D")
    if (channelId.startsWith("D")) return;

    // Extract task description by stripping the bot @mention
    const rawText = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
    const isYolo = /\byolo\b/i.test(rawText);
    const taskDescription = rawText.replace(/\s*\byolo\b\s*/gi, " ").trim();

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

    // Mark active immediately to prevent duplicate event deliveries from racing
    markActive(userId);
    let removeEyesOnFinally = true;
    let removeGearOnFinally = false;
    let outcomeReaction: string | null = null;
    try {
      // React with eyes to acknowledge the mention (stays until execution starts)
      await addReaction(client, channelId, event.ts, "eyes");

      const openai = getOpenAIClient();
      const planResult = await generatePlan(
        openai,
        client,
        channelId,
        taskDescription,
        undefined,
        threadTs,
      );
      const { plan, planMessages } = planResult;

      if (shouldYolo(isYolo, plan)) {
        logger.info(
          `Auto-executing plan (yolo=${isYolo}, requiresApproval=${plan.requiresApproval}, steps=${plan.steps.length})`,
        );
        // Swap eyes for cog during execution
        await removeReaction(client, channelId, event.ts, "eyes");
        removeEyesOnFinally = false;
        await addReaction(client, channelId, event.ts, "gear");
        removeGearOnFinally = true;

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
        outcomeReaction = getOutcomeReaction(result);
        if (result.summary) {
          try {
            await client.chat.postEphemeral({
              channel: channelId,
              user: userId,
              text: result.summary,
            });
          } catch {
            // best-effort
          }
        }
      } else {
        // Eyes stay until user accepts/declines — don't remove in finally
        removeEyesOnFinally = false;

        // Open DM and show plan for approval
        const dm = await client.conversations.open({ users: userId });
        if (!dm.channel?.id) throw new Error("channel ID missing");
        const dmChannelId = dm.channel.id;

        const planId = createPlanId();

        const statusMsg = await client.chat.postMessage({
          channel: dmChannelId,
          text: `Plan: ${plan.summary}`,
          blocks: planBlocks(plan, planId),
        });
        storePlan({
          id: planId,
          userId,
          channelId,
          taskDescription,
          plan,
          planMessages,
          threadTs,
          mentionChannelId: channelId,
          mentionMessageTs: event.ts,
          dmChannelId,
          dmMessageTs: statusMsg.ts!,
          createdAt: Date.now(),
        });
      }
    } catch (error) {
      logger.error("Failed to process @mention agent task:", error);
      outcomeReaction = "x";
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `:x: ${error instanceof ApiKeyMissingError ? "OpenAI API key is not configured." : `Failed to process task: ${error instanceof Error ? error.message : "unknown error"}`}`,
        });
      } catch {
        // best-effort
      }
    } finally {
      markInactive(userId);
      if (removeEyesOnFinally) {
        await removeReaction(client, channelId, event.ts, "eyes");
      }
      if (removeGearOnFinally) {
        await removeReaction(client, channelId, event.ts, "gear");
      }
      if (outcomeReaction) {
        await addReaction(client, channelId, event.ts, outcomeReaction);
      }
    }
  });
}
