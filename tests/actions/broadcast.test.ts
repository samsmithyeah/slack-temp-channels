import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerBroadcastAction } from "../../src/actions/broadcast";
import { ERR_ARCHIVE_PERMISSION } from "../../src/constants";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

describe("registerBroadcastAction", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registerBroadcastAction(app as unknown as App);
  });

  describe("broadcast_and_close action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:broadcast_and_close"]).toBeDefined();
    });

    it("acks and opens the broadcast modal", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:broadcast_and_close"]({
        ack,
        body: { channel: { id: "C_SRC" }, trigger_id: "T123" },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: "T123",
          view: expect.objectContaining({
            callback_id: "broadcast_submit",
            private_metadata: "C_SRC",
          }),
        }),
      );
    });

    it("passes button value as default destination channel", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:broadcast_and_close"]({
        ack,
        body: {
          channel: { id: "C_SRC" },
          trigger_id: "T123",
          actions: [{ value: "C_ORIGIN" }],
        },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as {
        view: { blocks: Array<{ block_id: string; element: { initial_conversation?: string } }> };
      };
      const destBlock = viewArg.view.blocks.find((b) => b.block_id === "destination_channel");
      expect(destBlock!.element.initial_conversation).toBe("C_ORIGIN");
    });

    it("returns early when no channel ID", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:broadcast_and_close"]({
        ack,
        body: { channel: undefined, trigger_id: "T123" },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).not.toHaveBeenCalled();
    });
  });

  describe("broadcast_submit view submission", () => {
    function makeViewPayload(overrides: Record<string, unknown> = {}) {
      return {
        ack: vi.fn(),
        body: { user: { id: "USUBMITTER" } },
        view: {
          private_metadata: "C_SRC",
          state: {
            values: {
              destination_channel: {
                destination_channel_input: { selected_conversation: "C_DEST" },
              },
              outcome: { outcome_input: { value: "We decided X" } },
            },
          },
        },
        client: createMockClient(),
        logger: createMockLogger(),
        ...overrides,
      };
    }

    it("registers the view handler", () => {
      expect(app.handlers["view:broadcast_submit"]).toBeDefined();
    });

    it("acks the submission", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);
      expect(payload.ack).toHaveBeenCalled();
    });

    it("joins the destination channel", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.conversations.join).toHaveBeenCalledWith({
        channel: "C_DEST",
      });
    });

    it("ignores already_in_channel error when joining destination", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.join.mockRejectedValueOnce({
        data: { error: "already_in_channel" },
      });

      await app.handlers["view:broadcast_submit"](payload);

      // Broadcast should still succeed
      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C_DEST" }),
      );
    });

    it("posts summary to destination channel with blocks", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_DEST",
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: "section" }),
            expect.objectContaining({ type: "context" }),
          ]),
        }),
      );
    });

    it("includes outcome text in the summary", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);

      const destCall = payload.client.chat.postMessage.mock.calls.find(
        (call: unknown[]) => (call[0] as { channel: string }).channel === "C_DEST",
      );
      const blocks = (destCall![0] as { blocks: Array<{ type: string; text?: { text: string } }> })
        .blocks;
      const outcomeBlock = blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("Outcome"),
      );
      expect(outcomeBlock!.text!.text).toContain("We decided X");
    });

    it("posts close message in source channel", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_SRC",
          text: expect.stringContaining("<@USUBMITTER>"),
        }),
      );
    });

    it("archives the source channel", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.conversations.archive).toHaveBeenCalledWith({
        channel: "C_SRC",
      });
    });

    it("posts permission error when archive is not authorized", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.archive.mockRejectedValueOnce({
        data: { error: "not_authorized" },
      });

      await app.handlers["view:broadcast_submit"](payload);

      // Broadcast should still have been posted
      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C_DEST" }),
      );
      // Permission error message should be posted
      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_SRC",
          text: ERR_ARCHIVE_PERMISSION,
        }),
      );
    });

    it("posts permission error on restricted_action", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.archive.mockRejectedValueOnce({
        data: { error: "restricted_action" },
      });

      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: ERR_ARCHIVE_PERMISSION,
        }),
      );
    });

    it("does not archive when broadcast fails", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.join.mockRejectedValueOnce(new Error("channel_not_found"));

      await app.handlers["view:broadcast_submit"](payload);

      expect(payload.client.conversations.archive).not.toHaveBeenCalled();
    });
  });
});
