import type { ActionsBlock, SectionBlock } from "@slack/types";
import { describe, expect, it, vi } from "vitest";
import {
  getSlackErrorCode,
  isChannelMember,
  parseUserIds,
  slugify,
  welcomeBlocks,
} from "../src/utils";

describe("getSlackErrorCode", () => {
  it("extracts error code from Slack API error shape", () => {
    expect(getSlackErrorCode({ data: { error: "name_taken" } })).toBe("name_taken");
  });

  it("returns undefined for null", () => {
    expect(getSlackErrorCode(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(getSlackErrorCode(undefined)).toBeUndefined();
  });

  it("returns undefined for a plain Error", () => {
    expect(getSlackErrorCode(new Error("oops"))).toBeUndefined();
  });

  it("returns undefined when data is not an object", () => {
    expect(getSlackErrorCode({ data: "string" })).toBeUndefined();
  });

  it("returns undefined when data.error is not a string", () => {
    expect(getSlackErrorCode({ data: { error: 42 } })).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(getSlackErrorCode({})).toBeUndefined();
  });
});

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips special characters", () => {
    expect(slugify("foo@bar!baz")).toBe("foobarbaz");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("foo_bar")).toBe("foo-bar");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-foo-")).toBe("foo");
  });

  it("handles mixed whitespace", () => {
    expect(slugify("  hello   world  ")).toBe("hello-world");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("handles strings that are only special characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("parseUserIds", () => {
  it("extracts a single user ID", () => {
    expect(parseUserIds("<@U12345>")).toEqual(["U12345"]);
  });

  it("extracts multiple user IDs", () => {
    expect(parseUserIds("<@U111> <@U222> <@U333>")).toEqual(["U111", "U222", "U333"]);
  });

  it("handles username format <@U12345|alice>", () => {
    expect(parseUserIds("<@UABC123|alice>")).toEqual(["UABC123"]);
  });

  it("returns empty array when no mentions found", () => {
    expect(parseUserIds("hello world")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseUserIds("")).toEqual([]);
  });

  it("ignores malformed mentions", () => {
    expect(parseUserIds("<@invalid> <@U123>")).toEqual(["U123"]);
  });
});

describe("welcomeBlocks", () => {
  it("returns correct block structure", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1", "U2"]);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("section");
    expect(blocks[2].type).toBe("divider");
    expect(blocks[3].type).toBe("actions");
  });

  it("includes creator mention in first block", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const section = blocks[0] as SectionBlock;
    expect(section.text!.text).toContain("<@UCREATOR>");
  });

  it("includes purpose when provided", () => {
    const blocks = welcomeBlocks("UCREATOR", "Ship the feature", ["U1"]);
    const section = blocks[0] as SectionBlock;
    expect(section.text!.text).toContain("Ship the feature");
  });

  it("omits purpose line when undefined", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const section = blocks[0] as SectionBlock;
    expect(section.text!.text).not.toContain("Purpose");
  });

  it("lists invited users in second block", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1", "U2"]);
    const section = blocks[1] as SectionBlock;
    expect(section.text!.text).toContain("<@U1>");
    expect(section.text!.text).toContain("<@U2>");
  });

  it("has close_channel and broadcast_and_close action buttons", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const actions = blocks[3] as ActionsBlock;
    const actionIds = actions.elements.map((el) => ("action_id" in el ? el.action_id : undefined));
    expect(actionIds).toContain("close_channel");
    expect(actionIds).toContain("broadcast_and_close");
  });

  it("close button has danger style", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const actions = blocks[3] as ActionsBlock;
    const closeBtn = actions.elements.find(
      (el) => "action_id" in el && el.action_id === "close_channel",
    );
    expect(closeBtn).toBeDefined();
    expect("style" in closeBtn! && closeBtn.style).toBe("danger");
  });

  it("close button has confirmation dialog", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const actions = blocks[3] as ActionsBlock;
    const closeBtn = actions.elements.find(
      (el) => "action_id" in el && el.action_id === "close_channel",
    );
    expect(closeBtn).toBeDefined();
    expect("confirm" in closeBtn! && closeBtn.confirm).toBeDefined();
  });

  it("sets value on broadcast button when originChannelId is provided", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"], "C_ORIGIN");
    const actions = blocks[3] as ActionsBlock;
    const broadcastBtn = actions.elements.find(
      (el) => "action_id" in el && el.action_id === "broadcast_and_close",
    );
    expect(broadcastBtn).toBeDefined();
    expect("value" in broadcastBtn! && broadcastBtn.value).toBe("C_ORIGIN");
  });

  it("omits value on broadcast button when originChannelId is not provided", () => {
    const blocks = welcomeBlocks("UCREATOR", undefined, ["U1"]);
    const actions = blocks[3] as ActionsBlock;
    const broadcastBtn = actions.elements.find(
      (el) => "action_id" in el && el.action_id === "broadcast_and_close",
    );
    expect(broadcastBtn).toBeDefined();
    expect("value" in broadcastBtn!).toBe(false);
  });
});

describe("isChannelMember", () => {
  function mockClient(pages: { members: string[]; next_cursor?: string }[]) {
    const fn = vi.fn();
    for (const page of pages) {
      fn.mockResolvedValueOnce({
        members: page.members,
        response_metadata: { next_cursor: page.next_cursor },
      });
    }
    return { conversations: { members: fn } } as unknown as Parameters<
      typeof isChannelMember
    >[0] & { conversations: { members: ReturnType<typeof vi.fn> } };
  }

  it("returns true when user is in the first page", async () => {
    const client = mockClient([{ members: ["U1", "U2", "U3"] }]);
    expect(await isChannelMember(client, "C1", "U2")).toBe(true);
  });

  it("returns false when user is not in any page", async () => {
    const client = mockClient([{ members: ["U1", "U2"] }]);
    expect(await isChannelMember(client, "C1", "U_MISSING")).toBe(false);
  });

  it("paginates to find user on a later page", async () => {
    const client = mockClient([
      { members: ["U1", "U2"], next_cursor: "page2" },
      { members: ["U3", "U4"] },
    ]);
    expect(await isChannelMember(client, "C1", "U4")).toBe(true);
  });

  it("stops paginating once user is found", async () => {
    const client = mockClient([
      { members: ["U_TARGET"], next_cursor: "page2" },
      { members: ["U_OTHER"] },
    ]);
    await isChannelMember(client, "C1", "U_TARGET");
    expect(client.conversations.members).toHaveBeenCalledTimes(1);
  });
});
