import type { App } from "@slack/bolt";
import { ERR_ARCHIVE_PERMISSION } from "../constants";
import { broadcastModal } from "../modals/broadcast";
import { getSlackErrorCode } from "../utils";

export function registerBroadcastAction(app: App): void {
  // Open the broadcast modal when button is clicked
  app.action("broadcast_and_close", async ({ ack, body, client, logger }) => {
    await ack();

    const channelId = body.channel?.id;
    if (!channelId) return;

    const originChannelId =
      (body as unknown as { actions?: Array<{ value?: string }> }).actions?.[0]?.value || undefined;

    try {
      await client.views.open({
        trigger_id: (body as unknown as { trigger_id: string }).trigger_id,
        view: broadcastModal(channelId, originChannelId),
      });
    } catch (error) {
      logger.error("Failed to open broadcast modal:", error);
    }
  });

  // Handle broadcast modal submission
  app.view("broadcast_submit", async ({ ack, body, view, client, logger }) => {
    await ack();

    const values = view.state.values;
    const destinationChannelId =
      values.destination_channel.destination_channel_input.selected_conversation!;
    const outcome = values.outcome.outcome_input.value!;
    const sourceChannelId = view.private_metadata;
    const userId = body.user.id;

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
