import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { LockZone, LockZoneState, Todo } from "@slaythelist/contracts";

type TodoRow = {
  id: string;
  title: string;
  status: "pending" | "done";
  created_at: string;
  updated_at: string;
};

type ZoneRow = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
};

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toZone(row: ZoneRow): LockZone {
  return {
    id: row.id,
    name: row.name,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTodos(): Todo[] {
  const rows = db.prepare("SELECT * FROM todos ORDER BY created_at DESC").all() as TodoRow[];
  return rows.map(toTodo);
}

export function createTodo(title: string): Todo {
  const now = new Date().toISOString();
  const todo: Todo = {
    id: randomUUID(),
    title,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    "INSERT INTO todos (id, title, status, created_at, updated_at) VALUES (@id, @title, @status, @createdAt, @updatedAt)",
  ).run(todo);
  return todo;
}

export function updateTodoStatus(id: string, status: "pending" | "done"): Todo | undefined {
  const now = new Date().toISOString();
  db.prepare("UPDATE todos SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
  return row ? toTodo(row) : undefined;
}

export function deleteTodo(id: string): boolean {
  const result = db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listZones(): LockZone[] {
  const rows = db.prepare("SELECT * FROM lock_zones ORDER BY created_at DESC").all() as ZoneRow[];
  return rows.map(toZone);
}

export function createZone(input: Omit<LockZone, "id" | "createdAt" | "updatedAt">): LockZone {
  const now = new Date().toISOString();
  const zone: LockZone = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO lock_zones (id, name, x, y, width, height, enabled, created_at, updated_at)
     VALUES (@id, @name, @x, @y, @width, @height, @enabled, @createdAt, @updatedAt)`,
  ).run({
    ...zone,
    enabled: zone.enabled ? 1 : 0,
  });
  return zone;
}

export function updateZone(
  id: string,
  patch: Partial<Pick<LockZone, "name" | "x" | "y" | "width" | "height" | "enabled">>,
): LockZone | undefined {
  const currentRow = db.prepare("SELECT * FROM lock_zones WHERE id = ?").get(id) as ZoneRow | undefined;
  if (!currentRow) {
    return undefined;
  }
  const current = toZone(currentRow);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE lock_zones
       SET name = ?, x = ?, y = ?, width = ?, height = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.name, next.x, next.y, next.width, next.height, next.enabled ? 1 : 0, next.updatedAt, id);
  return next;
}

export function deleteZone(id: string): boolean {
  const result = db.prepare("DELETE FROM lock_zones WHERE id = ?").run(id);
  return result.changes > 0;
}

export function setZoneRequirements(zoneId: string, todoIds: string[]): void {
  const tx = db.transaction((zone: string, ids: string[]) => {
    db.prepare("DELETE FROM lock_zone_requirements WHERE zone_id = ?").run(zone);
    const insertStmt = db.prepare("INSERT INTO lock_zone_requirements (zone_id, todo_id) VALUES (?, ?)");
    for (const todoId of ids) {
      insertStmt.run(zone, todoId);
    }
  });
  tx(zoneId, [...new Set(todoIds)]);
}

export function listOverlayState(): LockZoneState[] {
  const zones = listZones();
  const requiredRows = db
    .prepare("SELECT zone_id, todo_id FROM lock_zone_requirements")
    .all() as Array<{ zone_id: string; todo_id: string }>;
  const todoRows = db.prepare("SELECT id, status FROM todos").all() as Array<{
    id: string;
    status: "pending" | "done";
  }>;

  const statusByTodo = new Map(todoRows.map((t) => [t.id, t.status]));
  const requiredByZone = new Map<string, string[]>();
  for (const row of requiredRows) {
    const existing = requiredByZone.get(row.zone_id) ?? [];
    existing.push(row.todo_id);
    requiredByZone.set(row.zone_id, existing);
  }

  return zones.map((zone) => {
    const requiredTodoIds = requiredByZone.get(zone.id) ?? [];
    const isLocked =
      zone.enabled &&
      requiredTodoIds.length > 0 &&
      requiredTodoIds.some((todoId) => statusByTodo.get(todoId) !== "done");
    return {
      zone,
      requiredTodoIds,
      isLocked,
    };
  });
}
