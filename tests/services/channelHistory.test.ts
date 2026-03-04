import { describe, expect, it, vi } from "vitest";
import {
  fetchChannelMessages,
  formatTranscript,
  formatTranscriptJson,
} from "../../src/services/channelHistory";

function createMockClient(
  pages: Array<{ messages: unknown[]; next_cursor?: string }>,
  replyPages?: Record<string, Array<{ messages: unknown[]; next_cursor?: string }>>,
) {
  let callIndex = 0;
  const replyCallIndices: Record<string, number> = {};
  return {
    conversations: {
      history: vi.fn().mockImplementation(() => {
        const page = pages[callIndex++];
        return Promise.resolve({
          messages: page.messages,
          response_metadata: { next_cursor: page.next_cursor ?? "" },
        });
      }),
      replies: vi.fn().mockImplementation(({ ts }: { ts: string }) => {
        const threadPages = replyPages?.[ts] ?? [{ messages: [] }];
        const idx = replyCallIndices[ts] ?? 0;
        replyCallIndices[ts] = idx + 1;
        const page = threadPages[idx] ?? { messages: [] };
        return Promise.resolve({
          messages: page.messages,
          response_metadata: { next_cursor: page.next_cursor ?? "" },
        });
      }),
    },
  };
}

describe("fetchChannelMessages", () => {
  it("returns messages in chronological order", async () => {
    const client = createMockClient([
      {
        messages: [
          { user: "U2", text: "second", ts: "2" },
          { user: "U1", text: "first", ts: "1" },
        ],
      },
    ]);

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(result).toEqual([
      { user: "U1", text: "first", ts: "1" },
      { user: "U2", text: "second", ts: "2" },
    ]);
  });

  it("stops after default max pages (3) even if more cursors exist", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      messages: [{ user: "U1", text: `page${i}`, ts: String(i) }],
      next_cursor: `cursor${i + 1}`,
    }));
    const client = createMockClient(pages);

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.history).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxPages parameter", async () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      messages: [{ user: "U1", text: `page${i}`, ts: String(i) }],
      next_cursor: `cursor${i + 1}`,
    }));
    const client = createMockClient(pages);

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
      5,
    );

    expect(client.conversations.history).toHaveBeenCalledTimes(5);
  });

  it("fetches all pages when maxPages is Infinity", async () => {
    const pages = [
      { messages: [{ user: "U1", text: "p1", ts: "1" }], next_cursor: "c2" },
      { messages: [{ user: "U1", text: "p2", ts: "2" }], next_cursor: "c3" },
      { messages: [{ user: "U1", text: "p3", ts: "3" }] },
    ];
    const client = createMockClient(pages);

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
      Infinity,
    );

    expect(client.conversations.history).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no messages", async () => {
    const client = createMockClient([{ messages: [] }]);

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(result).toEqual([]);
  });

  it("passes channel ID to the API", async () => {
    const client = createMockClient([{ messages: [] }]);

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C_MY_CHANNEL",
    );

    expect(client.conversations.history).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C_MY_CHANNEL" }),
    );
  });

  it("fetches replies for threaded messages", async () => {
    const client = createMockClient(
      [{ messages: [{ user: "U1", text: "parent", ts: "100", reply_count: 2 }] }],
      {
        "100": [
          {
            messages: [
              { user: "U1", text: "parent", ts: "100" },
              { user: "U2", text: "reply1", ts: "101" },
              { user: "U3", text: "reply2", ts: "102" },
            ],
          },
        ],
      },
    );

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C123", ts: "100" }),
    );
    expect(result[0].replies).toEqual([
      { user: "U2", text: "reply1", ts: "101" },
      { user: "U3", text: "reply2", ts: "102" },
    ]);
  });

  it("paginates thread replies", async () => {
    const client = createMockClient(
      [{ messages: [{ user: "U1", text: "parent", ts: "100", reply_count: 2 }] }],
      {
        "100": [
          {
            messages: [
              { user: "U1", text: "parent", ts: "100" },
              { user: "U2", text: "reply1", ts: "101" },
            ],
            next_cursor: "page2",
          },
          {
            messages: [{ user: "U3", text: "reply2", ts: "102" }],
          },
        ],
      },
    );

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.replies).toHaveBeenCalledTimes(2);
    expect(result[0].replies).toHaveLength(2);
    expect(result[0].replies![1].text).toBe("reply2");
  });

  it("skips reply fetch for non-threaded messages", async () => {
    const client = createMockClient([{ messages: [{ user: "U1", text: "no thread", ts: "100" }] }]);

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.replies).not.toHaveBeenCalled();
  });

  it("caps reply pagination at 50 pages", async () => {
    const replyPages = Array.from({ length: 55 }, (_, i) => ({
      messages: [{ user: "U2", text: `reply${i}`, ts: String(200 + i) }],
      next_cursor: `rc${i + 1}`,
    }));
    // First page includes the parent echo
    replyPages[0].messages.unshift({ user: "U1", text: "parent", ts: "100" });

    const client = createMockClient(
      [{ messages: [{ user: "U1", text: "parent", ts: "100", reply_count: 55 }] }],
      { "100": replyPages },
    );

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.replies).toHaveBeenCalledTimes(50);
  });

  it("skips replies gracefully when conversations.replies fails", async () => {
    // conversations.history returns newest-first; after reverse: 100, 200, 300
    const client = createMockClient([
      {
        messages: [
          { user: "U1", text: "no thread", ts: "300" },
          { user: "U1", text: "bad thread", ts: "200", reply_count: 1 },
          { user: "U1", text: "ok thread", ts: "100", reply_count: 1 },
        ],
      },
    ]);

    vi.spyOn(console, "error").mockImplementation(() => {});
    client.conversations.replies = vi.fn().mockImplementation(({ ts }: { ts: string }) => {
      if (ts === "200") return Promise.reject(new Error("rate limited"));
      return Promise.resolve({
        messages: [
          { user: "U1", text: "parent", ts },
          { user: "U2", text: "reply", ts: `${ts}.1` },
        ],
        response_metadata: {},
      });
    });

    const result = await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    // After reverse: [100 (ok), 200 (bad), 300 (no thread)]
    expect(result[0].replies).toEqual([{ user: "U2", text: "reply", ts: "100.1" }]);
    expect(result[1].replies).toBeUndefined();
    expect(result[2].replies).toBeUndefined();
  });
});

describe("formatTranscript", () => {
  it("formats messages as timestamped plain text", () => {
    const userNames = new Map([
      ["U1", "Alice"],
      ["U2", "Bob"],
    ]);
    const messages = [
      { user: "U1", text: "Hello", ts: "1700000000.000000" },
      { user: "U2", text: "Hi there", ts: "1700000060.000000" },
    ];

    const result = formatTranscript("test-channel", messages, userNames);

    expect(result).toContain("# test-channel");
    expect(result).toContain("Alice: Hello");
    expect(result).toContain("Bob: Hi there");
    expect(result).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\]/);
  });

  it("skips channel_join and channel_leave subtypes", () => {
    const userNames = new Map([["U1", "Alice"]]);
    const messages = [
      { user: "U1", text: "joined", subtype: "channel_join", ts: "1" },
      { user: "U1", text: "Hello", ts: "2" },
      { user: "U1", text: "left", subtype: "channel_leave", ts: "3" },
    ];

    const result = formatTranscript("ch", messages, userNames);

    expect(result).not.toContain("joined");
    expect(result).not.toContain("left");
    expect(result).toContain("Alice: Hello");
  });

  it("falls back to user ID when name is not in map", () => {
    const userNames = new Map<string, string>();
    const messages = [{ user: "U_UNKNOWN", text: "Hi", ts: "1" }];

    const result = formatTranscript("ch", messages, userNames);

    expect(result).toContain("U_UNKNOWN: Hi");
  });

  it("indents thread replies with ↳", () => {
    const userNames = new Map([
      ["U1", "Alice"],
      ["U2", "Bob"],
    ]);
    const messages = [
      {
        user: "U1",
        text: "Anyone seen this bug?",
        ts: "1700000000.000000",
        reply_count: 1,
        replies: [{ user: "U2", text: "Yes, I'll take a look", ts: "1700000060.000000" }],
      },
    ];

    const result = formatTranscript("ch", messages, userNames);

    expect(result).toContain("Alice: Anyone seen this bug?");
    expect(result).toContain("  ↳ ");
    expect(result).toContain("Bob: Yes, I'll take a look");
  });
});

describe("formatTranscriptJson", () => {
  it("returns valid JSON with channel metadata and messages", () => {
    const userNames = new Map([["U1", "Alice"]]);
    const messages = [{ user: "U1", text: "Hello", ts: "1700000000.000000" }];

    const result = formatTranscriptJson("test-channel", "C123", messages, userNames);
    const parsed = JSON.parse(result);

    expect(parsed.channel).toEqual({ id: "C123", name: "test-channel" });
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toEqual({
      ts: "1700000000.000000",
      user: "U1",
      userName: "Alice",
      text: "Hello",
    });
  });

  it("skips channel_join and channel_leave messages", () => {
    const userNames = new Map([["U1", "Alice"]]);
    const messages = [
      { user: "U1", text: "joined", subtype: "channel_join", ts: "1" },
      { user: "U1", text: "Hello", ts: "2" },
    ];

    const result = formatTranscriptJson("ch", "C1", messages, userNames);
    const parsed = JSON.parse(result);

    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].text).toBe("Hello");
  });

  it("nests replies array in parent messages with threads", () => {
    const userNames = new Map([
      ["U1", "Alice"],
      ["U2", "Bob"],
    ]);
    const messages = [
      {
        user: "U1",
        text: "Parent",
        ts: "1700000000.000000",
        reply_count: 1,
        replies: [{ user: "U2", text: "Reply", ts: "1700000060.000000" }],
      },
      { user: "U2", text: "No thread", ts: "1700000120.000000" },
    ];

    const result = formatTranscriptJson("ch", "C1", messages, userNames);
    const parsed = JSON.parse(result);

    expect(parsed.messages[0].replies).toEqual([
      { ts: "1700000060.000000", user: "U2", userName: "Bob", text: "Reply" },
    ]);
    expect(parsed.messages[1].replies).toBeUndefined();
  });
});
