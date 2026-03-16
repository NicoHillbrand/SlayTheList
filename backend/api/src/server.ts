import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  accountabilityStateSchema,
  goldStateSchema,
  habitCheckSchema,
  habitStatusSchema,
  predictionOutcomeSchema,
  reflectionEntrySchema,
  type EventEnvelope,
  type OverlayState,
} from "@slaythelist/contracts";
import {
  activateZoneGoldUnlock,
  clearZoneGoldUnlock,
  createTodo,
  createZone,
  deleteTodo,
  deleteZone,
  getAccountabilityState,
  getGoldState,
  listOverlayState,
  listTodos,
  listZones,
  reorderTodos,
  saveGoldState,
  spendGold,
  awardGold,
  awardTodoGold,
  saveAccountabilityState,
  setZoneRequirements,
  updateTodo,
  updateZone,
} from "./store.js";
import { errorLogger, requestLogger } from "./logger.js";

const port = Number(process.env.PORT ?? 8788);
const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

function buildOverlayState(): OverlayState {
  return {
    gameWindow: { titleHint: "Slay the Spire 2" },
    zones: listOverlayState(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function ok(res: express.Response, payload: unknown) {
  res.status(200).json(payload);
}

function badRequest(res: express.Response, message: string) {
  res.status(400).json({ error: message });
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) ? next : fallback;
}

function parseOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseZoneUnlockMode(value: unknown): "todos" | "gold" | undefined {
  if (value === undefined) return undefined;
  return value === "todos" || value === "gold" ? value : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function parseDeadlineAt(
  deadlineAt: unknown,
  deadlineTime: unknown,
  options: { allowUndefined: boolean },
): { value: string | null | undefined; error?: string } {
  if (deadlineAt === undefined) {
    if (deadlineTime !== undefined) {
      return { value: undefined, error: "deadlineTime requires deadlineAt" };
    }
    return { value: options.allowUndefined ? undefined : null };
  }

  if (deadlineAt === null) {
    if (deadlineTime !== undefined) {
      return { value: undefined, error: "deadlineTime cannot be used when deadlineAt is null" };
    }
    return { value: null };
  }

  if (typeof deadlineAt !== "string") {
    return { value: undefined, error: "deadlineAt must be a string or null" };
  }
  if (deadlineTime !== undefined && typeof deadlineTime !== "string") {
    return { value: undefined, error: "deadlineTime must be a string in HH:mm format" };
  }

  const baseInput = deadlineAt.trim();
  if (!baseInput) {
    return { value: undefined, error: "deadlineAt cannot be empty" };
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseInput);
  const baseDate = dateOnlyMatch ? new Date(`${baseInput}T00:00:00`) : new Date(baseInput);
  if (!Number.isFinite(baseDate.getTime())) {
    return { value: undefined, error: "deadlineAt must be a valid date or ISO datetime string" };
  }

  if (typeof deadlineTime === "string") {
    const timeInput = deadlineTime.trim();
    const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeInput);
    if (!timeMatch) {
      return { value: undefined, error: "deadlineTime must be in HH:mm format (24-hour)" };
    }
    const withTime = new Date(baseDate);
    withTime.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    return { value: withTime.toISOString() };
  }

  return { value: baseDate.toISOString() };
}

app.get("/health", (_req, res) => {
  ok(res, { status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/todos", (_req, res) => {
  ok(res, { items: listTodos() });
});

app.post("/api/todos", (req, res) => {
  const title = req.body?.title;
  const deadlineAt = req.body?.deadlineAt;
  const deadlineTime = req.body?.deadlineTime;
  if (typeof title !== "string") {
    return badRequest(res, "title is required");
  }
  const parsedDeadline = parseDeadlineAt(deadlineAt, deadlineTime, { allowUndefined: false });
  if (parsedDeadline.error) {
    return badRequest(res, parsedDeadline.error);
  }
  const created = createTodo(title, { deadlineAt: parsedDeadline.value ?? null });
  ok(res, created);
  broadcastOverlayState();
});

app.patch("/api/todos/:id", (req, res) => {
  const status = req.body?.status;
  const title = req.body?.title;
  const context = req.body?.context;
  const indent = req.body?.indent;
  const archived = req.body?.archived;
  const deadlineAt = req.body?.deadlineAt;
  const deadlineTime = req.body?.deadlineTime;
  const parsedStatus = status === undefined ? undefined : status === "active" || status === "done" ? status : null;
  if (parsedStatus === null) {
    return badRequest(res, "status must be active or done");
  }
  if (title !== undefined && typeof title !== "string") {
    return badRequest(res, "title must be a string");
  }
  if (context !== undefined && typeof context !== "string") {
    return badRequest(res, "context must be a string");
  }
  const parsedIndent =
    indent === undefined
      ? undefined
      : typeof indent === "number" && Number.isInteger(indent) && indent >= 0
        ? indent
        : null;
  if (parsedIndent === null) {
    return badRequest(res, "indent must be a non-negative integer");
  }
  const parsedArchived =
    archived === undefined ? undefined : typeof archived === "boolean" ? archived : null;
  if (parsedArchived === null) {
    return badRequest(res, "archived must be a boolean");
  }
  const parsedDeadline = parseDeadlineAt(deadlineAt, deadlineTime, { allowUndefined: true });
  if (parsedDeadline.error) {
    return badRequest(res, parsedDeadline.error);
  }
  if (
    parsedStatus === undefined &&
    title === undefined &&
    context === undefined &&
    parsedIndent === undefined &&
    parsedArchived === undefined &&
    parsedDeadline.value === undefined
  ) {
    return badRequest(res, "no valid todo fields provided");
  }
  const updated = updateTodo(req.params.id, {
    status: parsedStatus,
    title,
    context: context === undefined ? undefined : context.trim(),
    indent: parsedIndent,
    deadlineAt: parsedDeadline.value,
    archivedAt: parsedArchived === undefined ? undefined : parsedArchived ? new Date().toISOString() : null,
  });
  if (!updated) {
    return res.status(404).json({ error: "todo not found" });
  }
  ok(res, updated);
  broadcastOverlayState();
});

app.put("/api/todos/reorder", (req, res) => {
  const orderedTodoIds = req.body?.orderedTodoIds;
  if (!Array.isArray(orderedTodoIds) || orderedTodoIds.some((id) => typeof id !== "string")) {
    return badRequest(res, "orderedTodoIds must be an array of todo ids");
  }
  try {
    const items = reorderTodos(orderedTodoIds);
    ok(res, { items });
    broadcastOverlayState();
  } catch (error) {
    return badRequest(res, `invalid reorder payload: ${(error as Error).message}`);
  }
});

app.get("/api/accountability-state", (_req, res) => {
  ok(res, getAccountabilityState());
});

app.put("/api/accountability-state", (req, res) => {
  const parsed = accountabilityStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid accountability state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  const saved = saveAccountabilityState(parsed.data);
  ok(res, saved);
});

app.get("/api/gold-state", (_req, res) => {
  ok(res, getGoldState());
});

app.put("/api/gold-state", (req, res) => {
  const parsed = goldStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid gold state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  ok(res, saveGoldState(parsed.data));
});

app.post("/api/gold/award", (req, res) => {
  const amount = req.body?.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  ok(res, awardGold(amount));
});

app.post("/api/gold/award-todo", (req, res) => {
  const todoId = req.body?.todoId;
  const amount = req.body?.amount;
  if (typeof todoId !== "string" || !todoId.trim()) {
    return badRequest(res, "todoId is required");
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  const result = awardTodoGold(todoId.trim(), amount);
  ok(res, result);
});

app.get("/api/habits", (_req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  ok(res, { items: state.habits });
});

app.post("/api/habits", (req, res) => {
  const name = req.body?.name;
  const statusInput = req.body?.status;
  if (typeof name !== "string" || !name.trim()) {
    return badRequest(res, "name is required");
  }
  const statusParsed = statusInput === undefined ? { success: true, data: "active" as const } : habitStatusSchema.safeParse(statusInput);
  if (!statusParsed.success) {
    return badRequest(res, "status must be active, archived, or idea");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const created = {
    id: randomUUID(),
    name: name.trim(),
    checks: [],
    createdAt: Date.now(),
    status: statusParsed.data,
  };
  const saved = saveAccountabilityState({ ...state, habits: [...state.habits, created] });
  ok(res, created);
});

app.patch("/api/habits/:id", (req, res) => {
  const patch = req.body ?? {};
  const nextName = patch.name;
  const nextStatus = patch.status;
  const nextChecks = patch.checks;
  if (nextName !== undefined && typeof nextName !== "string") {
    return badRequest(res, "name must be a string");
  }
  const statusParsed = nextStatus === undefined ? { success: true, data: undefined } : habitStatusSchema.safeParse(nextStatus);
  if (!statusParsed.success) {
    return badRequest(res, "status must be active, archived, or idea");
  }
  const checksParsed =
    nextChecks === undefined ? { success: true, data: undefined } : habitCheckSchema.array().safeParse(nextChecks);
  if (!checksParsed.success) {
    return badRequest(res, "checks must be an array of { date, done }");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const index = state.habits.findIndex((habit) => habit.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: "habit not found" });
  }
  const current = state.habits[index];
  const updated = {
    ...current,
    name: nextName === undefined ? current.name : nextName.trim(),
    status: statusParsed.data === undefined ? current.status : statusParsed.data,
    checks: checksParsed.data === undefined ? current.checks : checksParsed.data,
  };
  const nextHabits = [...state.habits];
  nextHabits[index] = updated;
  saveAccountabilityState({ ...state, habits: nextHabits });
  ok(res, updated);
});

app.delete("/api/habits/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextHabits = state.habits.filter((habit) => habit.id !== req.params.id);
  if (nextHabits.length === state.habits.length) {
    return res.status(404).json({ error: "habit not found" });
  }
  saveAccountabilityState({ ...state, habits: nextHabits });
  ok(res, { deleted: true });
});

app.get("/api/predictions", (_req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  ok(res, { items: state.predictions });
});

app.post("/api/predictions", (req, res) => {
  const title = req.body?.title;
  const confidence = req.body?.confidence;
  if (typeof title !== "string" || !title.trim()) {
    return badRequest(res, "title is required");
  }
  if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 1 || confidence > 99) {
    return badRequest(res, "confidence must be an integer between 1 and 99");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const created = {
    id: randomUUID(),
    title: title.trim(),
    confidence,
    outcome: "pending" as const,
    createdAt: Date.now(),
    resolvedAt: null,
  };
  saveAccountabilityState({ ...state, predictions: [...state.predictions, created] });
  ok(res, created);
});

app.patch("/api/predictions/:id", (req, res) => {
  const patch = req.body ?? {};
  const nextTitle = patch.title;
  const nextConfidence = patch.confidence;
  const nextOutcome = patch.outcome;
  const nextResolvedAt = patch.resolvedAt;
  if (nextTitle !== undefined && typeof nextTitle !== "string") {
    return badRequest(res, "title must be a string");
  }
  if (
    nextConfidence !== undefined &&
    (typeof nextConfidence !== "number" || !Number.isInteger(nextConfidence) || nextConfidence < 1 || nextConfidence > 99)
  ) {
    return badRequest(res, "confidence must be an integer between 1 and 99");
  }
  const outcomeParsed =
    nextOutcome === undefined ? { success: true, data: undefined } : predictionOutcomeSchema.safeParse(nextOutcome);
  if (!outcomeParsed.success) {
    return badRequest(res, "outcome must be pending, hit, or miss");
  }
  if (
    nextResolvedAt !== undefined &&
    nextResolvedAt !== null &&
    (typeof nextResolvedAt !== "number" || !Number.isFinite(nextResolvedAt))
  ) {
    return badRequest(res, "resolvedAt must be a number timestamp or null");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const index = state.predictions.findIndex((prediction) => prediction.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: "prediction not found" });
  }
  const current = state.predictions[index];
  const resolvedAtFromOutcome =
    outcomeParsed.data === undefined
      ? undefined
      : outcomeParsed.data === "pending"
        ? null
        : current.resolvedAt ?? Date.now();
  const updated = {
    ...current,
    title: nextTitle === undefined ? current.title : nextTitle.trim(),
    confidence: nextConfidence === undefined ? current.confidence : nextConfidence,
    outcome: outcomeParsed.data === undefined ? current.outcome : outcomeParsed.data,
    resolvedAt:
      nextResolvedAt === undefined
        ? resolvedAtFromOutcome === undefined
          ? current.resolvedAt
          : resolvedAtFromOutcome
        : nextResolvedAt,
  };
  const nextPredictions = [...state.predictions];
  nextPredictions[index] = updated;
  saveAccountabilityState({ ...state, predictions: nextPredictions });
  ok(res, updated);
});

app.delete("/api/predictions/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextPredictions = state.predictions.filter((prediction) => prediction.id !== req.params.id);
  if (nextPredictions.length === state.predictions.length) {
    return res.status(404).json({ error: "prediction not found" });
  }
  saveAccountabilityState({ ...state, predictions: nextPredictions });
  ok(res, { deleted: true });
});

app.get("/api/reflections", (_req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  ok(res, { items: state.reflections });
});

app.post("/api/reflections", (req, res) => {
  const date = req.body?.date;
  if (typeof date !== "string" || !date.trim()) {
    return badRequest(res, "date is required");
  }
  const now = Date.now();
  const created = reflectionEntrySchema.parse({
    id: randomUUID(),
    date: date.trim(),
    wins: typeof req.body?.wins === "string" ? req.body.wins : "",
    challenges: typeof req.body?.challenges === "string" ? req.body.challenges : "",
    notes: typeof req.body?.notes === "string" ? req.body.notes : "",
    tomorrow: typeof req.body?.tomorrow === "string" ? req.body.tomorrow : "",
    createdAt: now,
    updatedAt: now,
  });
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  saveAccountabilityState({ ...state, reflections: [...state.reflections, created] });
  ok(res, created);
});

app.patch("/api/reflections/:id", (req, res) => {
  const patch = req.body ?? {};
  const nextDate = patch.date;
  const nextWins = patch.wins;
  const nextChallenges = patch.challenges;
  const nextNotes = patch.notes;
  const nextTomorrow = patch.tomorrow;
  if (nextDate !== undefined && typeof nextDate !== "string") {
    return badRequest(res, "date must be a string");
  }
  if (nextWins !== undefined && typeof nextWins !== "string") {
    return badRequest(res, "wins must be a string");
  }
  if (nextChallenges !== undefined && typeof nextChallenges !== "string") {
    return badRequest(res, "challenges must be a string");
  }
  if (nextNotes !== undefined && typeof nextNotes !== "string") {
    return badRequest(res, "notes must be a string");
  }
  if (nextTomorrow !== undefined && typeof nextTomorrow !== "string") {
    return badRequest(res, "tomorrow must be a string");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const index = state.reflections.findIndex((reflection) => reflection.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: "reflection not found" });
  }
  const current = state.reflections[index];
  const updated = reflectionEntrySchema.parse({
    ...current,
    date: nextDate === undefined ? current.date : nextDate.trim(),
    wins: nextWins === undefined ? current.wins : nextWins,
    challenges: nextChallenges === undefined ? current.challenges : nextChallenges,
    notes: nextNotes === undefined ? current.notes : nextNotes,
    tomorrow: nextTomorrow === undefined ? current.tomorrow : nextTomorrow,
    updatedAt: Date.now(),
  });
  const nextReflections = [...state.reflections];
  nextReflections[index] = updated;
  saveAccountabilityState({ ...state, reflections: nextReflections });
  ok(res, updated);
});

app.delete("/api/reflections/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextReflections = state.reflections.filter((reflection) => reflection.id !== req.params.id);
  if (nextReflections.length === state.reflections.length) {
    return res.status(404).json({ error: "reflection not found" });
  }
  saveAccountabilityState({ ...state, reflections: nextReflections });
  ok(res, { deleted: true });
});

app.delete("/api/todos/:id", (req, res) => {
  if (!deleteTodo(req.params.id)) {
    return res.status(404).json({ error: "todo not found" });
  }
  ok(res, { deleted: true });
  broadcastOverlayState();
});

app.get("/api/zones", (_req, res) => {
  ok(res, { items: listZones() });
});

app.post("/api/zones", (req, res) => {
  const body = req.body ?? {};
  if (!body.name || typeof body.name !== "string") {
    return badRequest(res, "name is required");
  }
  const width = asFiniteNumber(body.width, 240);
  const height = asFiniteNumber(body.height, 120);
  if (width <= 0 || height <= 0) {
    return badRequest(res, "width and height must be positive numbers");
  }
  const zone = createZone({
    name: body.name.trim(),
    x: asFiniteNumber(body.x, 100),
    y: asFiniteNumber(body.y, 100),
    width,
    height,
    enabled: body.enabled !== false,
    unlockMode: parseZoneUnlockMode(body.unlockMode) ?? "todos",
  });
  ok(res, zone);
  broadcastOverlayState();
});

app.patch("/api/zones/:id", (req, res) => {
  const patch = req.body ?? {};
  const parsedPatch = {
    name: typeof patch.name === "string" ? patch.name.trim() : undefined,
    x: parseOptionalFiniteNumber(patch.x),
    y: parseOptionalFiniteNumber(patch.y),
    width: parseOptionalFiniteNumber(patch.width),
    height: parseOptionalFiniteNumber(patch.height),
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    unlockMode: parseZoneUnlockMode(patch.unlockMode),
  };
  if (parsedPatch.width !== undefined && parsedPatch.width <= 0) {
    return badRequest(res, "width must be positive");
  }
  if (parsedPatch.height !== undefined && parsedPatch.height <= 0) {
    return badRequest(res, "height must be positive");
  }
  if (
    parsedPatch.name === undefined &&
    parsedPatch.x === undefined &&
    parsedPatch.y === undefined &&
    parsedPatch.width === undefined &&
    parsedPatch.height === undefined &&
    parsedPatch.enabled === undefined &&
    parsedPatch.unlockMode === undefined
  ) {
    return badRequest(res, "no valid zone fields provided");
  }
  const patchForUpdate = pruneUndefined(parsedPatch);
  const updated = updateZone(req.params.id, patchForUpdate);
  if (!updated) {
    return res.status(404).json({ error: "zone not found" });
  }
  ok(res, updated);
  broadcastOverlayState();
});

app.delete("/api/zones/:id", (req, res) => {
  if (!deleteZone(req.params.id)) {
    return res.status(404).json({ error: "zone not found" });
  }
  ok(res, { deleted: true });
  broadcastOverlayState();
});

app.put("/api/zones/:id/requirements", (req, res) => {
  const todoIds = req.body?.todoIds;
  if (!Array.isArray(todoIds) || todoIds.some((x) => typeof x !== "string")) {
    return badRequest(res, "todoIds must be an array of todo ids");
  }
  const zoneExists = listZones().some((zone) => zone.id === req.params.id);
  if (!zoneExists) {
    return res.status(404).json({ error: "zone not found" });
  }
  try {
    setZoneRequirements(req.params.id, todoIds);
  } catch (error) {
    return badRequest(res, `invalid requirements: ${(error as Error).message}`);
  }
  ok(res, { updated: true });
  broadcastOverlayState();
});

app.post("/api/zones/:id/gold-unlock", (req, res) => {
  const zoneState = listOverlayState().find((entry) => entry.zone.id === req.params.id);
  if (!zoneState) {
    return res.status(404).json({ error: "zone not found" });
  }
  if (!zoneState.zone.enabled) {
    return badRequest(res, "zone is disabled");
  }
  if (zoneState.zone.unlockMode === "todos" && zoneState.requiredTodoIds.length === 0) {
    return badRequest(res, "zone has no requirements to unlock");
  }
  if (!zoneState.isLocked) {
    return badRequest(res, "zone is already unlocked");
  }

  try {
    spendGold(10);
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
  activateZoneGoldUnlock(req.params.id);
  ok(res, { updated: true });
  broadcastOverlayState();
});

app.delete("/api/zones/:id/gold-unlock", (req, res) => {
  const zoneExists = listZones().some((zone) => zone.id === req.params.id);
  if (!zoneExists) {
    return res.status(404).json({ error: "zone not found" });
  }

  clearZoneGoldUnlock(req.params.id);
  ok(res, { updated: true });
  broadcastOverlayState();
});

app.get("/api/overlay-state", (_req, res) => {
  ok(res, buildOverlayState());
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

server.on("error", (error) => {
  if ("code" in error && error.code === "EADDRINUSE") {
    console.error(
      `[api] port ${port} is already in use. Stop the existing process or run with a different PORT.`,
    );
    process.exit(1);
  }
  console.error("[api] server error", error);
  process.exit(1);
});

wss.on("error", (error) => {
  console.error("[api] websocket server error", error);
});

function sendEvent(type: EventEnvelope["type"], payload: unknown) {
  const envelope: EventEnvelope = { type, payload };
  const data = JSON.stringify(envelope);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

function broadcastOverlayState() {
  sendEvent("overlay_state", buildOverlayState());
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "overlay_state",
      payload: buildOverlayState(),
    } satisfies EventEnvelope),
  );
});

setInterval(() => {
  sendEvent("health", { timestamp: new Date().toISOString() });
}, 15_000).unref();

app.use(errorLogger);

server.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});

function shutdown() {
  console.log("[api] shutting down");
  wss.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
