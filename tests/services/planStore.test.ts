import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPlan } from "../../src/services/agentPlanner";
import {
  createPlanId,
  deletePlan,
  getPlan,
  type PlanData,
  storePlan,
} from "../../src/services/planStore";

function makePlan(overrides: Partial<PlanData> = {}): PlanData {
  return {
    id: overrides.id ?? createPlanId(),
    userId: "U_USER",
    channelId: "C_CHAN",
    taskDescription: "test task",
    plan: { summary: "test", steps: [] } as AgentPlan,
    dmChannelId: "D_DM",
    dmMessageTs: "1234567890.000001",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("planStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createPlanId", () => {
    it("returns IDs with the expected prefix", () => {
      const id = createPlanId();
      expect(id).toMatch(/^plan_\d+_\d+$/);
    });

    it("returns unique IDs on successive calls", () => {
      const ids = new Set([createPlanId(), createPlanId(), createPlanId()]);
      expect(ids.size).toBe(3);
    });
  });

  describe("storePlan / getPlan", () => {
    it("round-trips a plan", () => {
      const plan = makePlan();
      storePlan(plan);
      expect(getPlan(plan.id)).toEqual(plan);
    });

    it("returns undefined for a missing ID", () => {
      expect(getPlan("nonexistent")).toBeUndefined();
    });

    it("returns undefined for an expired plan", () => {
      const plan = makePlan();
      storePlan(plan);

      // Advance past 30-minute TTL
      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(getPlan(plan.id)).toBeUndefined();
    });

    it("returns the plan if within TTL", () => {
      const plan = makePlan();
      storePlan(plan);

      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(getPlan(plan.id)).toEqual(plan);
    });
  });

  describe("deletePlan", () => {
    it("removes a stored plan", () => {
      const plan = makePlan();
      storePlan(plan);
      deletePlan(plan.id);
      expect(getPlan(plan.id)).toBeUndefined();
    });

    it("does not throw when deleting a nonexistent plan", () => {
      expect(() => deletePlan("nonexistent")).not.toThrow();
    });
  });
});
