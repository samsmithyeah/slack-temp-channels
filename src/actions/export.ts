import type { App } from "@slack/bolt";
import { exportModal } from "../modals/export";
import type { RawMessage } from "../services/channelHistory";
import {
  EXPORT_MAX_PAGES,
  fetchChannelMessages,
  formatTranscript,
  formatTranscriptJson,
  resolveUserNames,
} from "../services/channelHistory";
import type { ActionBody } from "../types";
import { isChannelMember } from "../utils";

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

    // Open a DM channel with the user (filesUploadV2 and chat.postMessage
    // require a real channel ID, not a user ID)
    let dmChannelId: string;
    try {
      const dm = await client.conversations.open({ users: userId });
      if (!dm.channel?.id) {
        logger.error("Failed to open DM for export: channel ID is missing");
        return;
      }
      dmChannelId = dm.channel.id;
    } catch (error) {
      logger.error("Failed to open DM for export:", error);
      return;
    }

    // Verify the user is a member of the channel before exporting
    try {
      if (!(await isChannelMember(client, channelId, userId))) {
        await client.chat.postMessage({
          channel: dmChannelId,
          text: `You don't have access to #${channelName}.`,
        });
        return;
      }
    } catch (error) {
      logger.error("Failed to verify channel membership for export:", error);
      await client.chat.postMessage({
        channel: dmChannelId,
        text: `Sorry, I couldn't verify your access to #${channelName}. Please try again later.`,
      });
      return;
    }

    try {
      const messages: RawMessage[] = await fetchChannelMessages(
        client,
        channelId,
        EXPORT_MAX_PAGES,
      );

      if (messages.length === 0) {
        await client.chat.postMessage({
          channel: dmChannelId,
          text: `No messages found in #${channelName} to export.`,
        });
        return;
      }

      const userIds = messages
        .flatMap((m) => [m.user, ...(m.replies ?? []).map((r) => r.user)])
        .filter((u): u is string => !!u);
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
        channel_id: dmChannelId,
        content,
        filename,
        title: `Export of #${channelName}`,
      });
    } catch (error) {
      logger.error("Failed to export conversation:", error);
      try {
        await client.chat.postMessage({
          channel: dmChannelId,
          text: `Sorry, I couldn't export #${channelName}. Please try again later.`,
        });
      } catch (dmError) {
        logger.error("Failed to send export error DM:", dmError);
      }
    }
  });
}
