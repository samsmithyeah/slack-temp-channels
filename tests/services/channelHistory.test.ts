import { describe, expect, it, vi } from "vitest";
import { fetchChannelMessages } from "../../src/services/channelHistory";

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

  it("stops after max pages even if more cursors exist", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      messages: [{ user: "U1", text: `page${i}`, ts: String(i) }],
      next_cursor: `cursor${i + 1}`,
    }));
    const client = createMockClient(pages);

    await fetchChannelMessages(
      client as unknown as Parameters<typeof fetchChannelMessages>[0],
      "C123",
    );

    expect(client.conversations.history).toHaveBeenCalledTimes(1);
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
