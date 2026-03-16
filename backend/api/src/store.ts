import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type {
  AccountabilityState,
  GoldState,
  Habit,
  LockZone,
  LockZoneState,
  Prediction,
  ReflectionEntry,
  Todo,
} from "@slaythelist/contracts";

type TodoRow = {
  id: string;
  title: string;
  context: string | null;
  status: "active" | "done";
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
  unlock_mode: "todos" | "gold";
  created_at: string;
  updated_at: string;
};

type AccountabilityStateRow = {
  habits_json: string;
  predictions_json: string;
  reflections_json: string;
  updated_at: string;
};

type GoldStateRow = {
  gold: number;
  rewarded_todo_ids_json: string;
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
    unlockMode: row.unlock_mode ?? "todos",
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
    status: "active",
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
  const shouldClearCompleted = patch.status !== undefined && nextStatus === "active";
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
  if (next.archivedAt) {
    // Keep requirement rows tidy: archived todos should not stay bound to lock zones.
    db.prepare("DELETE FROM lock_zone_requirements WHERE todo_id = ?").run(id);
  }
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
    `INSERT INTO lock_zones (id, name, x, y, width, height, enabled, unlock_mode, created_at, updated_at)
     VALUES (@id, @name, @x, @y, @width, @height, @enabled, @unlockMode, @createdAt, @updatedAt)`,
  ).run({
    ...zone,
    enabled: zone.enabled ? 1 : 0,
  });
  return zone;
}

export function updateZone(
  id: string,
  patch: Partial<Pick<LockZone, "name" | "x" | "y" | "width" | "height" | "enabled" | "unlockMode">>,
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
       SET name = ?, x = ?, y = ?, width = ?, height = ?, enabled = ?, unlock_mode = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.name, next.x, next.y, next.width, next.height, next.enabled ? 1 : 0, next.unlockMode, next.updatedAt, id);
  if (patch.unlockMode !== undefined && patch.unlockMode !== current.unlockMode) {
    db.prepare("DELETE FROM lock_zone_gold_unlocks WHERE zone_id = ?").run(id);
  }
  return next;
}

export function deleteZone(id: string): boolean {
  const result = db.prepare("DELETE FROM lock_zones WHERE id = ?").run(id);
  return result.changes > 0;
}

export function setZoneRequirements(zoneId: string, todoIds: string[]): void {
  const tx = db.transaction((zone: string, ids: string[]) => {
    db.prepare("DELETE FROM lock_zone_requirements WHERE zone_id = ?").run(zone);
    db.prepare("DELETE FROM lock_zone_gold_unlocks WHERE zone_id = ?").run(zone);
    const insertStmt = db.prepare("INSERT INTO lock_zone_requirements (zone_id, todo_id) VALUES (?, ?)");
    for (const todoId of ids) {
      insertStmt.run(zone, todoId);
    }
  });
  tx(zoneId, [...new Set(todoIds)]);
}

export function activateZoneGoldUnlock(zoneId: string): void {
  db.prepare(
    `INSERT INTO lock_zone_gold_unlocks (zone_id, created_at)
     VALUES (?, ?)
     ON CONFLICT(zone_id) DO UPDATE SET created_at = excluded.created_at`,
  ).run(zoneId, new Date().toISOString());
}

export function clearZoneGoldUnlock(zoneId: string): void {
  db.prepare("DELETE FROM lock_zone_gold_unlocks WHERE zone_id = ?").run(zoneId);
}

function safeParseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getAccountabilityState(): AccountabilityState {
  const row = db
    .prepare(
      "SELECT habits_json, predictions_json, reflections_json, updated_at FROM accountability_state WHERE id = 1",
    )
    .get() as AccountabilityStateRow | undefined;
  if (!row) {
    return {
      habits: [],
      predictions: [],
      reflections: [],
    };
  }
  return {
    habits: safeParseJsonArray<Habit>(row.habits_json),
    predictions: safeParseJsonArray<Prediction>(row.predictions_json),
    reflections: safeParseJsonArray<ReflectionEntry>(row.reflections_json),
  };
}

export function saveAccountabilityState(state: AccountabilityState): AccountabilityState {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE accountability_state
     SET habits_json = ?, predictions_json = ?, reflections_json = ?, updated_at = ?
     WHERE id = 1`,
  ).run(
    JSON.stringify(state.habits),
    JSON.stringify(state.predictions),
    JSON.stringify(state.reflections),
    updatedAt,
  );
  return state;
}

export function getGoldState(): GoldState {
  const row = db
    .prepare("SELECT gold, rewarded_todo_ids_json, updated_at FROM gold_state WHERE id = 1")
    .get() as GoldStateRow | undefined;
  if (!row) {
    return { gold: 0, rewardedTodoIds: [] };
  }
  return {
    gold: Math.max(0, Math.floor(row.gold ?? 0)),
    rewardedTodoIds: safeParseJsonArray<string>(row.rewarded_todo_ids_json).filter(
      (value): value is string => typeof value === "string",
    ),
  };
}

export function saveGoldState(state: GoldState): GoldState {
  const normalized: GoldState = {
    gold: Math.max(0, Math.floor(state.gold)),
    rewardedTodoIds: [...new Set(state.rewardedTodoIds)],
  };
  db.prepare(
    `UPDATE gold_state
     SET gold = ?, rewarded_todo_ids_json = ?, updated_at = ?
     WHERE id = 1`,
  ).run(normalized.gold, JSON.stringify(normalized.rewardedTodoIds), new Date().toISOString());
  return normalized;
}

export function awardGold(amount: number): GoldState {
  const current = getGoldState();
  return saveGoldState({
    gold: current.gold + Math.max(0, Math.floor(amount)),
    rewardedTodoIds: current.rewardedTodoIds,
  });
}

export function awardTodoGold(todoId: string, amount: number): { state: GoldState; awarded: boolean } {
  const current = getGoldState();
  if (current.rewardedTodoIds.includes(todoId)) {
    return { state: current, awarded: false };
  }
  const state = saveGoldState({
    gold: current.gold + Math.max(0, Math.floor(amount)),
    rewardedTodoIds: [...current.rewardedTodoIds, todoId],
  });
  return { state, awarded: true };
}

export function spendGold(amount: number): GoldState {
  const normalizedAmount = Math.max(0, Math.floor(amount));
  const current = getGoldState();
  if (current.gold < normalizedAmount) {
    throw new Error("not enough gold");
  }
  return saveGoldState({
    gold: current.gold - normalizedAmount,
    rewardedTodoIds: current.rewardedTodoIds,
  });
}

export function listOverlayState(): LockZoneState[] {
  const zones = listZones();
  const requiredRows = db
    .prepare("SELECT zone_id, todo_id FROM lock_zone_requirements")
    .all() as Array<{ zone_id: string; todo_id: string }>;
  const goldUnlockRows = db
    .prepare("SELECT zone_id FROM lock_zone_gold_unlocks")
    .all() as Array<{ zone_id: string }>;
  const todoRows = db.prepare("SELECT id, title, status, archived_at FROM todos").all() as Array<{
    id: string;
    title: string;
    status: "active" | "done";
    archived_at: string | null;
  }>;

  const activeTodoRows = todoRows.filter(
    (row) => !row.archived_at && row.title.trim().length > 0,
  );
  const activeTodoIds = new Set(activeTodoRows.map((row) => row.id));
  const statusByTodo = new Map(activeTodoRows.map((t) => [t.id, t.status]));
  const titleByTodo = new Map(activeTodoRows.map((t) => [t.id, t.title]));
  const goldUnlockedZoneIds = new Set(goldUnlockRows.map((row) => row.zone_id));
  const requiredByZone = new Map<string, string[]>();
  for (const row of requiredRows) {
    if (!activeTodoIds.has(row.todo_id)) continue;
    const existing = requiredByZone.get(row.zone_id) ?? [];
    existing.push(row.todo_id);
    requiredByZone.set(row.zone_id, existing);
  }

  return zones.map((zone) => {
    const requiredTodoIds = requiredByZone.get(zone.id) ?? [];
    const requiredTodoTitles = requiredTodoIds
      .map((todoId) => titleByTodo.get(todoId))
      .filter((title): title is string => !!title);
    const goldUnlockActive = goldUnlockedZoneIds.has(zone.id);
    const isLocked =
      zone.unlockMode === "gold"
        ? zone.enabled && !goldUnlockActive
        : zone.enabled &&
          requiredTodoIds.length > 0 &&
          requiredTodoIds.some((todoId) => statusByTodo.get(todoId) !== "done") &&
          !goldUnlockActive;
    return {
      zone,
      requiredTodoIds,
      requiredTodoTitles,
      goldUnlockActive,
      isLocked,
    };
  });
}
