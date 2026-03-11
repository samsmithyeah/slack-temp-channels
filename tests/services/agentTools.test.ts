import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "../helpers/mock-app";

vi.mock("../../src/services/channelHistory", () => ({
  resolveUserNames: vi.fn().mockResolvedValue(
    new Map([
      ["U1", "Alice"],
      ["U2", "Bob"],
    ]),
  ),
}));

import { executeTool, type ToolContext } from "../../src/services/agentTools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    client: createMockClient() as unknown as ToolContext["client"],
    channelId: "C_CHAN",
    ...overrides,
  };
}

describe("executeTool", () => {
  it("returns error for unknown tool", async () => {
    const result = await executeTool("nonexistent_tool", makeCtx(), {});
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });
});

describe("read_channel_history", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("returns formatted messages in chronological order", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    // Slack API returns newest-first; the tool should reverse to chronological
    client.conversations.history.mockResolvedValueOnce({
      messages: [
        { user: "U1", text: "Second message", ts: "1000.2" },
        { user: "U2", text: "First message", ts: "1000.1" },
      ],
    });

    const result = await executeTool("read_channel_history", ctx, {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("Bob (<@U2>): First message");
    expect(result.output).toContain("Alice (<@U1>): Second message");
    expect(result.output.indexOf("First message")).toBeLessThan(
      result.output.indexOf("Second message"),
    );
  });

  it("filters out channel_join and channel_leave messages", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.history.mockResolvedValueOnce({
      messages: [
        { user: "U1", text: "Real message", ts: "1000.1" },
        { user: "U2", text: "joined", ts: "1000.2", subtype: "channel_join" },
        { user: "U2", text: "left", ts: "1000.3", subtype: "channel_leave" },
      ],
    });

    const result = await executeTool("read_channel_history", ctx, {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("Real message");
    expect(result.output).not.toContain("joined");
    expect(result.output).not.toContain("left");
  });

  it("reports when no messages found", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.history.mockResolvedValueOnce({ messages: [] });

    const result = await executeTool("read_channel_history", ctx, {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("No messages found");
  });

  it("notes thread reply counts", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.history.mockResolvedValueOnce({
      messages: [{ user: "U1", text: "Parent", ts: "1000.1", reply_count: 5 }],
    });

    const result = await executeTool("read_channel_history", ctx, {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("[5 replies]");
  });

  it("respects limit parameter", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.history.mockResolvedValueOnce({ messages: [] });

    await executeTool("read_channel_history", ctx, { limit: 50 });

    expect(client.conversations.history).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("caps limit at MAX_READ_LIMIT (200)", async () => {
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.history.mockResolvedValueOnce({ messages: [] });

    await executeTool("read_channel_history", ctx, { limit: 500 });

    expect(client.conversations.history).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });
});

describe("read_thread", () => {
  it("returns formatted thread messages with indentation for replies", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.conversations.replies.mockResolvedValueOnce({
      messages: [
        { user: "U1", text: "Parent message", ts: "1000.1" },
        { user: "U2", text: "Reply", ts: "1000.2" },
      ],
    });

    const result = await executeTool("read_thread", ctx, { thread_ts: "1000.1" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Alice (<@U1>): Parent message");
    // Reply should be indented
    expect(result.output).toContain("↳");
    expect(result.output).toContain("Bob (<@U2>): Reply");
  });

  it("rejects missing thread_ts", async () => {
    const ctx = makeCtx();
    const result = await executeTool("read_thread", ctx, {});
    expect(result.success).toBe(false);
    expect(result.output).toContain("thread_ts");
  });
});

describe("reply_to_message", () => {
  it("posts a thread reply", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.postMessage.mockResolvedValueOnce({ ok: true });

    const result = await executeTool("reply_to_message", ctx, {
      thread_ts: "1000.1",
      text: "Hello",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Replied in thread");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_CHAN",
        thread_ts: "1000.1",
        text: "Hello",
      }),
    );
  });

  it("includes attribution blocks when userId is set", async () => {
    const ctx = makeCtx({ userId: "U_TRIGGER" });
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.postMessage.mockResolvedValueOnce({ ok: true });

    await executeTool("reply_to_message", ctx, { thread_ts: "1000.1", text: "Hello" });

    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.blocks).toBeDefined();
    // Should have section block + context block with attribution
    const contextBlock = call.blocks.find((b: { type: string }) => b.type === "context");
    expect(contextBlock).toBeDefined();
  });

  it("rejects missing arguments", async () => {
    const ctx = makeCtx();
    const result = await executeTool("reply_to_message", ctx, { text: "Hello" });
    expect(result.success).toBe(false);
    expect(result.output).toContain("thread_ts");
  });

  it("rejects empty text", async () => {
    const ctx = makeCtx();
    const result = await executeTool("reply_to_message", ctx, {
      thread_ts: "1000.1",
      text: "  ",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("text");
  });
});

describe("post_channel_message", () => {
  it("posts a channel message", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.postMessage.mockResolvedValueOnce({ ok: true });

    const result = await executeTool("post_channel_message", ctx, { text: "Hello channel" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("Message posted");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_CHAN",
        text: "Hello channel",
      }),
    );
  });

  it("includes attribution blocks when userId is set", async () => {
    const ctx = makeCtx({ userId: "U_TRIGGER" });
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.postMessage.mockResolvedValueOnce({ ok: true });

    await executeTool("post_channel_message", ctx, { text: "Hello" });

    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.blocks).toBeDefined();
    const contextBlock = call.blocks.find((b: { type: string }) => b.type === "context");
    expect(contextBlock).toBeDefined();
  });

  it("does not include blocks when userId is not set", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.postMessage.mockResolvedValueOnce({ ok: true });

    await executeTool("post_channel_message", ctx, { text: "Hello" });

    const call = client.chat.postMessage.mock.calls[0][0];
    expect(call.blocks).toBeUndefined();
  });

  it("rejects missing text", async () => {
    const ctx = makeCtx();
    const result = await executeTool("post_channel_message", ctx, {});
    expect(result.success).toBe(false);
    expect(result.output).toContain("text");
  });
});

describe("edit_message", () => {
  it("updates a message", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.update.mockResolvedValueOnce({ ok: true });

    const result = await executeTool("edit_message", ctx, {
      message_ts: "1000.1",
      text: "Updated text",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("updated");
    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_CHAN",
        ts: "1000.1",
        text: "Updated text",
      }),
    );
  });

  it("includes attribution blocks when userId is set", async () => {
    const ctx = makeCtx({ userId: "U_TRIGGER" });
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.update.mockResolvedValueOnce({ ok: true });

    await executeTool("edit_message", ctx, { message_ts: "1000.1", text: "Hello" });

    const call = client.chat.update.mock.calls[0][0];
    expect(call.blocks).toBeDefined();
    const contextBlock = call.blocks.find((b: { type: string }) => b.type === "context");
    expect(contextBlock).toBeDefined();
  });

  it("returns specific error for cant_update_message", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.update.mockRejectedValueOnce(
      new Error("An API error occurred: cant_update_message"),
    );

    const result = await executeTool("edit_message", ctx, {
      message_ts: "1000.1",
      text: "Updated",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("bot can only edit its own messages");
  });

  it("returns specific error for msg_too_long", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.update.mockRejectedValueOnce(new Error("An API error occurred: msg_too_long"));

    const result = await executeTool("edit_message", ctx, {
      message_ts: "1000.1",
      text: "Very long text",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("too long");
  });

  it("returns specific error for message_not_found", async () => {
    const ctx = makeCtx();
    const client = ctx.client as unknown as ReturnType<typeof createMockClient>;
    client.chat.update.mockRejectedValueOnce(new Error("An API error occurred: message_not_found"));

    const result = await executeTool("edit_message", ctx, {
      message_ts: "9999.9",
      text: "Updated",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("message not found");
  });

  it("rejects missing arguments", async () => {
    const ctx = makeCtx();
    const result = await executeTool("edit_message", ctx, { text: "Hello" });
    expect(result.success).toBe(false);
    expect(result.output).toContain("message_ts");
  });

  it("rejects empty text", async () => {
    const ctx = makeCtx();
    const result = await executeTool("edit_message", ctx, {
      message_ts: "1000.1",
      text: "  ",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("text");
  });
});
