import type { App, BlockAction } from "@slack/bolt";
import { ERR_ARCHIVE_PERMISSION } from "../constants";
import { type BroadcastMetadata, broadcastModal } from "../modals/broadcast";
import { fetchChannelMessages, resolveUserNames } from "../services/channelHistory";
import {
  ApiKeyMissingError,
  createOpenAIClient,
  extractUserIds,
  formatMessagesForPrompt,
  generateSummary,
  resolveNamesInMessages,
  restoreUserMentions,
} from "../services/openai";
import type { ActionBody } from "../types";
import { getSlackErrorCode } from "../utils";

function parseMetadata(raw: string): BroadcastMetadata {
  try {
    return JSON.parse(raw) as BroadcastMetadata;
  } catch {
    // Backwards compatibility: old modals stored just the channel ID
    return { channelId: raw };
  }
}

export function registerBroadcastAction(app: App): void {
  let openaiClient: ReturnType<typeof createOpenAIClient> | undefined;
  // Open the broadcast modal when button is clicked
  app.action("broadcast_and_close", async ({ ack, body, client, logger }) => {
    await ack();

    const actionBody = body as unknown as ActionBody;
    const channelId = actionBody.channel?.id;
    if (!channelId) return;

    const originChannelId = actionBody.actions?.[0]?.value || undefined;

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: broadcastModal(channelId, originChannelId),
      });
    } catch (error) {
      logger.error("Failed to open broadcast modal:", error);
    }
  });

  // Generate AI summary from channel messages
  app.action("generate_ai_summary", async ({ ack, body, client, logger }) => {
    await ack();

    const view = (body as BlockAction).view!;
    const { channelId: sourceChannelId } = parseMetadata(view.private_metadata);

    const currentDestination =
      view.state.values.destination_channel?.destination_channel_input?.selected_conversation ??
      undefined;

    try {
      await client.views.update({
        view_id: view.id,
        view: broadcastModal(sourceChannelId, currentDestination, undefined, true),
      });

      const rawMessages = await fetchChannelMessages(client, sourceChannelId);
      const formattedMessages = formatMessagesForPrompt(rawMessages);

      if (formattedMessages.length === 0) {
        await client.views.update({
          view_id: view.id,
          view: broadcastModal(
            sourceChannelId,
            currentDestination,
            "No messages found in channel to summarise.",
          ),
        });
        return;
      }

      const userIds = extractUserIds(formattedMessages);
      const userNames = await resolveUserNames(client, userIds);
      const resolvedMessages = resolveNamesInMessages(formattedMessages, userNames);

      openaiClient ??= createOpenAIClient();
      const summary = await generateSummary(openaiClient, resolvedMessages);

      await client.views.update({
        view_id: view.id,
        view: broadcastModal(sourceChannelId, currentDestination, summary, false, userNames),
      });
    } catch (error) {
      logger.error("Failed to generate AI summary:", error);

      const errorMessage =
        error instanceof ApiKeyMissingError
          ? "OpenAI API key is not configured. Please contact your workspace admin."
          : "Failed to generate summary. Please try again or write one manually.";

      try {
        await client.views.update({
          view_id: view.id,
          view: broadcastModal(sourceChannelId, currentDestination, errorMessage),
        });
      } catch (updateError) {
        logger.error("Failed to update modal with error state:", updateError);
      }
    }
  });

  // Handle broadcast modal submission
  app.view("broadcast_submit", async ({ ack, body, view, client, logger }) => {
    await ack();

    const values = view.state.values;
    const destinationChannelId =
      values.destination_channel.destination_channel_input.selected_conversation!;
    const rawOutcome = values.outcome.outcome_input.value!;
    const { channelId: sourceChannelId, userNames: userNamesRecord } = parseMetadata(
      view.private_metadata,
    );
    const userId = body.user.id;

    // Restore display names to Slack mentions for the posted message
    const userNamesMap = new Map(Object.entries(userNamesRecord ?? {}));
    const outcome = restoreUserMentions(rawOutcome, userNamesMap);

    try {
      // Join destination channel so the bot can post (ignore if already joined)
      try {
        await client.conversations.join({ channel: destinationChannelId });
      } catch (error: unknown) {
        if (getSlackErrorCode(error) !== "already_in_channel") throw error;
      }

      // Post to destination channel
      await client.chat.postMessage({
        channel: destinationChannelId,
        text: `Dash channel <#${sourceChannelId}> has wrapped up. Outcome: ${outcome}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<#${sourceChannelId}> has wrapped up.`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Outcome:*\n>${outcome.replace(/\n/g, "\n>")}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Closed by <@${userId}>`,
              },
            ],
          },
        ],
      });

      // Get destination channel name for the close message
      const destInfo = await client.conversations.info({
        channel: destinationChannelId,
      });
      const destName = destInfo.channel?.name ?? "unknown";

      // Post close message in source channel
      await client.chat.postMessage({
        channel: sourceChannelId,
        text: `This channel was closed by <@${userId}>. Outcome was shared to #${destName}.`,
      });
    } catch (error) {
      logger.error("Failed to broadcast and close:", error);
      return;
    }

    // Archive separately so permission errors don't mask broadcast failures
    try {
      await client.conversations.archive({ channel: sourceChannelId });
    } catch (error: unknown) {
      logger.error("Failed to archive channel:", error);
      const code = getSlackErrorCode(error);
      if (code === "not_authorized" || code === "restricted_action") {
        await client.chat.postMessage({
          channel: sourceChannelId,
          text: ERR_ARCHIVE_PERMISSION,
        });
      }
    }
  });
}
