import type { WebClient } from "@slack/web-api";

const DEFAULT_MAX_PAGES = 3;
export const EXPORT_MAX_PAGES = 100;
const MESSAGES_PER_PAGE = 100;
const MAX_REPLY_PAGES = 50;

export interface RawMessage {
  user?: string;
  text?: string;
  subtype?: string;
  ts?: string;
  reply_count?: number;
  replies?: RawMessage[];
}

export async function fetchChannelMessages(
  client: WebClient,
  channelId: string,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<RawMessage[]> {
  const allMessages: RawMessage[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    const result = await client.conversations.history({
      channel: channelId,
      limit: MESSAGES_PER_PAGE,
      cursor,
    });

    const messages = (result.messages ?? []) as RawMessage[];
    allMessages.push(...messages);

    cursor = result.response_metadata?.next_cursor || undefined;
    page++;
  } while (cursor && page < maxPages);

  // conversations.history returns newest-first; reverse to chronological order
  allMessages.reverse();

  // Fetch thread replies sequentially to avoid hitting Slack rate limits
  for (const msg of allMessages) {
    if (msg.reply_count && msg.reply_count > 0 && msg.ts) {
      try {
        const replies: RawMessage[] = [];
        let replyCursor: string | undefined;
        let replyPage = 0;

        do {
          const result = await client.conversations.replies({
            channel: channelId,
            ts: msg.ts,
            limit: MESSAGES_PER_PAGE,
            cursor: replyCursor,
          });

          const replyMessages = (result.messages ?? []) as RawMessage[];
          replies.push(...replyMessages);

          replyCursor = result.response_metadata?.next_cursor || undefined;
          replyPage++;
        } while (replyCursor && replyPage < MAX_REPLY_PAGES);

        // First message in replies is the parent — skip it
        msg.replies = replies.slice(1);
      } catch (error) {
        console.error(
          `Failed to fetch replies for thread ${msg.ts} in channel ${channelId}:`,
          error,
        );
      }
    }
  }

  return allMessages;
}

export async function resolveUserNames(
  client: WebClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(userIds)];

  await Promise.all(
    unique.map(async (id) => {
      try {
        const result = await client.users.info({ user: id });
        const user = result.user;
        const name = user?.profile?.display_name || user?.real_name || user?.name || id;
        names.set(id, name);
      } catch {
        names.set(id, id);
      }
    }),
  );

  return names;
}

function isUserMessage(msg: RawMessage): boolean {
  return msg.subtype !== "channel_join" && msg.subtype !== "channel_leave";
}

function sanitizeText(text?: string): string {
  return (text ?? "").replace(/\n/g, " ");
}

function formatTimestamp(ts: string): string {
  const date = new Date(Number(ts) * 1000);
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

function formatMessageLine(msg: RawMessage, userNames: Map<string, string>): string {
  const name = msg.user ? (userNames.get(msg.user) ?? msg.user) : "Unknown";
  const time = msg.ts ? formatTimestamp(msg.ts) : "";
  return `[${time}] ${name}: ${sanitizeText(msg.text)}`;
}

function toMessageJson(msg: RawMessage, userNames: Map<string, string>) {
  return {
    ts: msg.ts ?? "",
    user: msg.user ?? "",
    userName: msg.user ? (userNames.get(msg.user) ?? msg.user) : "Unknown",
    text: msg.text ?? "",
  };
}

export function formatTranscript(
  channelName: string,
  messages: RawMessage[],
  userNames: Map<string, string>,
): string {
  const lines: string[] = [`# ${channelName}`, ""];

  for (const msg of messages) {
    if (!isUserMessage(msg)) continue;
    lines.push(formatMessageLine(msg, userNames));

    if (msg.replies) {
      for (const reply of msg.replies) {
        if (!isUserMessage(reply)) continue;
        lines.push(`  ↳ ${formatMessageLine(reply, userNames)}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatTranscriptJson(
  channelName: string,
  channelId: string,
  messages: RawMessage[],
  userNames: Map<string, string>,
): string {
  const filtered = messages.filter(isUserMessage);

  const data = {
    channel: { id: channelId, name: channelName },
    exportedAt: new Date().toISOString(),
    messages: filtered.map((msg) => ({
      ...toMessageJson(msg, userNames),
      ...(msg.replies?.length
        ? {
            replies: msg.replies
              .filter(isUserMessage)
              .map((reply) => toMessageJson(reply, userNames)),
          }
        : {}),
    })),
  };

  return `${JSON.stringify(data, null, 2)}\n`;
}
