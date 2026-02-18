import type { View } from "@slack/types";
import { LABEL_BROADCAST_CLOSE } from "../constants";

export function broadcastModal(sourceChannelId: string): View {
  return {
    type: "modal",
    callback_id: "broadcast_submit",
    private_metadata: sourceChannelId,
    title: { type: "plain_text", text: LABEL_BROADCAST_CLOSE },
    submit: { type: "plain_text", text: LABEL_BROADCAST_CLOSE },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "destination_channel",
        label: { type: "plain_text", text: "Post summary to" },
        element: {
          type: "conversations_select",
          action_id: "destination_channel_input",
          filter: {
            include: ["public"],
            exclude_bot_users: true,
          },
          placeholder: {
            type: "plain_text",
            text: "Select a channel",
          },
        },
      },
      {
        type: "input",
        block_id: "outcome",
        label: { type: "plain_text", text: "Outcome / Summary" },
        element: {
          type: "plain_text_input",
          action_id: "outcome_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "What was decided or accomplished?",
          },
        },
      },
    ],
  };
}
