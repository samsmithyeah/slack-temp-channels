import { describe, expect, it } from "vitest";
import { parsePlanFromArgs } from "../../src/services/agentPlanner";

describe("parsePlanFromArgs", () => {
  it("parses a complete plan with requiresApproval: false", () => {
    const plan = parsePlanFromArgs({
      summary: "Reply to a message",
      steps: [{ description: "Reply", toolName: "reply_to_message", reasoning: "User asked" }],
      requiresApproval: false,
    });

    expect(plan.summary).toBe("Reply to a message");
    expect(plan.steps).toHaveLength(1);
    expect(plan.requiresApproval).toBe(false);
  });

  it("parses a complete plan with requiresApproval: true", () => {
    const plan = parsePlanFromArgs({
      summary: "Complex task",
      steps: [
        { description: "Step 1", toolName: "reply_to_message", reasoning: "r" },
        { description: "Step 2", toolName: "post_channel_message", reasoning: "r" },
        { description: "Step 3", toolName: "edit_message", reasoning: "r" },
      ],
      requiresApproval: true,
    });

    expect(plan.requiresApproval).toBe(true);
    expect(plan.steps).toHaveLength(3);
  });

  it("defaults requiresApproval to true when missing", () => {
    const plan = parsePlanFromArgs({
      summary: "Some task",
      steps: [],
    });

    expect(plan.requiresApproval).toBe(true);
  });

  it("defaults requiresApproval to true when not a boolean", () => {
    const plan = parsePlanFromArgs({
      summary: "Some task",
      steps: [],
      requiresApproval: "false",
    });

    expect(plan.requiresApproval).toBe(true);
  });

  it("provides default summary when missing", () => {
    const plan = parsePlanFromArgs({ steps: [] });

    expect(plan.summary).toBe("No summary provided");
  });

  it("skips malformed steps", () => {
    const plan = parsePlanFromArgs({
      summary: "test",
      steps: [
        { description: "Valid", toolName: "reply_to_message", reasoning: "r" },
        { description: "Missing toolName" },
        "not an object",
        null,
        { toolName: "reply_to_message" },
      ],
      requiresApproval: false,
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].description).toBe("Valid");
  });

  it("defaults reasoning to empty string when missing", () => {
    const plan = parsePlanFromArgs({
      summary: "test",
      steps: [{ description: "Step", toolName: "reply_to_message" }],
      requiresApproval: false,
    });

    expect(plan.steps[0].reasoning).toBe("");
  });
});

describe("shouldYolo logic", () => {
  function shouldYolo(isYolo: boolean, requiresApproval: boolean, stepCount: number): boolean {
    return isYolo || (!requiresApproval && stepCount <= 2);
  }

  it("returns true when explicit yolo keyword is present", () => {
    expect(shouldYolo(true, true, 5)).toBe(true);
  });

  it("returns true for simple plan (no approval, <=2 steps)", () => {
    expect(shouldYolo(false, false, 1)).toBe(true);
    expect(shouldYolo(false, false, 2)).toBe(true);
  });

  it("returns false for simple plan with >2 steps", () => {
    expect(shouldYolo(false, false, 3)).toBe(false);
  });

  it("returns false when requiresApproval is true", () => {
    expect(shouldYolo(false, true, 1)).toBe(false);
    expect(shouldYolo(false, true, 2)).toBe(false);
  });

  it("returns true for zero-step plan that doesn't require approval", () => {
    expect(shouldYolo(false, false, 0)).toBe(true);
  });

  it("overrides requiresApproval and step count with explicit yolo", () => {
    expect(shouldYolo(true, true, 10)).toBe(true);
    expect(shouldYolo(true, false, 10)).toBe(true);
  });
});
