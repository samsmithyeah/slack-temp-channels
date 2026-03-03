import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerExportAction } from "../../src/actions/export";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

function setupExportClient(client: ReturnType<typeof createMockClient>, userId: string) {
  // Default: user is a member of the channel
  client.conversations.members.mockResolvedValue({ members: [userId] });
}

describe("registerExportAction", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registerExportAction(app as unknown as App);
  });

  describe("home_export action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:/^home_export_/"]).toBeDefined();
    });

    it("acks and opens the export modal with channel info", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:/^home_export_/"]({
        ack,
        body: {
          trigger_id: "T_EXPORT",
          user: { id: "U_USER" },
          actions: [{ type: "button", value: "C_CHAN:my-channel" }],
        },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: "T_EXPORT",
          view: expect.objectContaining({
            callback_id: "export_submit",
            private_metadata: "C_CHAN:my-channel",
          }),
        }),
      );
    });

    it("handles channel names with colons in value", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:/^home_export_/"]({
        ack,
        body: {
          trigger_id: "T_EXPORT",
          user: { id: "U_USER" },
          actions: [{ type: "button", value: "C_CHAN:name:with:colons" }],
        },
        client,
        logger: createMockLogger(),
      });

      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({
          view: expect.objectContaining({
            private_metadata: "C_CHAN:name:with:colons",
          }),
        }),
      );
    });
  });

  describe("export_submit view", () => {
    it("registers the view handler", () => {
      expect(app.handlers["view:export_submit"]).toBeDefined();
    });

    it("opens a DM conversation before uploading", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockResolvedValue({
        messages: [{ user: "U1", text: "Hello", ts: "1700000000.000000" }],
        response_metadata: {},
      });
      (client as unknown as Record<string, unknown>).users = {
        ...client.users,
        info: vi.fn().mockResolvedValue({
          user: { profile: { display_name: "Alice" }, real_name: "Alice Smith" },
        }),
      };

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:test-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(client.conversations.open).toHaveBeenCalledWith({ users: "U_REQUESTER" });
    });

    it("verifies user membership before exporting", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockResolvedValue({
        messages: [{ user: "U1", text: "Hello", ts: "1700000000.000000" }],
        response_metadata: {},
      });
      (client as unknown as Record<string, unknown>).users = {
        ...client.users,
        info: vi.fn().mockResolvedValue({
          user: { profile: { display_name: "Alice" } },
        }),
      };

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:test-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(client.conversations.members).toHaveBeenCalledWith({ channel: "C_CHAN" });
      expect(client.filesUploadV2).toHaveBeenCalled();
    });

    it("rejects export when user is not a member", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      client.conversations.members.mockResolvedValue({ members: ["U_OTHER"] });

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:secret-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(client.filesUploadV2).not.toHaveBeenCalled();
      expect(client.conversations.history).not.toHaveBeenCalled();
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "D_DM",
          text: expect.stringContaining("don't have access"),
        }),
      );
    });

    it("exports as plain text using the DM channel ID", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockResolvedValue({
        messages: [{ user: "U1", text: "Hello world", ts: "1700000000.000000" }],
        response_metadata: {},
      });
      (client as unknown as Record<string, unknown>).users = {
        ...client.users,
        info: vi.fn().mockResolvedValue({
          user: { profile: { display_name: "Alice" }, real_name: "Alice Smith" },
        }),
      };

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:test-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: "D_DM",
          filename: "test-channel.txt",
          content: expect.stringContaining("Alice"),
        }),
      );
    });

    it("exports as JSON when json format selected", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockResolvedValue({
        messages: [{ user: "U1", text: "Hello", ts: "1700000000.000000" }],
        response_metadata: {},
      });
      (client as unknown as Record<string, unknown>).users = {
        ...client.users,
        info: vi.fn().mockResolvedValue({
          user: { profile: { display_name: "Bob" }, real_name: "Bob" },
        }),
      };

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:test-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "json" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(client.filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: "D_DM",
          filename: "test-channel.json",
          content: expect.stringContaining('"channel"'),
        }),
      );
    });

    it("sends DM when channel has no messages", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockResolvedValue({
        messages: [],
        response_metadata: {},
      });

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:empty-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger: createMockLogger(),
      });

      expect(client.filesUploadV2).not.toHaveBeenCalled();
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "D_DM",
          text: expect.stringContaining("No messages found"),
        }),
      );
    });

    it("DMs user on export error", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      const logger = createMockLogger();
      setupExportClient(client, "U_REQUESTER");
      client.conversations.history.mockRejectedValue(new Error("API failure"));

      await app.handlers["view:export_submit"]({
        ack,
        view: {
          private_metadata: "C_CHAN:broken-channel",
          state: {
            values: {
              export_format: {
                export_format_input: { selected_option: { value: "text" } },
              },
            },
          },
        },
        body: { user: { id: "U_REQUESTER" } },
        client,
        logger,
      });

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to export conversation:",
        expect.any(Error),
      );
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "D_DM",
          text: expect.stringContaining("couldn't export"),
        }),
      );
    });
  });
});
