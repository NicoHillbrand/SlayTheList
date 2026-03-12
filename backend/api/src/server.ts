import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { EventEnvelope, OverlayState } from "@slaythelist/contracts";
import {
  createTodo,
  createZone,
  deleteTodo,
  deleteZone,
  listOverlayState,
  listTodos,
  listZones,
  reorderTodos,
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
    parsedPatch.enabled === undefined
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
