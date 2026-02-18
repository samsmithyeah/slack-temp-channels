import type { ModalView } from "@slack/types";
import { describe, expect, it } from "vitest";
import { createChannelModal } from "../../src/modals/create";
import { findInputBlock, getBlockIds } from "../helpers/blocks";

describe("createChannelModal", () => {
  it("returns a modal view with correct callback_id", () => {
    const view = createChannelModal();
    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("create_channel");
  });

  it("has submit and close buttons", () => {
    const view = createChannelModal() as ModalView;
    expect(view.submit!.text).toBe("Create");
    expect(view.close!.text).toBe("Cancel");
  });

  it("has channel_name, invite_users, and purpose blocks", () => {
    const view = createChannelModal();
    const blockIds = getBlockIds(view.blocks);
    expect(blockIds).toContain("channel_name");
    expect(blockIds).toContain("invite_users");
    expect(blockIds).toContain("purpose");
  });

  it("purpose block is optional", () => {
    const view = createChannelModal();
    const purposeBlock = findInputBlock(view.blocks, "purpose");
    expect(purposeBlock.optional).toBe(true);
  });

  it("sets initial_users when preselectedUserIds provided", () => {
    const view = createChannelModal(["U1", "U2"]);
    const usersBlock = findInputBlock(view.blocks, "invite_users");
    expect(usersBlock.element.initial_users).toEqual(["U1", "U2"]);
  });

  it("omits initial_users when no preselectedUserIds", () => {
    const view = createChannelModal();
    const usersBlock = findInputBlock(view.blocks, "invite_users");
    expect(usersBlock.element.initial_users).toBeUndefined();
  });

  it("omits initial_users when empty array", () => {
    const view = createChannelModal([]);
    const usersBlock = findInputBlock(view.blocks, "invite_users");
    expect(usersBlock.element.initial_users).toBeUndefined();
  });
});
