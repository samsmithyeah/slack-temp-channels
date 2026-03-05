import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionId,
  deleteExecution,
  getExecution,
  storeExecution,
} from "../../src/services/executionStore";

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: (overrides.id as string) ?? createExecutionId(),
    userId: "U_USER",
    channelId: "C_CHAN",
    summary: "Task completed successfully",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("executionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createExecutionId", () => {
    it("returns IDs with the expected prefix", () => {
      const id = createExecutionId();
      expect(id).toMatch(/^exec_\d+_\d+$/);
    });

    it("returns unique IDs on successive calls", () => {
      const ids = new Set([createExecutionId(), createExecutionId(), createExecutionId()]);
      expect(ids.size).toBe(3);
    });
  });

  describe("storeExecution / getExecution", () => {
    it("round-trips an execution", () => {
      const exec = makeExecution();
      storeExecution(exec);
      expect(getExecution(exec.id)).toEqual(exec);
    });

    it("returns undefined for a missing ID", () => {
      expect(getExecution("nonexistent")).toBeUndefined();
    });

    it("returns undefined for an expired execution", () => {
      const exec = makeExecution();
      storeExecution(exec);

      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(getExecution(exec.id)).toBeUndefined();
    });

    it("returns the execution if within TTL", () => {
      const exec = makeExecution();
      storeExecution(exec);

      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(getExecution(exec.id)).toEqual(exec);
    });
  });

  describe("deleteExecution", () => {
    it("removes a stored execution", () => {
      const exec = makeExecution();
      storeExecution(exec);
      deleteExecution(exec.id);
      expect(getExecution(exec.id)).toBeUndefined();
    });

    it("does not throw when deleting a nonexistent execution", () => {
      expect(() => deleteExecution("nonexistent")).not.toThrow();
    });
  });
});
