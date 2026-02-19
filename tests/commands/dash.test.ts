import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDashCommand } from "../../src/commands/dash";
import {
  CHANNEL_PREFIX,
  CHANNEL_TOPIC,
  ERR_CHANNEL_SETUP,
  ORIGIN_MSG_TEXT,
} from "../../src/constants";
import { findInputBlock } from "../helpers/blocks";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

describe("registerDashCommand", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registerDashCommand(app as unknown as App);
  });

  describe("/dash command", () => {
    it("registers a /dash command handler", () => {
      expect(app.handlers["command:/dash"]).toBeDefined();
    });

    it("acks and opens the create modal", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["command:/dash"]({
        ack,
        body: { trigger_id: "T123", text: "", user_id: "UCMD", channel_id: "C_CMD" },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({ trigger_id: "T123" }),
      );
    });

    it("passes channel_id as private_metadata on the modal", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["command:/dash"]({
        ack,
        body: { trigger_id: "T123", text: "", user_id: "UCMD", channel_id: "C_CMD" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as {
        view: { private_metadata?: string };
      };
      expect(viewArg.view.private_metadata).toBe("C_CMD");
    });

    it("preselects the command invoker in the invite list", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["command:/dash"]({
        ack,
        body: { trigger_id: "T123", text: "", user_id: "UCMD" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as { view: { blocks: unknown[] } };
      const usersBlock = findInputBlock(
        viewArg.view.blocks as Parameters<typeof findInputBlock>[0],
        "invite_users",
      );
      expect(usersBlock.element.initial_users).toContain("UCMD");
    });

    it("includes mentioned users alongside the invoker", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["command:/dash"]({
        ack,
        body: { trigger_id: "T123", text: "<@U111> <@U222>", user_id: "UCMD" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as { view: { blocks: unknown[] } };
      const usersBlock = findInputBlock(
        viewArg.view.blocks as Parameters<typeof findInputBlock>[0],
        "invite_users",
      );
      expect(usersBlock.element.initial_users).toEqual(["UCMD", "U111", "U222"]);
    });

    it("does not duplicate invoker when they mention themselves", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["command:/dash"]({
        ack,
        body: { trigger_id: "T123", text: "<@UCMD> <@U111>", user_id: "UCMD" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as { view: { blocks: unknown[] } };
      const usersBlock = findInputBlock(
        viewArg.view.blocks as Parameters<typeof findInputBlock>[0],
        "invite_users",
      );
      expect(usersBlock.element.initial_users).toEqual(["UCMD", "U111"]);
    });
  });

  describe("create_channel view submission", () => {
    function makeViewPayload(overrides: Record<string, unknown> = {}) {
      return {
        ack: vi.fn(),
        body: { user: { id: "UCREATOR" } },
        view: {
          private_metadata: "",
          state: {
            values: {
              channel_name: { channel_name_input: { value: "my channel" } },
              invite_users: { invite_users_input: { selected_users: ["U1", "U2"] } },
              purpose: { purpose_input: { value: null } },
            },
          },
        },
        client: createMockClient(),
        logger: createMockLogger(),
        ...overrides,
      };
    }

    it("registers a create_channel view handler", () => {
      expect(app.handlers["view:create_channel"]).toBeDefined();
    });

    it("creates channel with prefix and slugified name", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      expect(payload.client.conversations.create).toHaveBeenCalledWith({
        name: `${CHANNEL_PREFIX}my-channel`,
      });
    });

    it("acks after successful channel creation", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);
      expect(payload.ack).toHaveBeenCalled();
    });

    it("adds creator to invite list if not already present", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      const inviteCall = payload.client.conversations.invite.mock.calls[0][0] as { users: string };
      expect(inviteCall.users).toContain("UCREATOR");
    });

    it("does not duplicate creator in invite list", async () => {
      const payload = makeViewPayload({
        view: {
          state: {
            values: {
              channel_name: { channel_name_input: { value: "test" } },
              invite_users: { invite_users_input: { selected_users: ["UCREATOR", "U1"] } },
              purpose: { purpose_input: { value: null } },
            },
          },
        },
      });
      await app.handlers["view:create_channel"](payload);

      const inviteCall = payload.client.conversations.invite.mock.calls[0][0] as { users: string };
      const ids = inviteCall.users.split(",");
      const creatorCount = ids.filter((id: string) => id === "UCREATOR").length;
      expect(creatorCount).toBe(1);
    });

    it("sets topic on the channel", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      expect(payload.client.conversations.setTopic).toHaveBeenCalledWith({
        channel: "C_NEW",
        topic: CHANNEL_TOPIC,
      });
    });

    it("sets purpose when provided", async () => {
      const payload = makeViewPayload({
        view: {
          state: {
            values: {
              channel_name: { channel_name_input: { value: "test" } },
              invite_users: { invite_users_input: { selected_users: ["U1"] } },
              purpose: { purpose_input: { value: "Ship it" } },
            },
          },
        },
      });
      await app.handlers["view:create_channel"](payload);

      expect(payload.client.conversations.setPurpose).toHaveBeenCalledWith({
        channel: "C_NEW",
        purpose: "Ship it",
      });
    });

    it("posts a welcome message", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      expect(payload.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C_NEW" }),
      );
    });

    it("pins the welcome message", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      expect(payload.client.pins.add).toHaveBeenCalledWith({
        channel: "C_NEW",
        timestamp: "1234567890.123456",
      });
    });

    it("rejects empty channel name with validation error", async () => {
      const payload = makeViewPayload({
        view: {
          state: {
            values: {
              channel_name: { channel_name_input: { value: "!!!" } },
              invite_users: { invite_users_input: { selected_users: ["U1"] } },
              purpose: { purpose_input: { value: null } },
            },
          },
        },
      });
      await app.handlers["view:create_channel"](payload);

      expect(payload.ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: expect.objectContaining({
            channel_name: expect.stringContaining("at least one letter or number"),
          }),
        }),
      );
      expect(payload.client.conversations.create).not.toHaveBeenCalled();
    });

    it("returns name_taken error on duplicate channel name", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.create.mockRejectedValueOnce({
        data: { error: "name_taken" },
      });

      await app.handlers["view:create_channel"](payload);

      expect(payload.ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: expect.objectContaining({
            channel_name: expect.stringContaining("already exists"),
          }),
        }),
      );
    });

    it("returns generic error on other creation failures", async () => {
      const payload = makeViewPayload();
      payload.client.conversations.create.mockRejectedValueOnce(new Error("network error"));

      await app.handlers["view:create_channel"](payload);

      expect(payload.ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: expect.objectContaining({
            channel_name: expect.stringContaining("try again"),
          }),
        }),
      );
    });

    it("posts notification to origin channel when private_metadata is set", async () => {
      const payload = makeViewPayload({
        view: {
          private_metadata: "C_ORIGIN",
          state: {
            values: {
              channel_name: { channel_name_input: { value: "test" } },
              invite_users: { invite_users_input: { selected_users: ["U1"] } },
              purpose: { purpose_input: { value: null } },
            },
          },
        },
      });
      await app.handlers["view:create_channel"](payload);

      const calls = payload.client.chat.postMessage.mock.calls;
      const originCall = calls.find((c: { channel: string }[]) => c[0].channel === "C_ORIGIN");
      expect(originCall).toBeDefined();
      expect(originCall![0]).toMatchObject({
        channel: "C_ORIGIN",
        text: ORIGIN_MSG_TEXT,
      });
    });

    it("includes purpose block in origin notification when purpose is provided", async () => {
      const payload = makeViewPayload({
        view: {
          private_metadata: "C_ORIGIN",
          state: {
            values: {
              channel_name: { channel_name_input: { value: "test" } },
              invite_users: { invite_users_input: { selected_users: ["U1"] } },
              purpose: { purpose_input: { value: "Ship it" } },
            },
          },
        },
      });
      await app.handlers["view:create_channel"](payload);

      const calls = payload.client.chat.postMessage.mock.calls;
      const originCall = calls.find((c: { channel: string }[]) => c[0].channel === "C_ORIGIN");
      const blocks = originCall![0].blocks;
      const purposeBlock = blocks.find(
        (b: { type: string; text?: { text: string } }) =>
          b.type === "section" && b.text?.text.includes("*Purpose:*"),
      );
      expect(purposeBlock).toBeDefined();
      expect(purposeBlock.text.text).toBe("*Purpose:* Ship it");
    });

    it("does not post setup error when origin notification fails", async () => {
      const payload = makeViewPayload({
        view: {
          private_metadata: "C_ORIGIN",
          state: {
            values: {
              channel_name: { channel_name_input: { value: "test" } },
              invite_users: { invite_users_input: { selected_users: ["U1"] } },
              purpose: { purpose_input: { value: null } },
            },
          },
        },
      });

      // First postMessage (welcome) succeeds, second (origin notification) fails
      payload.client.chat.postMessage
        .mockResolvedValueOnce({ ts: "1234567890.123456" })
        .mockRejectedValueOnce(new Error("channel_not_found"));

      await app.handlers["view:create_channel"](payload);

      // Welcome message was still posted and pinned
      expect(payload.client.pins.add).toHaveBeenCalled();
      // Setup error was NOT posted to the new channel
      const calls = payload.client.chat.postMessage.mock.calls;
      const setupErrorCall = calls.find(
        (c: { channel: string; text: string }[]) =>
          c[0].channel === "C_NEW" && c[0].text === ERR_CHANNEL_SETUP,
      );
      expect(setupErrorCall).toBeUndefined();
      // Error was logged
      expect(payload.logger.error).toHaveBeenCalledWith(
        "Failed to notify origin channel:",
        expect.any(Error),
      );
    });

    it("does not post origin notification when private_metadata is empty", async () => {
      const payload = makeViewPayload();
      await app.handlers["view:create_channel"](payload);

      const calls = payload.client.chat.postMessage.mock.calls;
      // Only the welcome message to C_NEW, no origin notification
      expect(calls).toHaveLength(1);
      expect(calls[0][0].channel).toBe("C_NEW");
    });
  });
});
