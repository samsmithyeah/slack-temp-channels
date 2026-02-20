import type { Installation, InstallationQuery } from "@slack/bolt";
import { describe, expect, it } from "vitest";
import { createInstallationStore } from "../../src/stores/installation-store";

function makeInstallation(teamId: string, overrides: Partial<Installation> = {}): Installation {
  return {
    team: { id: teamId, name: "Test Team" },
    enterprise: undefined,
    user: { id: "U123", token: undefined, scopes: undefined },
    bot: {
      token: `xoxb-token-${teamId}`,
      scopes: ["chat:write"],
      id: "B123",
      userId: "U_BOT",
    },
    isEnterpriseInstall: false,
    authVersion: "v2",
    ...overrides,
  } as Installation;
}

function makeEnterpriseInstallation(enterpriseId: string): Installation {
  return {
    team: undefined,
    enterprise: { id: enterpriseId, name: "Test Enterprise" },
    user: { id: "U123", token: undefined, scopes: undefined },
    bot: {
      token: `xoxb-token-${enterpriseId}`,
      scopes: ["chat:write"],
      id: "B123",
      userId: "U_BOT",
    },
    isEnterpriseInstall: true,
    authVersion: "v2",
  } as Installation;
}

describe("createInstallationStore", () => {
  it("stores and fetches an installation", async () => {
    const store = createInstallationStore(":memory:");
    const installation = makeInstallation("T001");

    await store.storeInstallation(installation);

    const result = await store.fetchInstallation({
      teamId: "T001",
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);

    expect(result.bot!.token).toBe("xoxb-token-T001");
    expect(result.team!.id).toBe("T001");
  });

  it("throws when fetching a non-existent installation", async () => {
    const store = createInstallationStore(":memory:");

    await expect(
      store.fetchInstallation({
        teamId: "T_MISSING",
        isEnterpriseInstall: false,
      } as InstallationQuery<false>),
    ).rejects.toThrow("No installation found for T_MISSING");
  });

  it("upserts an installation (overwrites existing)", async () => {
    const store = createInstallationStore(":memory:");

    await store.storeInstallation(makeInstallation("T001"));
    await store.storeInstallation(
      makeInstallation("T001", {
        bot: { token: "xoxb-updated", scopes: ["chat:write"], id: "B123", userId: "U_BOT" },
      }),
    );

    const result = await store.fetchInstallation({
      teamId: "T001",
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);

    expect(result.bot!.token).toBe("xoxb-updated");
  });

  it("deletes an installation", async () => {
    const store = createInstallationStore(":memory:");
    await store.storeInstallation(makeInstallation("T001"));

    await store.deleteInstallation!({
      teamId: "T001",
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);

    await expect(
      store.fetchInstallation({
        teamId: "T001",
        isEnterpriseInstall: false,
      } as InstallationQuery<false>),
    ).rejects.toThrow("No installation found for T001");
  });

  it("stores multiple workspaces independently", async () => {
    const store = createInstallationStore(":memory:");

    await store.storeInstallation(makeInstallation("T001"));
    await store.storeInstallation(makeInstallation("T002"));

    const r1 = await store.fetchInstallation({
      teamId: "T001",
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);
    const r2 = await store.fetchInstallation({
      teamId: "T002",
      isEnterpriseInstall: false,
    } as InstallationQuery<false>);

    expect(r1.bot!.token).toBe("xoxb-token-T001");
    expect(r2.bot!.token).toBe("xoxb-token-T002");
  });

  it("keys enterprise installs by enterpriseId", async () => {
    const store = createInstallationStore(":memory:");
    const installation = makeEnterpriseInstallation("E001");

    await store.storeInstallation(installation);

    const result = await store.fetchInstallation({
      enterpriseId: "E001",
      isEnterpriseInstall: true,
    } as InstallationQuery<true>);

    expect(result.bot!.token).toBe("xoxb-token-E001");
    expect(result.enterprise!.id).toBe("E001");
  });

  it("deleting a non-existent installation does not throw", async () => {
    const store = createInstallationStore(":memory:");

    await expect(
      store.deleteInstallation!({
        teamId: "T_MISSING",
        isEnterpriseInstall: false,
      } as InstallationQuery<false>),
    ).resolves.toBeUndefined();
  });
});
