import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  accountabilityStateSchema,
  authResponseSchema,
  cloudDeviceStartRequestSchema,
  friendRequestSchema,
  friendSearchResultSchema,
  goldStateSchema,
  habitCheckSchema,
  habitStatusSchema,
  predictionOutcomeSchema,
  reflectionEntrySchema,
  sessionUserSchema,
  sharedProfileSchema,
  socialSettingsSchema,
  type EventEnvelope,
  type OverlayState,
  type SessionUser,
} from "@slaythelist/contracts";
import {
  activateZoneGoldUnlock,
  addReferenceImage,
  clearZoneGoldUnlock,
  createGameState,
  createTodo,
  createZone,
  deleteGameState,
  deleteReferenceImage,
  deleteTodo,
  deleteZone,
  getAccountabilityState,
  getDetectedGameState,
  getGoldState,
  listGameStates,
  listOverlayState,
  listReferenceImages,
  listTodos,
  listZones,
  reorderTodos,
  saveGoldState,
  setDetectedGameState,
  setZoneGameStates,
  spendGold,
  awardGold,
  awardTodoGold,
  saveAccountabilityState,
  setZoneRequirements,
  updateGameState,
  updateTodo,
  updateZone,
} from "./store.js";
import { SESSION_COOKIE_NAME, createSessionToken, hashPassword, hashSessionToken, parseCookieValue, verifyPassword } from "./auth.js";
import { referenceImagesDir } from "./db.js";
import { testDetection } from "./image-match.js";
import { errorLogger, requestLogger } from "./logger.js";
import {
  acceptFriendRequest,
  bootstrapUserSocialStateFromLegacy,
  cancelFriendRequest,
  createFriendRequest,
  createSessionRecord,
  createUserAccount,
  declineFriendRequest,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  findUserAuthByLogin,
  getSessionUserByTokenHash,
  getSharedProfile,
  getSocialSettings,
  listFriendRequests,
  listFriends,
  saveSocialSettings,
  searchUsers,
} from "./social-store.js";
import {
  acceptCloudFriendRequest,
  cancelCloudFriendRequest,
  declineCloudFriendRequest,
  disconnectCloudConnection,
  getCloudConnectionStatus,
  getCloudSharedProfile,
  getLocalSocialSettings,
  isCloudSyncReady,
  listCloudFriendRequests,
  listCloudFriends,
  pollCloudConnection,
  saveAndSyncLocalSocialSettings,
  searchCloudUsers,
  sendCloudFriendRequest,
  startCloudConnection,
  syncCloudSnapshot,
  updateCloudUsername,
} from "./cloud-sync.js";

const port = Number(process.env.PORT ?? 8788);
const app = express();
app.set("trust proxy", 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(requestLogger);

type AuthedRequest = express.Request & {
  authUser?: SessionUser;
};

function buildOverlayState(): OverlayState {
  return {
    gameWindow: { titleHint: "Slay the Spire 2" },
    zones: listOverlayState(),
    detectedGameState: getDetectedGameState(),
    gameStates: listGameStates(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function ok(res: express.Response, payload: unknown) {
  res.status(200).json(payload);
}

function badRequest(res: express.Response, message: string) {
  res.status(400).json({ error: message });
}

function unauthorized(res: express.Response, message = "authentication required") {
  res.status(401).json({ error: message });
}

function setSessionCookie(res: express.Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function requireAuth(req: AuthedRequest, res: express.Response): SessionUser | undefined {
  if (!req.authUser) {
    unauthorized(res);
    return undefined;
  }
  return req.authUser;
}

function triggerCloudSnapshotSync() {
  if (!isCloudSyncReady()) {
    return;
  }
  void syncCloudSnapshot().catch((error) => {
    console.error("[api] cloud snapshot sync failed", error);
  });
}

function parseUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(trimmed)) return undefined;
  return trimmed;
}

function parseEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function parsePassword(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length >= 8 ? value : undefined;
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

app.use((req, _res, next) => {
  const sessionToken = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    next();
    return;
  }
  const authUser = getSessionUserByTokenHash(hashSessionToken(sessionToken));
  if (authUser) {
    (req as AuthedRequest).authUser = authUser;
  }
  next();
});

app.get("/health", (_req, res) => {
  ok(res, { status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/auth/me", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  ok(res, { user: authUser ?? null });
});

app.post("/api/auth/signup", (req, res) => {
  const username = parseUsername(req.body?.username);
  const email = parseEmail(req.body?.email);
  const password = parsePassword(req.body?.password);
  if (!username) {
    return badRequest(res, "username must be 3-24 characters using letters, numbers, or underscores");
  }
  if (!email) {
    return badRequest(res, "email must be valid");
  }
  if (!password) {
    return badRequest(res, "password must be at least 8 characters");
  }
  try {
    const user = createUserAccount({
      username,
      email,
      passwordHash: hashPassword(password),
    });
    bootstrapUserSocialStateFromLegacy(user.id);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    createSessionRecord(user.id, hashSessionToken(token), expiresAt.toISOString());
    setSessionCookie(res, token, expiresAt);
    ok(res, authResponseSchema.parse({ user }));
  } catch (error) {
    const message = String((error as Error).message ?? "");
    if (message.includes("users.username_normalized")) {
      return badRequest(res, "username is already taken");
    }
    if (message.includes("users.email_normalized")) {
      return badRequest(res, "email is already registered");
    }
    throw error;
  }
});

app.post("/api/auth/signin", (req, res) => {
  const login = typeof req.body?.login === "string" ? req.body.login.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!login || !password) {
    return badRequest(res, "login and password are required");
  }
  const user = findUserAuthByLogin(login);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return unauthorized(res, "invalid credentials");
  }
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  createSessionRecord(user.id, hashSessionToken(token), expiresAt.toISOString());
  setSessionCookie(res, token, expiresAt);
  ok(
    res,
    authResponseSchema.parse({
      user: sessionUserSchema.parse(user),
    }),
  );
});

app.post("/api/auth/signout", (req, res) => {
  const sessionToken = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (sessionToken) {
    deleteSessionByTokenHash(hashSessionToken(sessionToken));
  }
  clearSessionCookie(res);
  ok(res, { signedOut: true });
});

app.get("/api/cloud-social/status", (_req, res) => {
  ok(res, getCloudConnectionStatus());
});

app.post("/api/cloud-social/connect/start", async (req, res) => {
  const parsed = cloudDeviceStartRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid cloud connect payload");
  }
  try {
    ok(res, await startCloudConnection(parsed.data.provider));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/connect/poll", async (_req, res) => {
  try {
    ok(res, await pollCloudConnection());
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/disconnect", async (_req, res) => {
  try {
    ok(res, await disconnectCloudConnection());
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.patch("/api/cloud-social/me/username", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    return badRequest(res, "username is required");
  }
  try {
    ok(res, await updateCloudUsername(username));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/sync", async (_req, res) => {
  try {
    await syncCloudSnapshot();
    ok(res, getCloudConnectionStatus());
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/cloud-social/settings", (_req, res) => {
  ok(res, getLocalSocialSettings());
});

app.put("/api/cloud-social/settings", async (req, res) => {
  const parsed = socialSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid social settings: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  try {
    ok(res, await saveAndSyncLocalSocialSettings(parsed.data));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/cloud-social/users", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  try {
    ok(res, { items: friendSearchResultSchema.array().parse((await searchCloudUsers(query)).items) });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/cloud-social/friends", async (_req, res) => {
  try {
    ok(res, { items: (await listCloudFriends()).items });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/cloud-social/friend-requests", async (_req, res) => {
  try {
    const requests = await listCloudFriendRequests();
    ok(res, {
      incoming: friendRequestSchema.array().parse(requests.incoming),
      outgoing: friendRequestSchema.array().parse(requests.outgoing),
    });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/friend-requests", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    return badRequest(res, "username is required");
  }
  try {
    ok(res, friendRequestSchema.parse(await sendCloudFriendRequest(username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/friend-requests/:id/accept", async (req, res) => {
  try {
    ok(res, friendRequestSchema.parse(await acceptCloudFriendRequest(req.params.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/friend-requests/:id/decline", async (req, res) => {
  try {
    ok(res, friendRequestSchema.parse(await declineCloudFriendRequest(req.params.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.delete("/api/cloud-social/friend-requests/:id", async (req, res) => {
  try {
    ok(res, friendRequestSchema.parse(await cancelCloudFriendRequest(req.params.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/cloud-social/users/:username", async (req, res) => {
  try {
    ok(res, sharedProfileSchema.parse(await getCloudSharedProfile(req.params.username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/social/settings", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  ok(res, getSocialSettings(authUser.id));
});

app.put("/api/social/settings", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  const parsed = socialSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid social settings: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  ok(res, saveSocialSettings(authUser.id, parsed.data));
});

app.get("/api/social/users", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  const query = typeof req.query.q === "string" ? req.query.q : "";
  ok(res, { items: friendSearchResultSchema.array().parse(searchUsers(authUser.id, query)) });
});

app.get("/api/social/friends", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  ok(res, { items: listFriends(authUser.id) });
});

app.get("/api/social/friend-requests", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  const requests = listFriendRequests(authUser.id);
  ok(res, {
    incoming: friendRequestSchema.array().parse(requests.incoming),
    outgoing: friendRequestSchema.array().parse(requests.outgoing),
  });
});

app.post("/api/social/friend-requests", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    return badRequest(res, "username is required");
  }
  try {
    ok(res, friendRequestSchema.parse(createFriendRequest(authUser.id, username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/social/friend-requests/:id/accept", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  try {
    ok(res, friendRequestSchema.parse(acceptFriendRequest(req.params.id, authUser.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/social/friend-requests/:id/decline", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  try {
    ok(res, friendRequestSchema.parse(declineFriendRequest(req.params.id, authUser.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.delete("/api/social/friend-requests/:id", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  try {
    ok(res, friendRequestSchema.parse(cancelFriendRequest(req.params.id, authUser.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/social/users/:username", (req, res) => {
  const authUser = requireAuth(req as AuthedRequest, res);
  if (!authUser) return;
  try {
    ok(res, sharedProfileSchema.parse(getSharedProfile(authUser.id, req.params.username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
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

app.get("/api/accountability-state", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  ok(res, getAccountabilityState(authUser?.id));
});

app.put("/api/accountability-state", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const parsed = accountabilityStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid accountability state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  const saved = saveAccountabilityState(parsed.data, authUser?.id);
  ok(res, saved);
  triggerCloudSnapshotSync();
});

app.get("/api/gold-state", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  ok(res, getGoldState(authUser?.id));
});

app.put("/api/gold-state", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const parsed = goldStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid gold state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  ok(res, saveGoldState(parsed.data, authUser?.id));
  triggerCloudSnapshotSync();
});

app.post("/api/gold/award", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const amount = req.body?.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  ok(res, awardGold(amount, authUser?.id));
  triggerCloudSnapshotSync();
});

app.post("/api/gold/award-todo", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const todoId = req.body?.todoId;
  const amount = req.body?.amount;
  if (typeof todoId !== "string" || !todoId.trim()) {
    return badRequest(res, "todoId is required");
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  const result = awardTodoGold(todoId.trim(), amount, authUser?.id);
  ok(res, result);
  triggerCloudSnapshotSync();
});

app.get("/api/habits", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  ok(res, { items: state.habits });
});

app.post("/api/habits", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const name = req.body?.name;
  const statusInput = req.body?.status;
  if (typeof name !== "string" || !name.trim()) {
    return badRequest(res, "name is required");
  }
  const statusParsed = statusInput === undefined ? { success: true, data: "active" as const } : habitStatusSchema.safeParse(statusInput);
  if (!statusParsed.success) {
    return badRequest(res, "status must be active, archived, or idea");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  const created = {
    id: randomUUID(),
    name: name.trim(),
    checks: [],
    createdAt: Date.now(),
    status: statusParsed.data,
  };
  saveAccountabilityState({ ...state, habits: [...state.habits, created] }, authUser?.id);
  ok(res, created);
  triggerCloudSnapshotSync();
});

app.patch("/api/habits/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
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
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
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
  saveAccountabilityState({ ...state, habits: nextHabits }, authUser?.id);
  ok(res, updated);
  triggerCloudSnapshotSync();
});

app.delete("/api/habits/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  const nextHabits = state.habits.filter((habit) => habit.id !== req.params.id);
  if (nextHabits.length === state.habits.length) {
    return res.status(404).json({ error: "habit not found" });
  }
  saveAccountabilityState({ ...state, habits: nextHabits }, authUser?.id);
  ok(res, { deleted: true });
  triggerCloudSnapshotSync();
});

app.get("/api/predictions", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  ok(res, { items: state.predictions });
});

app.post("/api/predictions", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const title = req.body?.title;
  const confidence = req.body?.confidence;
  if (typeof title !== "string" || !title.trim()) {
    return badRequest(res, "title is required");
  }
  if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 1 || confidence > 99) {
    return badRequest(res, "confidence must be an integer between 1 and 99");
  }
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  const created = {
    id: randomUUID(),
    title: title.trim(),
    confidence,
    outcome: "pending" as const,
    createdAt: Date.now(),
    resolvedAt: null,
  };
  saveAccountabilityState({ ...state, predictions: [...state.predictions, created] }, authUser?.id);
  ok(res, created);
  triggerCloudSnapshotSync();
});

app.patch("/api/predictions/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
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
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
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
  saveAccountabilityState({ ...state, predictions: nextPredictions }, authUser?.id);
  ok(res, updated);
  triggerCloudSnapshotSync();
});

app.delete("/api/predictions/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  const nextPredictions = state.predictions.filter((prediction) => prediction.id !== req.params.id);
  if (nextPredictions.length === state.predictions.length) {
    return res.status(404).json({ error: "prediction not found" });
  }
  saveAccountabilityState({ ...state, predictions: nextPredictions }, authUser?.id);
  ok(res, { deleted: true });
  triggerCloudSnapshotSync();
});

app.get("/api/reflections", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  ok(res, { items: state.reflections });
});

app.post("/api/reflections", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
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
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  saveAccountabilityState({ ...state, reflections: [...state.reflections, created] }, authUser?.id);
  ok(res, created);
  triggerCloudSnapshotSync();
});

app.patch("/api/reflections/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
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
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
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
  saveAccountabilityState({ ...state, reflections: nextReflections }, authUser?.id);
  ok(res, updated);
  triggerCloudSnapshotSync();
});

app.delete("/api/reflections/:id", (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  const state = accountabilityStateSchema.parse(getAccountabilityState(authUser?.id));
  const nextReflections = state.reflections.filter((reflection) => reflection.id !== req.params.id);
  if (nextReflections.length === state.reflections.length) {
    return res.status(404).json({ error: "reflection not found" });
  }
  saveAccountabilityState({ ...state, reflections: nextReflections }, authUser?.id);
  ok(res, { deleted: true });
  triggerCloudSnapshotSync();
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
  const authUser = (req as AuthedRequest).authUser;
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
    spendGold(10, authUser?.id);
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

// ---------------------------------------------------------------------------
// Game States
// ---------------------------------------------------------------------------

app.get("/api/game-states", (_req, res) => {
  ok(res, { items: listGameStates() });
});

app.post("/api/game-states", (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string" || !name.trim()) {
    return badRequest(res, "name is required");
  }
  const matchThreshold = req.body?.matchThreshold;
  const parsedThreshold =
    typeof matchThreshold === "number" && matchThreshold >= 0 && matchThreshold <= 1
      ? matchThreshold
      : undefined;
  const created = createGameState({ name: name.trim(), matchThreshold: parsedThreshold });
  ok(res, created);
  broadcastOverlayState();
});

app.patch("/api/game-states/:id", (req, res) => {
  const patch = req.body ?? {};
  const parsedPatch: Record<string, unknown> = {};
  if (typeof patch.name === "string") parsedPatch.name = patch.name.trim();
  if (typeof patch.enabled === "boolean") parsedPatch.enabled = patch.enabled;
  if (typeof patch.matchThreshold === "number" && patch.matchThreshold >= 0 && patch.matchThreshold <= 1) {
    parsedPatch.matchThreshold = patch.matchThreshold;
  }
  if (Object.keys(parsedPatch).length === 0) {
    return badRequest(res, "no valid fields provided");
  }
  const updated = updateGameState(req.params.id, parsedPatch as Partial<{ name: string; enabled: boolean; matchThreshold: number }>);
  if (!updated) {
    return res.status(404).json({ error: "game state not found" });
  }
  ok(res, updated);
  broadcastOverlayState();
});

app.delete("/api/game-states/:id", (req, res) => {
  if (!deleteGameState(req.params.id)) {
    return res.status(404).json({ error: "game state not found" });
  }
  ok(res, { deleted: true });
  broadcastOverlayState();
});

app.get("/api/game-states/:id/reference-images", (req, res) => {
  ok(res, { items: listReferenceImages(req.params.id) });
});

app.post("/api/game-states/:id/reference-images", (req, res) => {
  const imageData = req.body?.imageData;
  const filename = req.body?.filename;
  if (typeof imageData !== "string" || !imageData) {
    return badRequest(res, "imageData (base64) is required");
  }
  if (typeof filename !== "string" || !filename.trim()) {
    return badRequest(res, "filename is required");
  }
  const stateExists = listGameStates().some((gs) => gs.id === req.params.id);
  if (!stateExists) {
    return res.status(404).json({ error: "game state not found" });
  }
  const buffer = Buffer.from(imageData, "base64");
  const created = addReferenceImage(req.params.id, buffer, filename.trim());
  ok(res, created);
});

app.delete("/api/game-states/reference-images/:imageId", (req, res) => {
  if (!deleteReferenceImage(req.params.imageId)) {
    return res.status(404).json({ error: "reference image not found" });
  }
  ok(res, { deleted: true });
});

app.put("/api/zones/:id/game-states", (req, res) => {
  const gameStateIds = req.body?.gameStateIds;
  if (!Array.isArray(gameStateIds) || gameStateIds.some((x) => typeof x !== "string")) {
    return badRequest(res, "gameStateIds must be an array of game state ids");
  }
  const zoneExists = listZones().some((zone) => zone.id === req.params.id);
  if (!zoneExists) {
    return res.status(404).json({ error: "zone not found" });
  }
  setZoneGameStates(req.params.id, gameStateIds);
  ok(res, { updated: true });
  broadcastOverlayState();
});

app.get("/api/detected-game-state", (_req, res) => {
  ok(res, getDetectedGameState());
});

app.put("/api/detected-game-state", (req, res) => {
  const gameStateId = req.body?.gameStateId ?? null;
  const confidence = req.body?.confidence;
  if (gameStateId !== null && typeof gameStateId !== "string") {
    return badRequest(res, "gameStateId must be a string or null");
  }
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    return badRequest(res, "confidence must be a number between 0 and 1");
  }
  const detected = setDetectedGameState(gameStateId, confidence);
  ok(res, detected);
  broadcastOverlayState();
});

app.post("/api/game-states/test-detection", async (req, res) => {
  const imageData = req.body?.imageData;
  if (typeof imageData !== "string" || !imageData) {
    return badRequest(res, "imageData (base64) is required");
  }
  try {
    const testBuffer = Buffer.from(imageData, "base64");
    const states = listGameStates();
    const refMap = new Map<string, Array<{ id: string; filename: string }>>();
    for (const gs of states) {
      refMap.set(gs.id, listReferenceImages(gs.id));
    }
    const results = await testDetection(testBuffer, states, refMap);
    ok(res, { results });
  } catch (err) {
    res.status(500).json({ error: `detection test failed: ${(err as Error).message}` });
  }
});

app.use("/api/reference-images", express.static(referenceImagesDir));

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

deleteExpiredSessions();
setInterval(() => {
  deleteExpiredSessions();
}, 1000 * 60 * 60).unref();

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
