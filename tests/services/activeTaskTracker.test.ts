import { beforeEach, describe, expect, it } from "vitest";
import { isUserActive, markActive, markInactive } from "../../src/services/activeTaskTracker";

describe("activeTaskTracker", () => {
  beforeEach(() => {
    // Clean up any active users between tests
    markInactive("U1");
    markInactive("U2");
  });

  it("reports users as inactive by default", () => {
    expect(isUserActive("U1")).toBe(false);
  });

  it("marks a user as active", () => {
    markActive("U1");
    expect(isUserActive("U1")).toBe(true);
  });

  it("marks a user as inactive", () => {
    markActive("U1");
    markInactive("U1");
    expect(isUserActive("U1")).toBe(false);
  });

  it("tracks multiple users independently", () => {
    markActive("U1");
    expect(isUserActive("U1")).toBe(true);
    expect(isUserActive("U2")).toBe(false);

    markActive("U2");
    expect(isUserActive("U1")).toBe(true);
    expect(isUserActive("U2")).toBe(true);

    markInactive("U1");
    expect(isUserActive("U1")).toBe(false);
    expect(isUserActive("U2")).toBe(true);
  });

  it("is idempotent for markActive and markInactive", () => {
    markActive("U1");
    markActive("U1");
    expect(isUserActive("U1")).toBe(true);

    markInactive("U1");
    expect(isUserActive("U1")).toBe(false);

    // Marking inactive when already inactive is fine
    markInactive("U1");
    expect(isUserActive("U1")).toBe(false);
  });
});
