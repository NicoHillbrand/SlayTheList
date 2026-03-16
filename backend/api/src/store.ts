import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, referenceImagesDir } from "./db.js";
import type {
  AccountabilityState,
  DetectedGameState,
  GameState,
  GameStateReferenceImage,
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

// ---------------------------------------------------------------------------
// Game States
// ---------------------------------------------------------------------------

type GameStateRow = {
  id: string;
  name: string;
  enabled: 0 | 1;
  detection_method: string;
  match_threshold: number;
  created_at: string;
  updated_at: string;
};

type GameStateRefImageRow = {
  id: string;
  game_state_id: string;
  filename: string;
  created_at: string;
};

type DetectedGameStateRow = {
  game_state_id: string | null;
  confidence: number;
  detected_at: string;
};

function toGameState(row: GameStateRow): GameState {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    detectionMethod: row.detection_method as GameState["detectionMethod"],
    matchThreshold: row.match_threshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRefImage(row: GameStateRefImageRow): GameStateReferenceImage {
  return {
    id: row.id,
    gameStateId: row.game_state_id,
    filename: row.filename,
    createdAt: row.created_at,
  };
}

export function listGameStates(): GameState[] {
  const rows = db.prepare("SELECT * FROM game_states ORDER BY created_at ASC").all() as GameStateRow[];
  return rows.map(toGameState);
}

export function getGameState(id: string): GameState | undefined {
  const row = db.prepare("SELECT * FROM game_states WHERE id = ?").get(id) as GameStateRow | undefined;
  return row ? toGameState(row) : undefined;
}

export function createGameState(input: { name: string; matchThreshold?: number }): GameState {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO game_states (id, name, enabled, detection_method, match_threshold, created_at, updated_at)
     VALUES (?, ?, 1, 'screenshot_match', ?, ?, ?)`,
  ).run(id, input.name.trim(), input.matchThreshold ?? 0.8, now, now);
  return getGameState(id)!;
}

export function updateGameState(
  id: string,
  patch: Partial<Pick<GameState, "name" | "enabled" | "matchThreshold">>,
): GameState | undefined {
  const existing = getGameState(id);
  if (!existing) return undefined;
  const next = {
    name: patch.name ?? existing.name,
    enabled: patch.enabled ?? existing.enabled,
    matchThreshold: patch.matchThreshold ?? existing.matchThreshold,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE game_states SET name = ?, enabled = ?, match_threshold = ?, updated_at = ? WHERE id = ?`,
  ).run(next.name, next.enabled ? 1 : 0, next.matchThreshold, next.updatedAt, id);
  return getGameState(id);
}

export function deleteGameState(id: string): boolean {
  const stateDir = path.join(referenceImagesDir, id);
  if (fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  const result = db.prepare("DELETE FROM game_states WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listReferenceImages(gameStateId: string): GameStateReferenceImage[] {
  const rows = db
    .prepare("SELECT * FROM game_state_reference_images WHERE game_state_id = ? ORDER BY created_at ASC")
    .all(gameStateId) as GameStateRefImageRow[];
  return rows.map(toRefImage);
}

export function addReferenceImage(gameStateId: string, imageBuffer: Buffer, originalName: string): GameStateReferenceImage {
  const ext = path.extname(originalName) || ".png";
  const id = randomUUID();
  const filename = `${id}${ext}`;
  const stateDir = path.join(referenceImagesDir, gameStateId);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, filename), imageBuffer);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO game_state_reference_images (id, game_state_id, filename, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, gameStateId, filename, now);
  return { id, gameStateId, filename, createdAt: now };
}

export function deleteReferenceImage(imageId: string): boolean {
  const row = db.prepare("SELECT * FROM game_state_reference_images WHERE id = ?").get(imageId) as GameStateRefImageRow | undefined;
  if (!row) return false;
  const filePath = path.join(referenceImagesDir, row.game_state_id, row.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare("DELETE FROM game_state_reference_images WHERE id = ?").run(imageId);
  return true;
}

export function setZoneGameStates(zoneId: string, gameStateIds: string[]): void {
  const tx = db.transaction((zone: string, ids: string[]) => {
    db.prepare("DELETE FROM lock_zone_game_states WHERE zone_id = ?").run(zone);
    const stmt = db.prepare("INSERT INTO lock_zone_game_states (zone_id, game_state_id) VALUES (?, ?)");
    for (const gsId of [...new Set(ids)]) {
      stmt.run(zone, gsId);
    }
  });
  tx(zoneId, gameStateIds);
}

export function getDetectedGameState(): DetectedGameState {
  const row = db.prepare("SELECT game_state_id, confidence, detected_at FROM detected_game_state WHERE id = 1").get() as DetectedGameStateRow | undefined;
  if (!row) return { gameStateId: null, gameStateName: null, confidence: 0, detectedAt: new Date().toISOString() };
  const name = row.game_state_id
    ? (db.prepare("SELECT name FROM game_states WHERE id = ?").get(row.game_state_id) as { name: string } | undefined)?.name ?? null
    : null;
  return {
    gameStateId: row.game_state_id,
    gameStateName: name,
    confidence: row.confidence,
    detectedAt: row.detected_at,
  };
}

export function setDetectedGameState(gameStateId: string | null, confidence: number): DetectedGameState {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE detected_game_state SET game_state_id = ?, confidence = ?, detected_at = ? WHERE id = 1",
  ).run(gameStateId, confidence, now);
  return getDetectedGameState();
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

  const zoneGameStateRows = db
    .prepare("SELECT zone_id, game_state_id FROM lock_zone_game_states")
    .all() as Array<{ zone_id: string; game_state_id: string }>;
  const gameStatesByZone = new Map<string, string[]>();
  for (const row of zoneGameStateRows) {
    const existing = gameStatesByZone.get(row.zone_id) ?? [];
    existing.push(row.game_state_id);
    gameStatesByZone.set(row.zone_id, existing);
  }

  const detected = getDetectedGameState();
  const currentGameStateId = detected.gameStateId;

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
    const activeForGameStateIds = gameStatesByZone.get(zone.id) ?? [];
    const activeForCurrentState =
      activeForGameStateIds.length === 0 ||
      (currentGameStateId !== null && activeForGameStateIds.includes(currentGameStateId));
    const isLocked =
      activeForCurrentState &&
      (zone.unlockMode === "gold"
        ? zone.enabled && !goldUnlockActive
        : zone.enabled &&
          requiredTodoIds.length > 0 &&
          requiredTodoIds.some((todoId) => statusByTodo.get(todoId) !== "done") &&
          !goldUnlockActive);
    return {
      zone,
      requiredTodoIds,
      requiredTodoTitles,
      goldUnlockActive,
      isLocked,
      activeForGameStateIds,
      activeForCurrentState,
    };
  });
}
