import type { WebClient } from "@slack/web-api";

const DEFAULT_MAX_PAGES = 3;
const MESSAGES_PER_PAGE = 100;

export interface RawMessage {
  user?: string;
  text?: string;
  subtype?: string;
  ts?: string;
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
  return allMessages.reverse();
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

function formatTimestamp(ts: string): string {
  const date = new Date(Number(ts) * 1000);
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

export function formatTranscript(
  channelName: string,
  messages: RawMessage[],
  userNames: Map<string, string>,
): string {
  const lines: string[] = [`# ${channelName}`, ""];

  for (const msg of messages) {
    if (msg.subtype === "channel_join" || msg.subtype === "channel_leave") continue;
    const name = msg.user ? (userNames.get(msg.user) ?? msg.user) : "Unknown";
    const time = msg.ts ? formatTimestamp(msg.ts) : "";
    lines.push(`[${time}] ${name}: ${msg.text ?? ""}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatTranscriptJson(
  channelName: string,
  channelId: string,
  messages: RawMessage[],
  userNames: Map<string, string>,
): string {
  const filtered = messages.filter(
    (msg) => msg.subtype !== "channel_join" && msg.subtype !== "channel_leave",
  );

  const data = {
    channel: { id: channelId, name: channelName },
    exportedAt: new Date().toISOString(),
    messages: filtered.map((msg) => ({
      ts: msg.ts ?? "",
      user: msg.user ?? "",
      userName: msg.user ? (userNames.get(msg.user) ?? msg.user) : "Unknown",
      text: msg.text ?? "",
    })),
  };

  return `${JSON.stringify(data, null, 2)}\n`;
}
