import type { VaultPullResponse, VaultPushRequest, VaultPushResponse, VaultVersionResponse } from "@slaythelist/contracts";
import { db } from "./db.js";

type VaultRow = {
  user_id: string;
  encrypted_blob: string;
  salt: string;
  iv: string;
  version: number;
  updated_at: string;
};

export function getVaultVersion(userId: string): VaultVersionResponse {
  const row = db
    .prepare("SELECT version, updated_at FROM user_vault WHERE user_id = ?")
    .get(userId) as Pick<VaultRow, "version" | "updated_at"> | undefined;
  return {
    version: row?.version ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
}

export function pullVault(userId: string): VaultPullResponse {
  const row = db
    .prepare("SELECT encrypted_blob, salt, iv, version, updated_at FROM user_vault WHERE user_id = ?")
    .get(userId) as Omit<VaultRow, "user_id"> | undefined;
  if (!row) {
    return { encryptedBlob: null, salt: null, iv: null, version: 0, updatedAt: null };
  }
  return {
    encryptedBlob: row.encrypted_blob,
    salt: row.salt,
    iv: row.iv,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function pushVault(userId: string, request: VaultPushRequest): VaultPushResponse {
  const current = getVaultVersion(userId);

  // Optimistic concurrency: client must send the version it read
  if (request.version !== current.version) {
    throw Object.assign(new Error("version conflict — pull the latest vault first"), { statusCode: 409 });
  }

  const nextVersion = current.version + 1;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user_vault (user_id, encrypted_blob, salt, iv, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_blob = excluded.encrypted_blob,
       salt = excluded.salt,
       iv = excluded.iv,
       version = excluded.version,
       updated_at = excluded.updated_at`,
  ).run(userId, request.encryptedBlob, request.salt, request.iv, nextVersion, now);

  return { version: nextVersion, updatedAt: now };
}
