import type { View } from "@slack/types";
import { CHANNEL_PREFIX, LABEL_CREATE } from "../constants";

export function createChannelModal(preselectedUserIds?: string[], originChannelId?: string): View {
  return {
    type: "modal",
    callback_id: "create_channel",
    ...(originChannelId ? { private_metadata: originChannelId } : {}),
    title: { type: "plain_text", text: LABEL_CREATE },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "channel_name",
        label: { type: "plain_text", text: "Channel name" },
        hint: {
          type: "plain_text",
          text: `Will be prefixed with "${CHANNEL_PREFIX}". Lowercase, hyphens only.`,
        },
        element: {
          type: "plain_text_input",
          action_id: "channel_name_input",
          placeholder: { type: "plain_text", text: "e.g. launch-planning" },
        },
      },
      {
        type: "input",
        block_id: "invite_users",
        label: { type: "plain_text", text: "Invite people" },
        element: {
          type: "multi_users_select",
          action_id: "invite_users_input",
          placeholder: { type: "plain_text", text: "Select people to invite" },
          ...(preselectedUserIds?.length ? { initial_users: preselectedUserIds } : {}),
        },
      },
      {
        type: "input",
        block_id: "purpose",
        label: { type: "plain_text", text: "Purpose" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "purpose_input",
          placeholder: {
            type: "plain_text",
            text: "What is this channel for?",
          },
        },
      },
    ],
  };
}
