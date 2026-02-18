import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCloseAction } from "../../src/actions/close";
import { ERR_ARCHIVE_PERMISSION } from "../../src/constants";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

describe("registerCloseAction", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registerCloseAction(app as unknown as App);
  });

  it("registers a close_channel action handler", () => {
    expect(app.handlers["action:close_channel"]).toBeDefined();
  });

  it("acks the action", async () => {
    const ack = vi.fn();
    const client = createMockClient();

    await app.handlers["action:close_channel"]({
      ack,
      body: { channel: { id: "C123" }, user: { id: "U1" } },
      client,
      logger: createMockLogger(),
    });

    expect(ack).toHaveBeenCalled();
  });

  it("posts a close message and archives the channel", async () => {
    const ack = vi.fn();
    const client = createMockClient();

    await app.handlers["action:close_channel"]({
      ack,
      body: { channel: { id: "C123" }, user: { id: "U1" } },
      client,
      logger: createMockLogger(),
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: expect.stringContaining("<@U1>"),
      }),
    );
    expect(client.conversations.archive).toHaveBeenCalledWith({ channel: "C123" });
  });

  it("returns early when no channel ID", async () => {
    const ack = vi.fn();
    const client = createMockClient();

    await app.handlers["action:close_channel"]({
      ack,
      body: { channel: undefined, user: { id: "U1" } },
      client,
      logger: createMockLogger(),
    });

    expect(ack).toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.conversations.archive).not.toHaveBeenCalled();
  });

  it("posts permission error on not_authorized", async () => {
    const ack = vi.fn();
    const client = createMockClient();
    client.chat.postMessage.mockResolvedValueOnce({});
    client.conversations.archive.mockRejectedValueOnce({
      data: { error: "not_authorized" },
    });
    client.chat.postMessage.mockResolvedValueOnce({});

    await app.handlers["action:close_channel"]({
      ack,
      body: { channel: { id: "C123" }, user: { id: "U1" } },
      client,
      logger: createMockLogger(),
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: ERR_ARCHIVE_PERMISSION,
      }),
    );
  });

  it("posts permission error on restricted_action", async () => {
    const ack = vi.fn();
    const client = createMockClient();
    client.chat.postMessage.mockResolvedValueOnce({});
    client.conversations.archive.mockRejectedValueOnce({
      data: { error: "restricted_action" },
    });
    client.chat.postMessage.mockResolvedValueOnce({});

    await app.handlers["action:close_channel"]({
      ack,
      body: { channel: { id: "C123" }, user: { id: "U1" } },
      client,
      logger: createMockLogger(),
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ERR_ARCHIVE_PERMISSION,
      }),
    );
  });
});
