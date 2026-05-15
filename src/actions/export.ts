import type { App } from "@slack/bolt";
import { exportModal, exportWithFilesModal } from "../modals/export";
import type { RawMessage } from "../services/channelHistory";
import {
  EXPORT_MAX_PAGES,
  fetchChannelMessages,
  formatTranscript,
  formatTranscriptJson,
  resolveUserNames,
} from "../services/channelHistory";
import { buildExportZip, collectFiles, downloadAll } from "../services/fileDownloader";
import type { ActionBody } from "../types";
import { isChannelMember } from "../utils";

function extractUserIds(messages: RawMessage[]): string[] {
  return messages
    .flatMap((m) => [m.user, ...(m.replies ?? []).map((r) => r.user)])
    .filter((u): u is string => !!u);
}

export function registerExportAction(app: App): void {
  app.action(/^home_export_/, async ({ ack, body, client, logger }) => {
    await ack();

    const actionBody = body as unknown as ActionBody;
    const action = actionBody.actions?.[0];
    if (action?.type !== "button" || !action?.value) return;

    const isWithFiles = action.action_id?.startsWith("home_export_files_") ?? false;

    const [channelId, ...nameParts] = action.value.split(":");
    const channelName = nameParts.join(":");

    try {
      await client.views.open({
        trigger_id: actionBody.trigger_id,
        view: isWithFiles
          ? exportWithFilesModal(channelId, channelName)
          : exportModal(channelId, channelName),
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

      const userNames = await resolveUserNames(client, extractUserIds(messages));

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

  app.view("export_with_files_submit", async ({ ack, view, body, client, logger }) => {
    await ack();

    const userId = body.user.id;
    const metadata = view.private_metadata;
    const [channelId, ...nameParts] = metadata.split(":");
    const channelName = nameParts.join(":");
    const formatValue =
      view.state?.values?.export_format?.export_format_input?.selected_option?.value ?? "text";

    // Run the heavy work (file downloads, zip assembly) outside the request
    // lifecycle so the ack response reaches Slack within its 3-second timeout.
    void (async () => {
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

        await client.chat.postMessage({
          channel: dmChannelId,
          text: `Preparing export of #${channelName} with files — this may take a moment...`,
        });

        const userNames = await resolveUserNames(client, extractUserIds(messages));

        const collectedFiles = collectFiles(messages);
        const token = client.token as string;
        const {
          files: downloadedFiles,
          totalFiles,
          skippedFiles,
        } = await downloadAll(token, collectedFiles);

        const fileOpts = { includeFilePaths: true };
        let transcript: string;
        let transcriptFilename: string;
        if (formatValue === "json") {
          transcript = formatTranscriptJson(channelName, channelId, messages, userNames, fileOpts);
          transcriptFilename = `${channelName}.json`;
        } else {
          transcript = formatTranscript(channelName, messages, userNames, fileOpts);
          transcriptFilename = `${channelName}.txt`;
        }

        const zipBuffer = await buildExportZip(transcript, transcriptFilename, downloadedFiles);

        let title = `Export of #${channelName}`;
        if (skippedFiles > 0) {
          title += ` (${totalFiles - skippedFiles} of ${totalFiles} files included — ${skippedFiles} skipped due to size limits)`;
        }

        await client.filesUploadV2({
          channel_id: dmChannelId,
          file: zipBuffer,
          filename: `${channelName}.zip`,
          title,
        });
      } catch (error) {
        logger.error("Failed to export conversation with files:", error);
        try {
          await client.chat.postMessage({
            channel: dmChannelId,
            text: `Sorry, I couldn't export #${channelName}. Please try again later.`,
          });
        } catch (dmError) {
          logger.error("Failed to send export error DM:", dmError);
        }
      }
    })();
  });
}
