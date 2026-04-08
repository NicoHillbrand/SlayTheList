import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const configuredDataDir = process.env.CLOUD_SOCIAL_DATA_DIR?.trim();
const defaultDataDir = path.join(process.cwd(), "data");

export const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : defaultDataDir;
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "cloud-social.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS cloud_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  id TEXT PRIMARY KEY,
  cloud_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY(cloud_user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY,
  cloud_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY(cloud_user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_auth_sessions (
  device_code TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'exchanged', 'expired')),
  cloud_user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY(cloud_user_id) REFERENCES cloud_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_social_settings (
  user_id TEXT PRIMARY KEY,
  habits_visibility TEXT NOT NULL DEFAULT 'friends' CHECK(habits_visibility IN ('private', 'friends', 'public')),
  predictions_visibility TEXT NOT NULL DEFAULT 'friends' CHECK(predictions_visibility IN ('private', 'friends', 'public')),
  gold_visibility TEXT NOT NULL DEFAULT 'friends' CHECK(gold_visibility IN ('private', 'friends', 'public')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_social_snapshots (
  user_id TEXT PRIMARY KEY,
  habits_json TEXT NOT NULL DEFAULT '[]',
  predictions_json TEXT NOT NULL DEFAULT '[]',
  gold_json TEXT NOT NULL DEFAULT '{"gold":0,"rewardedTodoIds":[]}',
  source_updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL,
  receiver_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  FOREIGN KEY(sender_user_id) REFERENCES cloud_users(id) ON DELETE CASCADE,
  FOREIGN KEY(receiver_user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  user_low_id TEXT NOT NULL,
  user_high_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_low_id, user_high_id),
  FOREIGN KEY(user_low_id) REFERENCES cloud_users(id) ON DELETE CASCADE,
  FOREIGN KEY(user_high_id) REFERENCES cloud_users(id) ON DELETE CASCADE,
  CHECK(user_low_id < user_high_id)
);

CREATE TABLE IF NOT EXISTS user_vault (
  user_id TEXT PRIMARY KEY,
  encrypted_blob TEXT NOT NULL,
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES cloud_users(id) ON DELETE CASCADE
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(cloud_user_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(cloud_user_id);
CREATE INDEX IF NOT EXISTS idx_device_auth_sessions_status ON device_auth_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_user_id, status);
`);
