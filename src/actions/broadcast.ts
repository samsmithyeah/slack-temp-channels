import type { App } from "@slack/bolt";
import { broadcastModal } from "../modals/broadcast";

export function registerBroadcastAction(app: App): void {
  // Open the broadcast modal when button is clicked
  app.action(
    "broadcast_and_close",
    async ({ ack, body, client, logger }) => {
      await ack();

      const channelId = body.channel?.id;
      if (!channelId) return;

      try {
        await client.views.open({
          trigger_id: (body as any).trigger_id,
          view: broadcastModal(channelId),
        });
      } catch (error) {
        logger.error("Failed to open broadcast modal:", error);
      }
    },
  );

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
      // Get source channel info for the name
      const channelInfo = await client.conversations.info({
        channel: sourceChannelId,
      });
      const channelName = channelInfo.channel?.name ?? "unknown";

      // Post to destination channel
      await client.chat.postMessage({
        channel: destinationChannelId,
        text: `Dash channel #${channelName} has wrapped up.\n\nOutcome: ${outcome}`,
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

      // Archive the source channel
      await client.conversations.archive({ channel: sourceChannelId });
    } catch (error: any) {
      logger.error("Failed to broadcast and close:", error);
      if (
        error?.data?.error === "not_authorized" ||
        error?.data?.error === "restricted_action"
      ) {
        await client.chat.postMessage({
          channel: sourceChannelId,
          text: "I don't have permission to archive this channel. A workspace admin will need to archive it manually.",
        });
      }
    }
  });
}
