import type { KnownBlock } from "@slack/types";
import { CREATOR_MSG_TEXT, LABEL_BROADCAST_CLOSE, LABEL_CLOSE } from "./constants";

export function getSlackErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const err = error as Record<string, unknown>;
  if (typeof err.data !== "object" || err.data === null) return undefined;
  const data = err.data as Record<string, unknown>;
  return typeof data.error === "string" ? data.error : undefined;
}

export function parseUserIds(text: string): string[] {
  // Slack sends @mentions as <@U12345> or <@U12345|username>
  const matches = text.matchAll(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g);
  return [...matches].map((m) => m[1]);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "")
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
        text: `*<@${creatorId}> ${CREATOR_MSG_TEXT}.*${purposeLine}`,
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
          text: { type: "plain_text", text: LABEL_CLOSE },
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
          text: { type: "plain_text", text: LABEL_BROADCAST_CLOSE },
          action_id: "broadcast_and_close",
        },
      ],
    },
  ];
}
