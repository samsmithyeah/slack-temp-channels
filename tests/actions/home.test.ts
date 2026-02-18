import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerHomeHandlers } from "../../src/actions/home";
import { findInputBlock } from "../helpers/blocks";
import { createMockApp, createMockClient, createMockLogger } from "../helpers/mock-app";

describe("registerHomeHandlers", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
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
});
