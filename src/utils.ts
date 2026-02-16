import type { KnownBlock } from "@slack/types";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function welcomeBlocks(
  creatorId: string,
  purpose: string | undefined,
  invitedUserIds: string[],
): KnownBlock[] {
  const userList = invitedUserIds.map((id) => `<@${id}>`).join(", ");
  const purposeLine = purpose ? `\n>*Purpose:* ${purpose}` : "";

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<@${creatorId}> created this temporary channel.*${purposeLine}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Invited:* ${userList}`,
      },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Close Channel" },
          style: "danger",
          action_id: "close_channel",
          confirm: {
            title: { type: "plain_text", text: "Close this channel?" },
            text: {
              type: "mrkdwn",
              text: "This will archive the channel. This action cannot be undone.",
            },
            confirm: { type: "plain_text", text: "Close it" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Broadcast & Close" },
          action_id: "broadcast_and_close",
        },
      ],
    },
  ];
}
