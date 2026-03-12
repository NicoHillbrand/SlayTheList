import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

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

db.exec(`
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'done')),
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
`);

ensureTodoColumn("context", "TEXT");
ensureTodoColumn("indent", "INTEGER NOT NULL DEFAULT 0");
ensureTodoColumn("sort_order", "INTEGER NOT NULL DEFAULT 0");
ensureTodoColumn("deadline_at", "TEXT");
ensureTodoColumn("archived_at", "TEXT");
ensureTodoColumn("completed_at", "TEXT");
