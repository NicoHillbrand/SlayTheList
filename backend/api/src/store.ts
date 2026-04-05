import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, referenceImagesDir } from "./db.js";
import type {
  AccountabilityState,
  BaseCurrencyType,
  BaseState,
  Block,
  BlockUnlockMode,
  BuildingPlacement,
  DetectedGameState,
  GameState,
  GameStateDetectionRegion,
  GameStateReferenceImage,
  GoldState,
  Habit,
  LockZone,
  LockZoneState,
  Prediction,
  Progression,
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
  push_count: number;
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
  locked: 0 | 1;
  unlock_mode: "todos" | "gold";
  cooldown_enabled: 0 | 1;
  cooldown_seconds: number;
  gold_cost: number;
  block_id: string | null;
  created_at: string;
  updated_at: string;
};

type BlockRow = {
  id: string;
  name: string;
  game_state_id: string;
  unlock_mode: "independent" | "shared";
  enabled: 0 | 1;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type AccountabilityStateRow = {
  user_id?: string;
  habits_json: string;
  predictions_json: string;
  reflections_json: string;
  updated_at: string;
};

type GoldStateRow = {
  user_id?: string;
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
    pushCount: row.push_count ?? 0,
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
    locked: !!row.locked,
    unlockMode: row.unlock_mode ?? "todos",
    cooldownEnabled: !!row.cooldown_enabled,
    cooldownSeconds: row.cooldown_seconds ?? 3600,
    goldCost: row.gold_cost ?? 10,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    name: row.name,
    gameStateId: row.game_state_id,
    unlockMode: row.unlock_mode,
    enabled: !!row.enabled,
    sortOrder: row.sort_order,
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
    pushCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO todos
      (id, title, context, status, indent, sort_order, deadline_at, archived_at, completed_at, push_count, created_at, updated_at)
     VALUES
      (@id, @title, @context, @status, @indent, @sortOrder, @deadlineAt, @archivedAt, @completedAt, @pushCount, @createdAt, @updatedAt)`,
  ).run(todo);
  return todo;
}

export function updateTodo(
  id: string,
  patch: Partial<Pick<Todo, "title" | "context" | "status" | "indent" | "deadlineAt" | "archivedAt" | "pushCount">>,
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
    pushCount: patch.pushCount ?? current.pushCount,
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
         push_count = ?,
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
    next.pushCount,
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

export function createZone(input: Omit<LockZone, "id" | "createdAt" | "updatedAt">, blockId?: string): LockZone {
  const now = new Date().toISOString();
  const zone: LockZone = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO lock_zones (id, name, x, y, width, height, locked, unlock_mode, cooldown_enabled, cooldown_seconds, gold_cost, block_id, created_at, updated_at)
     VALUES (@id, @name, @x, @y, @width, @height, @locked, @unlockMode, @cooldownEnabled, @cooldownSeconds, @goldCost, @blockId, @createdAt, @updatedAt)`,
  ).run({
    ...zone,
    locked: zone.locked ? 1 : 0,
    cooldownEnabled: zone.cooldownEnabled ? 1 : 0,
    blockId: blockId ?? null,
  });
  return zone;
}

export function updateZone(
  id: string,
  patch: Partial<Pick<LockZone, "name" | "x" | "y" | "width" | "height" | "locked" | "unlockMode" | "cooldownEnabled" | "cooldownSeconds" | "goldCost">>,
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
       SET name = ?, x = ?, y = ?, width = ?, height = ?, locked = ?, unlock_mode = ?,
           cooldown_enabled = ?, cooldown_seconds = ?, gold_cost = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.name, next.x, next.y, next.width, next.height,
    next.locked ? 1 : 0, next.unlockMode,
    next.cooldownEnabled ? 1 : 0, next.cooldownSeconds, next.goldCost,
    next.updatedAt, id,
  );
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

export function spendGoldAndActivateUnlock(zoneId: string, amount: number, userId?: string): void {
  db.transaction(() => {
    spendGold(amount, userId);

    // Disable the zone (unlocked)
    db.prepare("UPDATE lock_zones SET locked = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), zoneId);

    // Record cooldown timer if cooldown is enabled, so the zone re-locks later
    const zoneRow = db.prepare("SELECT * FROM lock_zones WHERE id = ?").get(zoneId) as ZoneRow | undefined;
    if (zoneRow) {
      const zone = toZone(zoneRow);
      if (zone.cooldownEnabled && zone.cooldownSeconds > 0) {
        const expiresAt = new Date(Date.now() + zone.cooldownSeconds * 1000).toISOString();
        db.prepare(
          `INSERT INTO lock_zone_gold_unlocks (zone_id, created_at, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(zone_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at`,
        ).run(zoneId, new Date().toISOString(), expiresAt);
      }
    }

    // Shared block: unlock all sibling zones too
    if (zoneRow?.block_id) {
      const blockRow = db.prepare("SELECT unlock_mode FROM blocks WHERE id = ?").get(zoneRow.block_id) as { unlock_mode: string } | undefined;
      if (blockRow?.unlock_mode === "shared") {
        const clickedZone = toZone(zoneRow);
        const expiresAt =
          clickedZone.cooldownEnabled && clickedZone.cooldownSeconds > 0
            ? new Date(Date.now() + clickedZone.cooldownSeconds * 1000).toISOString()
            : null;
        const now = new Date().toISOString();
        const siblingRows = db
          .prepare("SELECT id FROM lock_zones WHERE block_id = ? AND id != ?")
          .all(zoneRow.block_id, zoneId) as Array<{ id: string }>;
        for (const sibling of siblingRows) {
          db.prepare("UPDATE lock_zones SET locked = 0, updated_at = ? WHERE id = ?")
            .run(now, sibling.id);
          if (expiresAt) {
            db.prepare(
              `INSERT INTO lock_zone_gold_unlocks (zone_id, created_at, expires_at)
               VALUES (?, ?, ?)
               ON CONFLICT(zone_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at`,
            ).run(sibling.id, now, expiresAt);
          }
        }
      }
    }
  })();
}

export function activateZoneGoldUnlock(zoneId: string): void {
  const zoneRow = db.prepare("SELECT * FROM lock_zones WHERE id = ?").get(zoneId) as ZoneRow | undefined;
  const zone = zoneRow ? toZone(zoneRow) : null;
  const expiresAt =
    zone?.cooldownEnabled && zone.cooldownSeconds > 0
      ? new Date(Date.now() + zone.cooldownSeconds * 1000).toISOString()
      : null;
  db.prepare(
    `INSERT INTO lock_zone_gold_unlocks (zone_id, created_at, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(zone_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at`,
  ).run(zoneId, new Date().toISOString(), expiresAt);
}

export function clearZoneGoldUnlock(zoneId: string): void {
  db.prepare("DELETE FROM lock_zone_gold_unlocks WHERE zone_id = ?").run(zoneId);
}

export function expireGoldUnlocks(): void {
  const now = new Date().toISOString();
  const expired = db.prepare(
    "SELECT zone_id FROM lock_zone_gold_unlocks WHERE expires_at IS NOT NULL AND expires_at <= ?",
  ).all(now) as Array<{ zone_id: string }>;
  for (const row of expired) {
    db.prepare("UPDATE lock_zones SET locked = 1, updated_at = ? WHERE id = ?").run(now, row.zone_id);
  }
  db.prepare(
    "DELETE FROM lock_zone_gold_unlocks WHERE expires_at IS NOT NULL AND expires_at <= ?",
  ).run(now);
}

function safeParseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getAccountabilityState(userId?: string): AccountabilityState {
  const row = userId
    ? (db
        .prepare(
          `SELECT user_id, habits_json, predictions_json, reflections_json, updated_at
           FROM user_accountability_state
           WHERE user_id = ?`,
        )
        .get(userId) as AccountabilityStateRow | undefined)
    : (db
        .prepare(
          "SELECT habits_json, predictions_json, reflections_json, updated_at FROM accountability_state WHERE id = 1",
        )
        .get() as AccountabilityStateRow | undefined);
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

export function saveAccountabilityState(state: AccountabilityState, userId?: string): AccountabilityState {
  const updatedAt = new Date().toISOString();
  if (userId) {
    db.prepare(
      `INSERT INTO user_accountability_state (user_id, habits_json, predictions_json, reflections_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         habits_json = excluded.habits_json,
         predictions_json = excluded.predictions_json,
         reflections_json = excluded.reflections_json,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      JSON.stringify(state.habits),
      JSON.stringify(state.predictions),
      JSON.stringify(state.reflections),
      updatedAt,
    );
  } else {
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
  }
  return state;
}

export function getGoldState(userId?: string): GoldState {
  const row = userId
    ? (db
        .prepare(
          `SELECT user_id, gold, rewarded_todo_ids_json, updated_at
           FROM user_gold_state
           WHERE user_id = ?`,
        )
        .get(userId) as GoldStateRow | undefined)
    : (db
        .prepare("SELECT gold, rewarded_todo_ids_json, updated_at FROM gold_state WHERE id = 1")
        .get() as GoldStateRow | undefined);
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

export function saveGoldState(state: GoldState, userId?: string): GoldState {
  const normalized: GoldState = {
    gold: Math.max(0, Math.floor(state.gold)),
    rewardedTodoIds: [...new Set(state.rewardedTodoIds)],
  };
  const updatedAt = new Date().toISOString();
  if (userId) {
    db.prepare(
      `INSERT INTO user_gold_state (user_id, gold, rewarded_todo_ids_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         gold = excluded.gold,
         rewarded_todo_ids_json = excluded.rewarded_todo_ids_json,
         updated_at = excluded.updated_at`,
    ).run(userId, normalized.gold, JSON.stringify(normalized.rewardedTodoIds), updatedAt);
  } else {
    db.prepare(
      `UPDATE gold_state
       SET gold = ?, rewarded_todo_ids_json = ?, updated_at = ?
       WHERE id = 1`,
    ).run(normalized.gold, JSON.stringify(normalized.rewardedTodoIds), updatedAt);
  }
  return normalized;
}

export function awardGold(amount: number, userId?: string): GoldState {
  const current = getGoldState(userId);
  return saveGoldState({
    gold: current.gold + Math.max(0, Math.floor(amount)),
    rewardedTodoIds: current.rewardedTodoIds,
  }, userId);
}

export function awardTodoGold(todoId: string, amount: number, userId?: string): { state: GoldState; awarded: boolean } {
  const current = getGoldState(userId);
  if (current.rewardedTodoIds.includes(todoId)) {
    return { state: current, awarded: false };
  }
  const state = saveGoldState({
    gold: current.gold + Math.max(0, Math.floor(amount)),
    rewardedTodoIds: [...current.rewardedTodoIds, todoId],
  }, userId);
  return { state, awarded: true };
}

export function deductGold(amount: number, userId?: string): GoldState {
  const normalizedAmount = Math.max(0, Math.floor(amount));
  const current = getGoldState(userId);
  return saveGoldState({
    gold: Math.max(0, current.gold - normalizedAmount),
    rewardedTodoIds: current.rewardedTodoIds,
  }, userId);
}

export function spendGold(amount: number, userId?: string): GoldState {
  const normalizedAmount = Math.max(0, Math.floor(amount));
  const current = getGoldState(userId);
  if (current.gold < normalizedAmount) {
    throw new Error("not enough gold");
  }
  return saveGoldState({
    gold: current.gold - normalizedAmount,
    rewardedTodoIds: current.rewardedTodoIds,
  }, userId);
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
  always_detect: 0 | 1;
  created_at: string;
  updated_at: string;
};

type DetectionRegionRow = {
  id: string;
  game_state_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
    alwaysDetect: !!row.always_detect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDetectionRegion(row: DetectionRegionRow): GameStateDetectionRegion {
  return {
    id: row.id,
    gameStateId: row.game_state_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
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
  ).run(id, input.name.trim(), input.matchThreshold ?? 0.9, now, now);
  return getGameState(id)!;
}

export function updateGameState(
  id: string,
  patch: Partial<Pick<GameState, "name" | "enabled" | "matchThreshold" | "alwaysDetect">>,
): GameState | undefined {
  const existing = getGameState(id);
  if (!existing) return undefined;
  const next = {
    name: patch.name ?? existing.name,
    enabled: patch.enabled ?? existing.enabled,
    matchThreshold: patch.matchThreshold ?? existing.matchThreshold,
    alwaysDetect: patch.alwaysDetect ?? existing.alwaysDetect,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE game_states SET name = ?, enabled = ?, match_threshold = ?, always_detect = ?, updated_at = ? WHERE id = ?`,
  ).run(next.name, next.enabled ? 1 : 0, next.matchThreshold, next.alwaysDetect ? 1 : 0, next.updatedAt, id);
  return getGameState(id);
}

export function listDetectionRegions(gameStateId: string): GameStateDetectionRegion[] {
  const rows = db
    .prepare("SELECT * FROM game_state_detection_regions WHERE game_state_id = ? ORDER BY rowid ASC")
    .all(gameStateId) as DetectionRegionRow[];
  return rows.map(toDetectionRegion);
}

export function setDetectionRegions(
  gameStateId: string,
  regions: Array<{ x: number; y: number; width: number; height: number }>,
): GameStateDetectionRegion[] {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM game_state_detection_regions WHERE game_state_id = ?").run(gameStateId);
    const stmt = db.prepare(
      "INSERT INTO game_state_detection_regions (id, game_state_id, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const r of regions) {
      stmt.run(randomUUID(), gameStateId, r.x, r.y, r.width, r.height);
    }
  });
  tx();
  return listDetectionRegions(gameStateId);
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

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export function listBlocks(): Block[] {
  const rows = db.prepare("SELECT * FROM blocks ORDER BY sort_order ASC, created_at ASC").all() as BlockRow[];
  return rows.map(toBlock);
}

export function getBlock(id: string): Block | undefined {
  const row = db.prepare("SELECT * FROM blocks WHERE id = ?").get(id) as BlockRow | undefined;
  return row ? toBlock(row) : undefined;
}

export function createBlock(
  name: string,
  gameStateId: string,
  unlockMode?: BlockUnlockMode,
): Block {
  const now = new Date().toISOString();
  const nextSortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM blocks").get() as {
    next: number;
  };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO blocks (id, name, game_state_id, unlock_mode, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(id, name.trim(), gameStateId, unlockMode ?? "independent", nextSortOrder.next, now, now);
  return getBlock(id)!;
}

export function updateBlock(
  id: string,
  patch: Partial<Pick<Block, "name" | "gameStateId" | "unlockMode" | "enabled" | "sortOrder">>,
): Block | undefined {
  const existing = getBlock(id);
  if (!existing) return undefined;
  const next = {
    name: patch.name ?? existing.name,
    gameStateId: patch.gameStateId ?? existing.gameStateId,
    unlockMode: patch.unlockMode ?? existing.unlockMode,
    enabled: patch.enabled ?? existing.enabled,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `UPDATE blocks SET name = ?, game_state_id = ?, unlock_mode = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
  ).run(next.name, next.gameStateId, next.unlockMode, next.enabled ? 1 : 0, next.sortOrder, next.updatedAt, id);
  return getBlock(id);
}

export function deleteBlock(id: string): boolean {
  const result = db.prepare("DELETE FROM blocks WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listZonesForBlock(blockId: string): LockZone[] {
  const rows = db.prepare("SELECT * FROM lock_zones WHERE block_id = ? ORDER BY created_at DESC").all(blockId) as ZoneRow[];
  return rows.map(toZone);
}

export function listOverlayState(): LockZoneState[] {
  expireGoldUnlocks();

  const zones = listZones();
  const requiredRows = db
    .prepare("SELECT zone_id, todo_id FROM lock_zone_requirements")
    .all() as Array<{ zone_id: string; todo_id: string }>;
  const goldUnlockRows = db
    .prepare("SELECT zone_id, expires_at FROM lock_zone_gold_unlocks")
    .all() as Array<{ zone_id: string; expires_at: string | null }>;
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

  // Build block lookup: zone block_id -> block unlock_mode
  const zoneBlockRows = db
    .prepare("SELECT id, block_id FROM lock_zones WHERE block_id IS NOT NULL")
    .all() as Array<{ id: string; block_id: string }>;
  const blockIdByZone = new Map<string, string>();
  const blockIdsNeeded = new Set<string>();
  for (const row of zoneBlockRows) {
    blockIdByZone.set(row.id, row.block_id);
    blockIdsNeeded.add(row.block_id);
  }
  const blockUnlockModeById = new Map<string, "independent" | "shared">();
  const blockGameStateById = new Map<string, string>();
  const blockEnabledById = new Map<string, boolean>();
  for (const bId of blockIdsNeeded) {
    const blockRow = db.prepare("SELECT unlock_mode, game_state_id, enabled FROM blocks WHERE id = ?").get(bId) as { unlock_mode: "independent" | "shared"; game_state_id: string; enabled: number } | undefined;
    if (blockRow) {
      blockUnlockModeById.set(bId, blockRow.unlock_mode);
      blockGameStateById.set(bId, blockRow.game_state_id);
      blockEnabledById.set(bId, !!blockRow.enabled);
    }
  }

  const detected = getDetectedGameState();
  const currentGameStateId = detected.gameStateId;

  const activeTodoRows = todoRows.filter(
    (row) => !row.archived_at && row.title.trim().length > 0,
  );
  const activeTodoIds = new Set(activeTodoRows.map((row) => row.id));
  const statusByTodo = new Map(activeTodoRows.map((t) => [t.id, t.status]));
  const titleByTodo = new Map(activeTodoRows.map((t) => [t.id, t.title]));
  const goldUnlockByZone = new Map(goldUnlockRows.map((row) => [row.zone_id, row.expires_at ?? null]));
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
    const goldUnlockActive = goldUnlockByZone.has(zone.id);
    const cooldownExpiresAt = goldUnlockByZone.get(zone.id) ?? null;
    const activeForGameStateIds = gameStatesByZone.get(zone.id) ?? [];
    const zoneBlockId = blockIdByZone.get(zone.id) ?? null;

    // Check block-level game state: if the zone belongs to a block with a specific
    // game state, the block's state must match the current detected state.
    const blockGameStateId = zoneBlockId ? (blockGameStateById.get(zoneBlockId) ?? null) : null;
    // Zones must belong to an enabled block to be active. Orphaned zones are never active.
    const blockEnabled = zoneBlockId ? (blockEnabledById.get(zoneBlockId) ?? false) : false;
    const blockActiveForCurrentState =
      blockEnabled &&
      (blockGameStateId === null ||
        (currentGameStateId !== null && blockGameStateId === currentGameStateId));

    // Check zone-level game state restrictions (if any).
    const zoneActiveForCurrentState =
      activeForGameStateIds.length === 0 ||
      (currentGameStateId !== null && activeForGameStateIds.includes(currentGameStateId));

    const activeForCurrentState = blockActiveForCurrentState && zoneActiveForCurrentState;
    const isLocked = activeForCurrentState && zone.locked;
    const zoneBlockUnlockMode = zoneBlockId ? (blockUnlockModeById.get(zoneBlockId) ?? null) : null;
    return {
      zone,
      requiredTodoIds,
      requiredTodoTitles,
      goldUnlockActive,
      cooldownExpiresAt,
      isLocked,
      activeForGameStateIds,
      activeForCurrentState,
      blockId: zoneBlockId,
      blockUnlockMode: zoneBlockUnlockMode,
    };
  });
}

// ---------------------------------------------------------------------------
// App Settings
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------------------------------------------------------------------------
// Base Builder
// ---------------------------------------------------------------------------

type BaseStateRow = {
  placements_json: string;
  inventory_json: string;
  diamonds: number;
  emeralds: number;
  diamond_milestones_json: string;
  updated_at: string;
};

type BaseInventory = Record<string, number>;

export function getBaseState(): BaseState {
  const row = db.prepare("SELECT placements_json, inventory_json, diamonds, emeralds, diamond_milestones_json, updated_at FROM base_state WHERE id = 1").get() as BaseStateRow | undefined;
  if (!row) {
    return { placements: [], inventory: {}, currencies: { gold: 0, diamonds: 0, emeralds: 0 }, diamondMilestones: [], updatedAt: new Date().toISOString() };
  }
  const goldState = getGoldState();
  return {
    placements: JSON.parse(row.placements_json) as BuildingPlacement[],
    inventory: JSON.parse(row.inventory_json) as BaseInventory,
    currencies: { gold: goldState.gold, diamonds: row.diamonds, emeralds: row.emeralds },
    diamondMilestones: JSON.parse(row.diamond_milestones_json) as number[],
    updatedAt: row.updated_at,
  };
}

export function saveBaseState(state: { placements: BuildingPlacement[]; inventory: BaseInventory }): BaseState {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE base_state SET placements_json = ?, inventory_json = ?, updated_at = ? WHERE id = 1`,
  ).run(JSON.stringify(state.placements), JSON.stringify(state.inventory), now);
  return getBaseState();
}

/** Streak milestones that award diamonds: [streakLength, diamondReward] */
const DIAMOND_MILESTONES: [number, number][] = [
  [3, 1],
  [7, 3],
  [14, 5],
  [30, 10],
  [60, 20],
  [90, 30],
  [180, 50],
  [365, 100],
];

/** Check and award diamonds for any new streak milestones reached. */
export function checkAndAwardDiamonds(): { awarded: number; newMilestones: number[] } {
  const baseState = getBaseState();
  const progression = getProgression();
  const currentStreak = progression.longestDayStreak;
  const claimed = new Set(baseState.diamondMilestones);

  let awarded = 0;
  const newMilestones: number[] = [];

  for (const [streak, reward] of DIAMOND_MILESTONES) {
    if (currentStreak >= streak && !claimed.has(streak)) {
      awarded += reward;
      newMilestones.push(streak);
    }
  }

  if (awarded > 0) {
    const allMilestones = [...baseState.diamondMilestones, ...newMilestones];
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE base_state SET diamonds = diamonds + ?, diamond_milestones_json = ?, updated_at = ? WHERE id = 1`,
    ).run(awarded, JSON.stringify(allMilestones), now);
  }

  return { awarded, newMilestones };
}

export function purchaseBaseItem(itemId: string, cost: number, currency: BaseCurrencyType = "gold"): { gold: number; diamonds: number; emeralds: number; inventory: BaseInventory } {
  if (currency === "gold") {
    spendGold(cost);
  } else {
    const baseState = getBaseState();
    const current = baseState.currencies[currency];
    if (current < cost) throw new Error(`not enough ${currency}`);
    const now = new Date().toISOString();
    db.prepare(`UPDATE base_state SET ${currency} = ${currency} - ?, updated_at = ? WHERE id = 1`).run(cost, now);
  }

  // Add item to inventory
  const baseState = getBaseState();
  const inventory = { ...baseState.inventory };
  inventory[itemId] = (inventory[itemId] ?? 0) + 1;
  const now = new Date().toISOString();
  db.prepare(`UPDATE base_state SET inventory_json = ?, updated_at = ? WHERE id = 1`).run(JSON.stringify(inventory), now);

  const updated = getBaseState();
  return { gold: updated.currencies.gold, diamonds: updated.currencies.diamonds, emeralds: updated.currencies.emeralds, inventory: updated.inventory };
}

export function getProgression(): Progression {
  const goldState = getGoldState();
  const baseRow = db.prepare("SELECT diamonds, emeralds FROM base_state WHERE id = 1").get() as { diamonds: number; emeralds: number } | undefined;

  const todoStats = db.prepare(`
    SELECT
      COUNT(*) AS total_created,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS total_completed
    FROM todos
  `).get() as { total_created: number; total_completed: number };

  const accRow = db.prepare("SELECT habits_json, predictions_json, reflections_json FROM accountability_state WHERE id = 1").get() as {
    habits_json: string;
    predictions_json: string;
    reflections_json: string;
  } | undefined;

  const habits: Habit[] = accRow ? JSON.parse(accRow.habits_json) : [];
  const predictions = accRow ? (JSON.parse(accRow.predictions_json) as unknown[]) : [];
  const reflections = accRow ? (JSON.parse(accRow.reflections_json) as unknown[]) : [];

  const activeHabitsCount = habits.filter((h) => h.status === "active").length;
  const totalHabitChecks = habits.reduce((sum, h) => sum + h.checks.filter((c) => c.done).length, 0);

  // Compute day streaks from completed todo dates
  const completedDates = db.prepare(`
    SELECT DISTINCT DATE(completed_at) AS d FROM todos
    WHERE status = 'done' AND completed_at IS NOT NULL
    ORDER BY d DESC
  `).all() as Array<{ d: string }>;

  let currentDayStreak = 0;
  let longestDayStreak = 0;

  if (completedDates.length > 0) {
    const dates = completedDates.map((r) => r.d);
    const today = new Date().toISOString().slice(0, 10);

    // Current streak: count consecutive days backwards from today (or yesterday)
    let streak = 0;
    let expected = today;
    for (const d of dates) {
      if (d === expected) {
        streak++;
        const prev = new Date(expected);
        prev.setDate(prev.getDate() - 1);
        expected = prev.toISOString().slice(0, 10);
      } else if (streak === 0 && d === expected) {
        // already handled
      } else if (streak === 0) {
        // Check if yesterday
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d === yesterday.toISOString().slice(0, 10)) {
          streak = 1;
          const prev = new Date(d);
          prev.setDate(prev.getDate() - 1);
          expected = prev.toISOString().slice(0, 10);
        } else {
          break;
        }
      } else {
        break;
      }
    }
    currentDayStreak = streak;

    // Longest streak: scan all dates
    const dateSet = new Set(dates);
    const sorted = [...dateSet].sort();
    let run = 1;
    longestDayStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      prev.setDate(prev.getDate() + 1);
      if (prev.toISOString().slice(0, 10) === sorted[i]) {
        run++;
        if (run > longestDayStreak) longestDayStreak = run;
      } else {
        run = 1;
      }
    }
  }

  return {
    gold: goldState.gold,
    diamonds: baseRow?.diamonds ?? 0,
    emeralds: baseRow?.emeralds ?? 0,
    totalTodosCompleted: todoStats.total_completed ?? 0,
    totalTodosCreated: todoStats.total_created ?? 0,
    currentDayStreak,
    longestDayStreak,
    activeHabitsCount,
    totalHabitChecks,
    totalPredictions: predictions.length,
    totalReflections: reflections.length,
  };
}
