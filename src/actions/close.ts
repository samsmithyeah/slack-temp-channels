import type { App } from "@slack/bolt";
import { ERR_ARCHIVE_PERMISSION } from "../constants";
import { getSlackErrorCode } from "../utils";

export function registerCloseAction(app: App): void {
  app.action("close_channel", async ({ ack, body, client, logger }) => {
    await ack();

    const channelId = body.channel?.id;
    if (!channelId) return;

    const userId = body.user.id;

    try {
      await client.chat.postMessage({
        channel: channelId,
        text: `This channel was closed by <@${userId}>`,
      });

      await client.conversations.archive({ channel: channelId });
    } catch (error: unknown) {
      logger.error("Failed to archive channel:", error);
      const code = getSlackErrorCode(error);
      if (code === "not_authorized" || code === "restricted_action") {
        await client.chat.postMessage({
          channel: channelId,
          text: ERR_ARCHIVE_PERMISSION,
        });
      }
    }
  });
}
