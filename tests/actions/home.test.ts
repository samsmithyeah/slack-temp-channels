import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _clearCacheForTesting, registerHomeHandlers } from "../../src/actions/home";
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
          items: [
            { message: { user: "U_BOT", text: "*<@U_VISITOR> created this temporary channel.*" } },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            { message: { user: "U_BOT", text: "*<@U_OTHER> created this temporary channel.*" } },
          ],
        });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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
          items: [
            { message: { user: "U_BOT", text: "*<@U_VISITOR> created this temporary channel.*" } },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            { message: { user: "U_BOT", text: "*<@U_OTHER> created this temporary channel.*" } },
          ],
        });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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

      // Find the "Channels you created" header index
      const createdHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Channels you created",
      );
      // Find the "Your dash channels" header index
      const memberHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Your dash channels",
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

    it("shows empty state messages when no channels exist", async () => {
      const client = createMockClient();

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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
        client,
        logger: createMockLogger(),
      });

      // Only the dash channel should trigger a pins check
      expect(client.pins.list).toHaveBeenCalledTimes(1);
      expect(client.pins.list).toHaveBeenCalledWith(expect.objectContaining({ channel: "C_DASH" }));
    });

    it("includes jump and close buttons for channels the user created", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [{ id: "C_DASH1", name: "-project" }],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({
        items: [
          { message: { user: "U_BOT", text: "*<@U_VISITOR> created this temporary channel.*" } },
        ],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
        client,
        logger: createMockLogger(),
      });

      const viewArg = client.views.publish.mock.calls[0][0] as {
        view: {
          blocks: Array<{
            type: string;
            elements?: Array<{ action_id?: string; url?: string; value?: string }>;
          }>;
        };
      };
      const blocks = viewArg.view.blocks;
      const channelActions = blocks.filter(
        (b) =>
          b.type === "actions" && b.elements?.some((el) => el.action_id?.startsWith("home_jump_")),
      );

      expect(channelActions).toHaveLength(1);
      const elements = channelActions[0].elements!;

      const jumpBtn = elements.find((el) => el.action_id === "home_jump_C_DASH1");
      expect(jumpBtn).toBeDefined();
      expect(jumpBtn!.url).toContain("C_DASH1");

      const closeBtn = elements.find((el) => el.action_id === "home_close_C_DASH1");
      expect(closeBtn).toBeDefined();
      expect(closeBtn!.value).toBe("C_DASH1");
    });

    it("does not show Close button for channels the user did not create", async () => {
      const client = createMockClient();

      client.users.conversations.mockResolvedValue({
        channels: [{ id: "C_OTHER", name: "-their-project" }],
        response_metadata: {},
      });
      client.pins.list.mockResolvedValue({
        items: [
          { message: { user: "U_BOT", text: "*<@U_OTHER> created this temporary channel.*" } },
        ],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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

      // Find the "Your dash channels" section actions
      const memberHeaderIdx = blocks.findIndex(
        (b) => b.type === "header" && b.text?.text === "Your dash channels",
      );
      const memberActions = blocks
        .slice(memberHeaderIdx)
        .filter(
          (b) =>
            b.type === "actions" &&
            b.elements?.some((el) => el.action_id?.startsWith("home_jump_")),
        );

      expect(memberActions).toHaveLength(1);
      const elements = memberActions[0].elements!;

      // Should have Jump but NOT Close
      expect(elements.find((el) => el.action_id === "home_jump_C_OTHER")).toBeDefined();
      expect(elements.find((el) => el.action_id?.startsWith("home_close_"))).toBeUndefined();
    });

    it("publishes with empty lists and logs error when fetchDashChannels throws", async () => {
      const client = createMockClient();
      const logger = createMockLogger();

      client.users.conversations.mockRejectedValue(new Error("API failure"));

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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
        items: [
          { message: { user: "U_BOT", text: "*<@U_VISITOR> created this temporary channel.*" } },
        ],
      });

      await app.handlers["event:app_home_opened"]({
        event: { user: "U_VISITOR" },
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

  describe("home_jump action", () => {
    it("registers the action handler", () => {
      expect(app.handlers["action:/^home_jump_/"]).toBeDefined();
    });

    it("acknowledges the action", async () => {
      const ack = vi.fn();

      await app.handlers["action:/^home_jump_/"]({ ack });

      expect(ack).toHaveBeenCalled();
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
        items: [
          { message: { user: "U_BOT", text: "*<@U_CLOSER> created this temporary channel.*" } },
        ],
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: { user: { id: "U_CLOSER" }, actions: [{ type: "button", value: "C_TARGET" }] },
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
        items: [
          { message: { user: "U_BOT", text: "*<@U_CLOSER> created this temporary channel.*" } },
        ],
      });
      client.conversations.archive.mockRejectedValue({
        data: { error: "not_authorized" },
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: { user: { id: "U_CLOSER" }, actions: [{ type: "button", value: "C_TARGET" }] },
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
              text: "*<@U_ACTUAL_CREATOR> created this temporary channel.*",
            },
          },
        ],
      });

      await app.handlers["action:/^home_close_/"]({
        ack,
        body: { user: { id: "U_ATTACKER" }, actions: [{ type: "button", value: "C_TARGET" }] },
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
  });
});
