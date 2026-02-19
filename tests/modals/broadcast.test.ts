import { describe, expect, it } from "vitest";
import { broadcastModal } from "../../src/modals/broadcast";
import { findInputBlock, getBlockIds } from "../helpers/blocks";

describe("broadcastModal", () => {
  it("returns a modal view with correct callback_id", () => {
    const view = broadcastModal("C_SOURCE");
    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("broadcast_submit");
  });

  it("stores sourceChannelId in private_metadata", () => {
    const view = broadcastModal("C_SOURCE");
    expect(view.private_metadata).toBe("C_SOURCE");
  });

  it("has destination_channel and outcome blocks", () => {
    const view = broadcastModal("C_SOURCE");
    const blockIds = getBlockIds(view.blocks);
    expect(blockIds).toContain("destination_channel");
    expect(blockIds).toContain("outcome");
  });

  it("destination channel is a conversations_select filtered to public", () => {
    const view = broadcastModal("C_SOURCE");
    const destBlock = findInputBlock(view.blocks, "destination_channel");
    expect(destBlock.element.type).toBe("conversations_select");
    const filter = destBlock.element.filter as { include: string[] };
    expect(filter.include).toContain("public");
  });

  it("outcome input is multiline", () => {
    const view = broadcastModal("C_SOURCE");
    const outcomeBlock = findInputBlock(view.blocks, "outcome");
    expect(outcomeBlock.element.multiline).toBe(true);
  });

  it("sets initial_conversation when defaultDestinationChannelId is provided", () => {
    const view = broadcastModal("C_SOURCE", "C_ORIGIN");
    const destBlock = findInputBlock(view.blocks, "destination_channel");
    expect(destBlock.element.initial_conversation).toBe("C_ORIGIN");
  });

  it("omits initial_conversation when no defaultDestinationChannelId", () => {
    const view = broadcastModal("C_SOURCE");
    const destBlock = findInputBlock(view.blocks, "destination_channel");
    expect(destBlock.element.initial_conversation).toBeUndefined();
  });

  it("includes the AI summary button block", () => {
    const view = broadcastModal("C_SOURCE");
    const blockIds = getBlockIds(view.blocks);
    expect(blockIds).toContain("ai_actions");
  });

  it("AI button has correct action_id", () => {
    const view = broadcastModal("C_SOURCE");
    const aiBlock = view.blocks.find((b) => "block_id" in b && b.block_id === "ai_actions") as
      | { elements: Array<{ action_id: string }> }
      | undefined;
    expect(aiBlock).toBeDefined();
    expect(aiBlock!.elements[0].action_id).toBe("generate_ai_summary");
  });

  it("sets initial_value on outcome when initialOutcome is provided", () => {
    const view = broadcastModal("C_SOURCE", undefined, "AI summary text");
    const outcomeBlock = findInputBlock(view.blocks, "outcome");
    expect(outcomeBlock.element.initial_value).toBe("AI summary text");
  });

  it("omits initial_value on outcome when initialOutcome is not provided", () => {
    const view = broadcastModal("C_SOURCE");
    const outcomeBlock = findInputBlock(view.blocks, "outcome");
    expect(outcomeBlock.element.initial_value).toBeUndefined();
  });

  it("hides AI button when hideAiButton is true", () => {
    const view = broadcastModal("C_SOURCE", undefined, "Loading...", true);
    const blockIds = getBlockIds(view.blocks);
    expect(blockIds).not.toContain("ai_actions");
  });
});
