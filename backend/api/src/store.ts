import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { LockZone, LockZoneState, Todo } from "@slaythelist/contracts";

type TodoRow = {
  id: string;
  title: string;
  context: string | null;
  status: "pending" | "done";
  indent: number;
  sort_order: number;
  deadline_at: string | null;
  archived_at: string | null;
  completed_at: string | null;
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
    context: row.context ?? undefined,
    status: row.status,
    indent: row.indent,
    sortOrder: row.sort_order,
    deadlineAt: row.deadline_at,
    archivedAt: row.archived_at,
    completedAt: row.completed_at,
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
  const rows = db
    .prepare(
      `SELECT * FROM todos
       ORDER BY
         CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END ASC,
         sort_order ASC,
         created_at ASC`,
    )
    .all() as TodoRow[];
  return rows.map(toTodo);
}

export function createTodo(title: string, options?: { deadlineAt?: string | null }): Todo {
  const now = new Date().toISOString();
  const nextSortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM todos").get() as {
    next: number;
  };
  const todo: Todo = {
    id: randomUUID(),
    title,
    context: undefined,
    status: "pending",
    indent: 0,
    sortOrder: nextSortOrder.next,
    deadlineAt: options?.deadlineAt ?? null,
    archivedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO todos
      (id, title, context, status, indent, sort_order, deadline_at, archived_at, completed_at, created_at, updated_at)
     VALUES
      (@id, @title, @context, @status, @indent, @sortOrder, @deadlineAt, @archivedAt, @completedAt, @createdAt, @updatedAt)`,
  ).run(todo);
  return todo;
}

export function updateTodo(
  id: string,
  patch: Partial<Pick<Todo, "title" | "context" | "status" | "indent" | "deadlineAt" | "archivedAt">>,
): Todo | undefined {
  const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
  if (!row) return undefined;
  const current = toTodo(row);
  const now = new Date().toISOString();
  const nextStatus = patch.status ?? current.status;
  const shouldSetCompleted = patch.status !== undefined && nextStatus === "done" && !current.completedAt;
  const shouldClearCompleted = patch.status !== undefined && nextStatus === "pending";
  const next: Todo = {
    ...current,
    ...patch,
    title: patch.title ?? current.title,
    context: patch.context === undefined ? current.context : patch.context || undefined,
    status: nextStatus,
    indent: patch.indent ?? current.indent,
    deadlineAt: patch.deadlineAt === undefined ? current.deadlineAt : patch.deadlineAt,
    archivedAt: patch.archivedAt === undefined ? current.archivedAt : patch.archivedAt,
    completedAt: shouldSetCompleted
      ? now
      : shouldClearCompleted
        ? null
        : current.completedAt,
    updatedAt: now,
  };
  db.prepare(
    `UPDATE todos
     SET title = ?,
         context = ?,
         status = ?,
         indent = ?,
         deadline_at = ?,
         archived_at = ?,
         completed_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.context ?? null,
    next.status,
    next.indent,
    next.deadlineAt,
    next.archivedAt,
    next.completedAt,
    next.updatedAt,
    id,
  );
  return next;
}

export function deleteTodo(id: string): boolean {
  const result = db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  return result.changes > 0;
}

export function reorderTodos(orderedTodoIds: string[]): Todo[] {
  const uniqueIds = [...new Set(orderedTodoIds)];
  if (uniqueIds.length === 0) return listTodos();
  const existingRows = db
    .prepare(
      "SELECT id FROM todos WHERE id IN (" + uniqueIds.map(() => "?").join(",") + ") ORDER BY sort_order ASC",
    )
    .all(...uniqueIds) as Array<{ id: string }>;
  if (existingRows.length !== uniqueIds.length) {
    throw new Error("one or more todo ids do not exist");
  }
  const tx = db.transaction((ids: string[]) => {
    const updateStmt = db.prepare("UPDATE todos SET sort_order = ?, updated_at = ? WHERE id = ?");
    const now = new Date().toISOString();
    ids.forEach((todoId, index) => {
      updateStmt.run(index, now, todoId);
    });
  });
  tx(uniqueIds);
  return listTodos();
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
  const todoRows = db.prepare("SELECT id, title, status FROM todos").all() as Array<{
    id: string;
    title: string;
    status: "pending" | "done";
  }>;

  const statusByTodo = new Map(todoRows.map((t) => [t.id, t.status]));
  const titleByTodo = new Map(todoRows.map((t) => [t.id, t.title]));
  const requiredByZone = new Map<string, string[]>();
  for (const row of requiredRows) {
    const existing = requiredByZone.get(row.zone_id) ?? [];
    existing.push(row.todo_id);
    requiredByZone.set(row.zone_id, existing);
  }

  return zones.map((zone) => {
    const requiredTodoIds = requiredByZone.get(zone.id) ?? [];
    const requiredTodoTitles = requiredTodoIds
      .map((todoId) => titleByTodo.get(todoId))
      .filter((title): title is string => !!title);
    const isLocked =
      zone.enabled &&
      requiredTodoIds.length > 0 &&
      requiredTodoIds.some((todoId) => statusByTodo.get(todoId) !== "done");
    return {
      zone,
      requiredTodoIds,
      requiredTodoTitles,
      isLocked,
    };
  });
}
