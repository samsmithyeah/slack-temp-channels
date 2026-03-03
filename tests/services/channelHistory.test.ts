import { describe, expect, it, vi } from "vitest";
import {
  fetchChannelMessages,
  formatTranscript,
  formatTranscriptJson,
} from "../../src/services/channelHistory";

function createMockClient(pages: Array<{ messages: unknown[]; next_cursor?: string }>) {
  let callIndex = 0;
  return {
    conversations: {
      history: vi.fn().mockImplementation(() => {
        const page = pages[callIndex++];
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
});
