import type { InstallationStore } from "@slack/bolt";
import Database from "better-sqlite3";

export function createInstallationStore(
  dbPath: string = process.env.DATABASE_PATH || "data/installations.db",
): InstallationStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS installations (id TEXT PRIMARY KEY, data TEXT NOT NULL)");

  const upsertStmt = db.prepare(
    "INSERT INTO installations (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
  );
  const selectStmt = db.prepare("SELECT data FROM installations WHERE id = ?");
  const deleteStmt = db.prepare("DELETE FROM installations WHERE id = ?");

  function getKey(query: {
    enterpriseId?: string;
    teamId?: string;
    isEnterpriseInstall?: boolean;
  }): string {
    if (query.isEnterpriseInstall && query.enterpriseId) {
      return query.enterpriseId;
    }
    if (query.teamId) {
      return query.teamId;
    }
    throw new Error("Failed to determine installation key: no teamId or enterpriseId");
  }

  return {
    storeInstallation: async (installation) => {
      const key = getKey({
        enterpriseId: installation.enterprise?.id,
        teamId: installation.team?.id,
        isEnterpriseInstall: installation.isEnterpriseInstall,
      });
      upsertStmt.run(key, JSON.stringify(installation));
    },

    fetchInstallation: async (query) => {
      const key = getKey(query);
      const row = selectStmt.get(key) as { data: string } | undefined;
      if (!row) {
        throw new Error(`No installation found for ${key}`);
      }
      return JSON.parse(row.data);
    },

    deleteInstallation: async (query) => {
      const key = getKey(query);
      deleteStmt.run(key);
    },
  };
}
