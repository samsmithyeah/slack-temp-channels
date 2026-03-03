import type { App } from "@slack/bolt";
import { exportModal } from "../modals/export";
import type { RawMessage } from "../services/channelHistory";
import {
  fetchChannelMessages,
  formatTranscript,
  formatTranscriptJson,
  resolveUserNames,
} from "../services/channelHistory";
import type { ActionBody } from "../types";

export function registerExportAction(app: App): void {
  app.action(/^home_export_/, async ({ ack, body, client, logger }) => {
    await ack();

    const actionBody = body as unknown as ActionBody;
    const action = actionBody.actions?.[0];
    if (action?.type !== "button" || !action?.value) return;

    const [channelId, ...nameParts] = action.value.split(":");
    const channelName = nameParts.join(":");

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: exportModal(channelId, channelName),
      });
    } catch (error) {
      logger.error("Failed to open export modal:", error);
    }
  });

  app.view("export_submit", async ({ ack, view, body, client, logger }) => {
    await ack();

    const userId = body.user.id;
    const metadata = view.private_metadata;
    const [channelId, ...nameParts] = metadata.split(":");
    const channelName = nameParts.join(":");

    const formatValue =
      view.state?.values?.export_format?.export_format_input?.selected_option?.value ?? "text";

    try {
      const messages: RawMessage[] = await fetchChannelMessages(client, channelId, Infinity);

      if (messages.length === 0) {
        await client.chat.postMessage({
          channel: userId,
          text: `No messages found in #${channelName} to export.`,
        });
        return;
      }

      const userIds = messages.map((m) => m.user).filter((u): u is string => !!u);
      const userNames = await resolveUserNames(client, userIds);

      let content: string;
      let filename: string;
      if (formatValue === "json") {
        content = formatTranscriptJson(channelName, channelId, messages, userNames);
        filename = `${channelName}.json`;
      } else {
        content = formatTranscript(channelName, messages, userNames);
        filename = `${channelName}.txt`;
      }

      await client.filesUploadV2({
        channel_id: userId,
        content,
        filename,
        title: `Export of #${channelName}`,
      });
    } catch (error) {
      logger.error("Failed to export conversation:", error);
      try {
        await client.chat.postMessage({
          channel: userId,
          text: `Sorry, I couldn't export #${channelName}. Please try again later.`,
        });
      } catch (dmError) {
        logger.error("Failed to send export error DM:", dmError);
      }
    }
  });
}
