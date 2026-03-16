import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const referenceImagesDir = path.join(dataDir, "reference-images");
fs.mkdirSync(referenceImagesDir, { recursive: true });

const dbPath = path.join(dataDir, "slaythelist.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function ensureTodoColumn(name: string, definition: string) {
  const existing = db
    .prepare("SELECT 1 FROM pragma_table_info('todos') WHERE name = ? LIMIT 1")
    .get(name) as { 1: number } | undefined;
  if (existing) return;
  db.exec(`ALTER TABLE todos ADD COLUMN ${name} ${definition};`);
}

function ensureLockZoneColumn(name: string, definition: string) {
  const existing = db
    .prepare("SELECT 1 FROM pragma_table_info('lock_zones') WHERE name = ? LIMIT 1")
    .get(name) as { 1: number } | undefined;
  if (existing) return;
  db.exec(`ALTER TABLE lock_zones ADD COLUMN ${name} ${definition};`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'done')),
  indent INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deadline_at TEXT,
  archived_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lock_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  unlock_mode TEXT NOT NULL DEFAULT 'todos' CHECK(unlock_mode IN ('todos', 'gold')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lock_zone_requirements (
  zone_id TEXT NOT NULL,
  todo_id TEXT NOT NULL,
  PRIMARY KEY(zone_id, todo_id),
  FOREIGN KEY(zone_id) REFERENCES lock_zones(id) ON DELETE CASCADE,
  FOREIGN KEY(todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lock_zone_gold_unlocks (
  zone_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  FOREIGN KEY(zone_id) REFERENCES lock_zones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accountability_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  habits_json TEXT NOT NULL DEFAULT '[]',
  predictions_json TEXT NOT NULL DEFAULT '[]',
  reflections_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gold_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  gold INTEGER NOT NULL DEFAULT 0,
  rewarded_todo_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_states (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  detection_method TEXT NOT NULL DEFAULT 'screenshot_match',
  match_threshold REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_state_reference_images (
  id TEXT PRIMARY KEY,
  game_state_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(game_state_id) REFERENCES game_states(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lock_zone_game_states (
  zone_id TEXT NOT NULL,
  game_state_id TEXT NOT NULL,
  PRIMARY KEY(zone_id, game_state_id),
  FOREIGN KEY(zone_id) REFERENCES lock_zones(id) ON DELETE CASCADE,
  FOREIGN KEY(game_state_id) REFERENCES game_states(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS detected_game_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  game_state_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  detected_at TEXT NOT NULL,
  FOREIGN KEY(game_state_id) REFERENCES game_states(id) ON DELETE SET NULL
);
`);

function migrateTodoStatusToActive() {
  const tableSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos' LIMIT 1")
    .get() as { sql: string } | undefined;
  const tableSql = tableSqlRow?.sql ?? "";
  if (!tableSql.includes("CHECK(status IN ('pending', 'done'))")) {
    // New schema already in place.
    return;
  }

  db.pragma("foreign_keys = OFF");
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE lock_zone_requirements_backup AS
      SELECT zone_id, todo_id FROM lock_zone_requirements;

      DROP TABLE lock_zone_requirements;

      ALTER TABLE todos RENAME TO todos_legacy_status;

      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL CHECK(status IN ('active', 'done')),
        indent INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        deadline_at TEXT,
        archived_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO todos (id, title, context, status, indent, sort_order, deadline_at, archived_at, completed_at, created_at, updated_at)
      SELECT
        id,
        title,
        context,
        CASE status WHEN 'pending' THEN 'active' ELSE status END,
        indent,
        sort_order,
        deadline_at,
        archived_at,
        completed_at,
        created_at,
        updated_at
      FROM todos_legacy_status;

      DROP TABLE todos_legacy_status;

      CREATE TABLE lock_zone_requirements (
        zone_id TEXT NOT NULL,
        todo_id TEXT NOT NULL,
        PRIMARY KEY(zone_id, todo_id),
        FOREIGN KEY(zone_id) REFERENCES lock_zones(id) ON DELETE CASCADE,
        FOREIGN KEY(todo_id) REFERENCES todos(id) ON DELETE CASCADE
      );

      INSERT INTO lock_zone_requirements (zone_id, todo_id)
      SELECT backup.zone_id, backup.todo_id
      FROM lock_zone_requirements_backup backup
      INNER JOIN lock_zones zones ON zones.id = backup.zone_id
      INNER JOIN todos todos ON todos.id = backup.todo_id;

      DROP TABLE lock_zone_requirements_backup;
    `);
  });

  try {
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

migrateTodoStatusToActive();

ensureTodoColumn("context", "TEXT");
ensureTodoColumn("indent", "INTEGER NOT NULL DEFAULT 0");
ensureTodoColumn("sort_order", "INTEGER NOT NULL DEFAULT 0");
ensureTodoColumn("deadline_at", "TEXT");
ensureTodoColumn("archived_at", "TEXT");
ensureTodoColumn("completed_at", "TEXT");
ensureLockZoneColumn("unlock_mode", "TEXT NOT NULL DEFAULT 'todos' CHECK(unlock_mode IN ('todos', 'gold'))");

const existingStateRow = db
  .prepare("SELECT 1 FROM accountability_state WHERE id = 1 LIMIT 1")
  .get() as { 1: number } | undefined;
if (!existingStateRow) {
  db.prepare(
    "INSERT INTO accountability_state (id, habits_json, predictions_json, reflections_json, updated_at) VALUES (1, '[]', '[]', '[]', ?)",
  ).run(new Date().toISOString());
}

const existingGoldStateRow = db
  .prepare("SELECT 1 FROM gold_state WHERE id = 1 LIMIT 1")
  .get() as { 1: number } | undefined;
if (!existingGoldStateRow) {
  db.prepare(
    "INSERT INTO gold_state (id, gold, rewarded_todo_ids_json, updated_at) VALUES (1, 0, '[]', ?)",
  ).run(new Date().toISOString());
}

const existingDetectedRow = db
  .prepare("SELECT 1 FROM detected_game_state WHERE id = 1 LIMIT 1")
  .get() as { 1: number } | undefined;
if (!existingDetectedRow) {
  db.prepare(
    "INSERT INTO detected_game_state (id, game_state_id, confidence, detected_at) VALUES (1, NULL, 0, ?)",
  ).run(new Date().toISOString());
}
