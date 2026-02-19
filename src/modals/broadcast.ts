import type { View } from "@slack/types";
import { LABEL_BROADCAST_CLOSE } from "../constants";

export interface BroadcastMetadata {
  channelId: string;
  userNames?: Record<string, string>;
}

export function broadcastModal(
  sourceChannelId: string,
  defaultDestinationChannelId?: string,
  initialOutcome?: string,
  loading?: boolean,
  userNames?: Map<string, string>,
): View {
  const metadata: BroadcastMetadata = {
    channelId: sourceChannelId,
    ...(userNames?.size ? { userNames: Object.fromEntries(userNames) } : {}),
  };

  return {
    type: "modal",
    callback_id: "broadcast_submit",
    private_metadata: JSON.stringify(metadata),
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
          ...(defaultDestinationChannelId
            ? {
                default_to_current_conversation: false,
                initial_conversation: defaultDestinationChannelId,
              }
            : {}),
          placeholder: {
            type: "plain_text",
            text: "Select a channel",
          },
        },
      },
      ...(loading
        ? [
            {
              type: "section" as const,
              block_id: "loading",
              text: {
                type: "mrkdwn" as const,
                text: ":hourglass_flowing_sand: Generating summary with AI…",
              },
            },
          ]
        : [
            {
              type: "input" as const,
              block_id: "outcome",
              label: {
                type: "plain_text" as const,
                text: "Outcome / Summary",
              },
              element: {
                type: "plain_text_input" as const,
                action_id: "outcome_input",
                multiline: true,
                ...(initialOutcome ? { initial_value: initialOutcome } : {}),
                placeholder: {
                  type: "plain_text" as const,
                  text: "What was decided or accomplished?",
                },
              },
            },
            {
              type: "actions" as const,
              block_id: "ai_actions",
              elements: [
                {
                  type: "button" as const,
                  text: {
                    type: "plain_text" as const,
                    text: ":sparkles: Generate summary with AI",
                  },
                  action_id: "generate_ai_summary",
                },
              ],
            },
          ]),
    ],
  };
}
