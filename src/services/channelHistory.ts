import type { WebClient } from "@slack/web-api";

const MAX_PAGES = 1;
const MESSAGES_PER_PAGE = 200;

interface RawMessage {
  user?: string;
  text?: string;
  subtype?: string;
  ts?: string;
}

export async function fetchChannelMessages(
  client: WebClient,
  channelId: string,
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
  } while (cursor && page < MAX_PAGES);

  // conversations.history returns newest-first; reverse to chronological order
  return allMessages.reverse();
}
