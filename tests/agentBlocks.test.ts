import { describe, expect, it } from "vitest";
import { planBlocks, textSectionBlocks } from "../src/agentBlocks";
import type { AgentPlan } from "../src/services/agentPlanner";

describe("textSectionBlocks", () => {
  it("returns a single block for short text", () => {
    const blocks = textSectionBlocks("Hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "Hello world" },
    });
  });

  it("returns a single block for text exactly at the limit", () => {
    const text = "x".repeat(3000);
    const blocks = textSectionBlocks(text);
    expect(blocks).toHaveLength(1);
  });

  it("splits text over the 3000 char limit into multiple blocks", () => {
    const text = "x".repeat(6000);
    const blocks = textSectionBlocks(text);
    expect(blocks.length).toBeGreaterThan(1);

    // All block text should be within limit
    for (const block of blocks) {
      const b = block as { text: { text: string } };
      expect(b.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it("splits at newlines when possible", () => {
    // Build text with a newline near the 3000-char boundary
    const firstPart = "a".repeat(2990);
    const text = `${firstPart}\nbbbbbb${"c".repeat(3000)}`;
    const blocks = textSectionBlocks(text);

    expect(blocks.length).toBeGreaterThan(1);
    // First block should end at the newline boundary
    const firstBlock = blocks[0] as { text: { text: string } };
    expect(firstBlock.text.text).toBe(firstPart);
  });

  it("handles empty text", () => {
    const blocks = textSectionBlocks("");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: { text: string } }).text.text).toBe("");
  });
});

describe("planBlocks", () => {
  it("includes summary and action buttons", () => {
    const plan: AgentPlan = {
      summary: "Will reply to all messages",
      steps: [
        { description: "Reply to msg 1", toolName: "reply_to_message", reasoning: "test" },
        { description: "Reply to msg 2", toolName: "reply_to_message", reasoning: "test" },
      ],
    };

    const blocks = planBlocks(plan, "plan_123");

    // Should have section blocks for summary and steps, plus an actions block
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();

    const elements = (actionsBlock as { elements: Array<{ action_id: string; value: string }> })
      .elements;
    expect(elements).toHaveLength(3);
    expect(elements[0].action_id).toBe("agent_plan_accept");
    expect(elements[0].value).toBe("plan_123");
    expect(elements[1].action_id).toBe("agent_plan_decline");
    expect(elements[2].action_id).toBe("agent_plan_refine");
  });

  it("includes numbered steps", () => {
    const plan: AgentPlan = {
      summary: "Summary",
      steps: [
        { description: "Step one", toolName: "reply_to_message", reasoning: "r" },
        { description: "Step two", toolName: "post_channel_message", reasoning: "r" },
      ],
    };

    const blocks = planBlocks(plan, "plan_456");
    const sectionTexts = blocks
      .filter((b) => b.type === "section")
      .map((b) => (b as { text: { text: string } }).text.text);

    const stepsSection = sectionTexts.find((t) => t.includes("1. Step one"));
    expect(stepsSection).toBeDefined();
    expect(stepsSection).toContain("2. Step two");
  });

  it("omits steps section when steps array is empty", () => {
    const plan: AgentPlan = {
      summary: "Cannot accomplish task",
      steps: [],
    };

    const blocks = planBlocks(plan, "plan_789");
    const sectionTexts = blocks
      .filter((b) => b.type === "section")
      .map((b) => (b as { text: { text: string } }).text.text);

    // Should only have the summary section, no steps section
    expect(sectionTexts).toHaveLength(1);
    expect(sectionTexts[0]).toContain("Cannot accomplish task");
  });
});
