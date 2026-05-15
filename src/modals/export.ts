import type { View } from "@slack/types";
import { LABEL_EXPORT, LABEL_EXPORT_WITH_FILES } from "../constants";

export function exportModal(channelId: string, channelName: string): View {
  return {
    type: "modal",
    callback_id: "export_submit",
    private_metadata: `${channelId}:${channelName}`,
    title: { type: "plain_text", text: LABEL_EXPORT },
    submit: { type: "plain_text", text: LABEL_EXPORT },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        block_id: "export_info",
        text: {
          type: "mrkdwn",
          text: `Export the full conversation from *#${channelName}*.`,
        },
      },
      {
        type: "input",
        block_id: "export_format",
        label: { type: "plain_text", text: "Format" },
        element: {
          type: "radio_buttons",
          action_id: "export_format_input",
          initial_option: {
            text: { type: "plain_text", text: "Plain text" },
            value: "text",
          },
          options: [
            {
              text: { type: "plain_text", text: "Plain text" },
              value: "text",
            },
            {
              text: { type: "plain_text", text: "JSON" },
              value: "json",
            },
          ],
        },
      },
    ],
  };
}

export function exportWithFilesModal(channelId: string, channelName: string): View {
  return {
    type: "modal",
    callback_id: "export_with_files_submit",
    private_metadata: `${channelId}:${channelName}`,
    title: { type: "plain_text", text: LABEL_EXPORT_WITH_FILES },
    submit: { type: "plain_text", text: LABEL_EXPORT_WITH_FILES },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        block_id: "export_info",
        text: {
          type: "mrkdwn",
          text: `Export the full conversation and all shared files from *#${channelName}* as a zip archive.`,
        },
      },
      {
        type: "input",
        block_id: "export_format",
        label: { type: "plain_text", text: "Transcript format" },
        element: {
          type: "radio_buttons",
          action_id: "export_format_input",
          initial_option: {
            text: { type: "plain_text", text: "Plain text" },
            value: "text",
          },
          options: [
            {
              text: { type: "plain_text", text: "Plain text" },
              value: "text",
            },
            {
              text: { type: "plain_text", text: "JSON" },
              value: "json",
            },
          ],
        },
      },
    ],
  };
}
