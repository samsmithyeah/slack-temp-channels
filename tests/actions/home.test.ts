import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _clearCacheForTesting, registerHomeHandlers } from "../../src/actions/home";
import { CREATOR_MSG_TEXT } from "../../src/constants";
import { findInputBlock } from "../helpers/blocks";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

describe("registerHomeHandlers", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    _clearCacheForTesting();
    app = createMockApp();
    registerHomeHandlers(app as unknown as App);
  });

  describe("app_home_opened event", () => {
    it("registers the event handler", () => {
      expect(app.handlers["event:app_home_opened"]).toBeDefined();
    });

    it("publishes a home view for the user", async () => {
      const client = createMockClient();

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      expect(client.views.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "U_VISITOR",
          view: expect.objectContaining({ type: "home" }),
        }),
      );
    });

    it("includes a create button with action_id home_create_dash", async () => {
      const client = createMockClient();

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: { blocks: Array<{ type: string; elements?: Array<{ action_id?: string }> }> };
      };
      const actionsBlock = viewArg.view.blocks.find((b) => b.type === "actions");
      expect(actionsBlock).toBeDefined();
      const actionIds = actionsBlock!.elements!.map((el) => el.action_id);
      expect(actionIds).toContain("home_create_dash");
    });

    it("shows channels the user created in the 'Channels you created' section", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [
          { id: "C_CREATED", name: "-my-project" },
          { id: "C_MEMBER", name: "-other-project" },
        ],
        response_metadata: {},
      });
      client.pins.list
        .mockResolvedValueOnce({
          items: [{ message: { user: "U_BOT", text: `<@U_VISITOR> ${CREATOR_MSG_TEXT}` } }],
        })
        .mockResolvedValueOnce({
          items: [{ message: { user: "U_BOT", text: `<@U_OTHER> ${CREATOR_MSG_TEXT}` } }],
        });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: { blocks: Array<{ type: string; text?: { text: string } }> };
      };
      const blocks = viewArg.view.blocks;
      const channelMentions = blocks
        .filter((b) => b.type === "section" && b.text?.text?.startsWith("<#"))
        .map((b) => b.text!.text);

      expect(channelMentions).toContain("<#C_CREATED>");
      expect(channelMentions).toContain("<#C_MEMBER>");
    });

    it("separates created channels from member-of channels", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [
          { id: "C_CREATED", name: "-mine" },
          { id: "C_OTHER", name: "-theirs" },
        ],
        response_metadata: {},
      });
      client.pins.list
        .mockResolvedValueOnce({
          items: [{ message: { user: "U_BOT", text: `<@U_VISITOR> ${CREATOR_MSG_TEXT}` } }],
        })
        .mockResolvedValueOnce({
          items: [{ message: { user: "U_BOT", text: `<@U_OTHER> ${CREATOR_MSG_TEXT}` } }],
        });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: {
          blocks: Array<{
            type: string;
            text?: { type: string; text: string };
            elements?: Array<{ action_id?: string; value?: string }>;
          }>;
        };
      };
      const blocks = viewArg.view.blocks;

      // Find the "Dash channels you created" header index
      const createdHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Dash channels you created",
      );
      // Find the "Other dash channels you're a member of" header index
      const memberHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Other dash channels you're a member of",
      );

      expect(createdHeaderIdx).toBeGreaterThan(-1);
      expect(memberHeaderIdx).toBeGreaterThan(createdHeaderIdx);

      // C_CREATED should appear between created header and member header
      const createdSection = blocks.slice(createdHeaderIdx, memberHeaderIdx);
      const createdChannels = createdSection
        .filter((b) => b.type === "section" && b.text?.text?.startsWith("<#"))
        .map((b) => b.text!.text);
      expect(createdChannels).toEqual(["<#C_CREATED>"]);

      // C_OTHER should appear after member header
      const memberSection = blocks.slice(memberHeaderIdx);
      const memberChannels = memberSection
        .filter((b) => b.type === "section" && b.text?.text?.startsWith("<#"))
        .map((b) => b.text!.text);
      expect(memberChannels).toEqual(["<#C_OTHER>"]);
    });

    it("detects creator from legacy pin text format", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [{ id: "C_LEGACY", name: "-old-channel" }],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: "Temporary channel created by <@U_VISITOR>" } }],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: {
          blocks: Array<{
            type: string;
            text?: { type: string; text: string };
            elements?: Array<{ action_id?: string }>;
          }>;
        };
      };
      const blocks = viewArg.view.blocks;

      // Should be in "Dash channels you created" with action buttons
      const createdHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Dash channels you created",
      );
      const memberHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Other dash channels you're a member of",
      );
      const createdBlocks = blocks.slice(createdHeaderIdx, memberHeaderIdx);
      const createdSections = createdBlocks.filter(
        (b) => b.type === "section" && b.text?.text?.startsWith("<#"),
      );
      expect(createdSections).toHaveLength(1);
      expect(createdSections[0].text?.text).toBe("<#C_LEGACY>");
      // Should have an actions block with close buttons
      const actionBlocks = createdBlocks.filter((b) => b.type === "actions");
      expect(actionBlocks).toHaveLength(1);
    });

    it("shows empty state messages when no channels exist", async () => {
      const client = createMockClient();

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: { blocks: Array<{ type: string; text?: { text: string } }> };
      };
      const blocks = viewArg.view.blocks;
      const sectionTexts = blocks.filter((b) => b.type === "section").map((b) => b.text?.text);

      expect(sectionTexts).toContain("_You haven't created any dash channels yet._");
      expect(sectionTexts).toContain("_You're not a member of any other dash channels._");
    });

    it("filters out non-dash channels", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [
          { id: "C_DASH", name: "-temp-channel" },
          { id: "C_REGULAR", name: "general" },
        ],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({ items: [] });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      // Only the dash channel should trigger a pins check
      expect(client.pins.list).toHaveBeenCalledTimes(1);
      expect(client.pins.list).toHaveBeenCalledWith(expect.objectContaining({ channel: "C_DASH" }));
    });

    it("includes Broadcast & Close and Close channel buttons for creator channels", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [{ id: "C_DASH1", name: "-project" }],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: `<@U_VISITOR> ${CREATOR_MSG_TEXT}` } }],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: {
          blocks: Array<{
            type: string;
            text?: { type: string; text: string };
            elements?: Array<{ action_id?: string; value?: string; text?: { text: string } }>;
          }>;
        };
      };
      const blocks = viewArg.view.blocks;

      // Find the actions block following the channel section
      const sectionIdx = blocks.findIndex(
        (b) => b.type === "section" && b.text?.text === "<#C_DASH1>",
      );
      expect(sectionIdx).toBeGreaterThan(-1);
      const actionsBlock = blocks[sectionIdx + 1];
      expect(actionsBlock.type).toBe("actions");

      const elements = actionsBlock.elements!;
      expect(elements).toHaveLength(2);

      // Broadcast & Close button
      expect(elements[0].action_id).toBe("home_broadcast_close_C_DASH1");
      expect(elements[0].value).toBe("C_DASH1");

      // Close channel button
      expect(elements[1].action_id).toBe("home_close_C_DASH1");
      expect(elements[1].value).toBe("C_DASH1");
    });

    it("does not show action buttons for channels the user did not create", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [{ id: "C_OTHER", name: "-their-project" }],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: `<@U_OTHER> ${CREATOR_MSG_TEXT}` } }],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: {
          blocks: Array<{
            type: string;
            text?: { type: string; text: string };
            elements?: Array<{ action_id?: string }>;
          }>;
        };
      };
      const blocks = viewArg.view.blocks;

      // Find blocks in "Other dash channels" section
      const memberHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Other dash channels you're a member of",
      );
      const memberBlocks = blocks.slice(memberHeaderIdx);

      // Should have the channel section but no actions block
      const sections = memberBlocks.filter(
        (b) => b.type === "section" && b.text?.text?.startsWith("<#"),
      );
      expect(sections).toHaveLength(1);
      const actionBlocks = memberBlocks.filter((b) => b.type === "actions");
      expect(actionBlocks).toHaveLength(0);
    });

    it("logs error and skips publish when teamId is missing", async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: {},
        client,
        logger,
      });

      expect(logger.error).toHaveBeenCalledWith("Missing teamId in app_home_opened event");
      expect(client.views.publish).not.toHaveBeenCalled();
    });

    it("publishes with empty lists and logs error when fetchDashChannels throws", async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      client.users.conversations.mockRejectedValue(new Error("API failure"));

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger,
      });

      // Should still publish a home view
      expect(client.views.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "U_VISITOR",
          view: expect.objectContaining({ type: "home" }),
        }),
      );

      // Should show empty state messages
      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: { blocks: Array<{ type: string; text?: { text: string } }> };
      };
      const sectionTexts = viewArg.view.blocks
        .filter((b) => b.type === "section")
        .map((b) => b.text?.text);
      expect(sectionTexts).toContain("_You haven't created any dash channels yet._");
      expect(sectionTexts).toContain("_You're not a member of any other dash channels._");

      // Should log the error
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to fetch dash channels for home view:",
        expect.any(Error),
      );
    });

    it("paginates through all pages of users.conversations", async () => {
      const client = createMockClient();

      client.users.conversations
        .mockResolvedValueOnce({
          channels: [{ id: "C_PAGE1", name: "-page1" }],
          response_metadata: { next_cursor: "cursor_abc" },
        })
        .mockResolvedValueOnce({
          channels: [{ id: "C_PAGE2", name: "-page2" }],
          response_metadata: {},
        });
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: `<@U_VISITOR> ${CREATOR_MSG_TEXT}` } }],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        context: { teamId: "T_TEAM" },
        client,
        logger: createMockLogger(),
      });

      // Should have called users.conversations twice (once per page)
      expect(client.users.conversations).toHaveBeenCalledTimes(2);
      expect(client.users.conversations).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "cursor_abc" }),
      );

      // Both channels should appear in the view
      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: { blocks: Array<{ type: string; text?: { text: string } }> };
      };
      const channelMentions = viewArg.view.blocks
        .filter((b) => b.type === "section" && b.text?.text?.startsWith("<#"))
        .map((b) => b.text!.text);
      expect(channelMentions).toContain("<#C_PAGE1>");
      expect(channelMentions).toContain("<#C_PAGE2>");
    });
  });

  describe("home_create_dash action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:home_create_dash"]).toBeDefined();
    });

    it("acks and opens the create channel modal", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:home_create_dash"]({
        ack,
        body: { trigger_id: "T_HOME", user: { id: "UHOME" } },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: "T_HOME",
          view: expect.objectContaining({ callback_id: "create_channel" }),
        }),
      );
    });

    it("preselects the user in the invite list", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:home_create_dash"]({
        ack,
        body: { trigger_id: "T_HOME", user: { id: "UHOME" } },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.open.mock.calls[0][0] as { view: { blocks: unknown[] } };
      const usersBlock = findInputBlock(
        viewArg.view.blocks as Parameters<typeof findInputBlock>[0],
        "invite_users",
      );
      expect(usersBlock.element.initial_users).toEqual(["UHOME"]);
    });
  });

  describe("home_broadcast_close action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:/^home_broadcast_close_/"]).toBeDefined();
    });

    it("acks and opens the broadcast modal with the channel ID", async () => {
      const ack = vi.fn();
      const client = createMockClient();

      await app.handlers["action:/^home_broadcast_close_/"]({
        ack,
        body: {
          trigger_id: "T_BROADCAST",
          user: { id: "U_CREATOR" },
          actions: [{ type: "button", value: "C_TARGET" }],
        },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.views.open).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: "T_BROADCAST",
          view: expect.objectContaining({
            callback_id: "broadcast_submit",
            private_metadata: "C_TARGET",
          }),
        }),
      );
    });
  });

  describe("home_close action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:/^home_close_/"]).toBeDefined();
    });

    it("posts a close message, archives the channel, and refreshes the view", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: `<@U_CLOSER> ${CREATOR_MSG_TEXT}` } }],
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: {
          team: { id: "T_TEAM" },
          user: { id: "U_CLOSER" },
          actions: [{ type: "button", value: "C_TARGET" }],
        },
        client,
        logger: createMockLogger(),
      });

      expect(ack).toHaveBeenCalled();
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_TARGET",
          text: expect.stringContaining("<@U_CLOSER>"),
        }),
      );
      expect(client.conversations.archive).toHaveBeenCalledWith({ channel: "C_TARGET" });
      // Home view should be refreshed
      expect(client.views.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "U_CLOSER",
          view: expect.objectContaining({ type: "home" }),
        }),
      );
    });

    it("handles archive permission errors", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      client.pins.list.mockResolvedValue({
        items: [{ message: { user: "U_BOT", text: `<@U_CLOSER> ${CREATOR_MSG_TEXT}` } }],
      });
      client.conversations.archive.mockRejectedValue({
        data: { error: "not_authorized" },
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: {
          team: { id: "T_TEAM" },
          user: { id: "U_CLOSER" },
          actions: [{ type: "button", value: "C_TARGET" }],
        },
        client,
        logger: createMockLogger(),
      });

      // Should post the permission error message
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_TARGET",
          text: expect.stringContaining("permission"),
        }),
      );
    });

    it("rejects close from a non-creator user", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      const logger = createMockLogger();
      client.pins.list.mockResolvedValue({
        items: [
          {
            message: {
              user: "U_BOT",
              text: `<@U_ACTUAL_CREATOR> ${CREATOR_MSG_TEXT}`,
            },
          },
        ],
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: {
          team: { id: "T_TEAM" },
          user: { id: "U_ATTACKER" },
          actions: [{ type: "button", value: "C_TARGET" }],
        },
        client,
        logger,
      });

      expect(ack).toHaveBeenCalled();
      // Should NOT archive or post a close message
      expect(client.conversations.archive).not.toHaveBeenCalled();
      expect(client.chat.postMessage).not.toHaveBeenCalled();
      // Should log the unauthorized attempt
      expect(logger.error).toHaveBeenCalledWith(
        "Unauthorized close attempt by",
        "U_ATTACKER",
        "on channel",
        "C_TARGET",
      );
      // Should send ephemeral feedback to the user
      expect(client.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C_TARGET",
          user: "U_ATTACKER",
          text: "Only the channel creator can close this channel.",
        }),
      );
    });

    it("logs error and returns early when teamId is missing", async () => {
      const ack = vi.fn();
      const client = createMockClient();
      const logger = createMockLogger();

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: {
          user: { id: "U_CLOSER" },
          actions: [{ type: "button", value: "C_TARGET" }],
        },
        client,
        logger,
      });

      expect(ack).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("Missing teamId in home_close action");
      expect(client.conversations.archive).not.toHaveBeenCalled();
    });
  });
});
