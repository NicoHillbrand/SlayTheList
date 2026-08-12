import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  accountabilityStateSchema,
  cloudDeviceStartRequestSchema,
  friendRequestSchema,
  friendSearchResultSchema,
  goldStateSchema,
  habitCheckSchema,
  habitStatusSchema,
  itemVisibilitySchema,
  predictionOutcomeSchema,
  reflectionEntrySchema,
  encouragementResponseSchema,
  sharedProfileSchema,
  socialSettingsSchema,
  statusChipSchema,
  vaultPushRequestSchema,
  type CurrentStep,
  type EventEnvelope,
  type OverlayState,
} from "@slaythelist/contracts";
import {
  spendGoldAndActivateUnlock,
  addReferenceImage,
  clearZoneGoldUnlock,
  createBlock,
  createGameState,
  createTodo,
  createZone,
  deleteBlock,
  deleteGameState,
  deleteReferenceImage,
  deleteTodo,
  deleteZone,
  getAccountabilityState,
  getBlock,
  getDetectedGameState,
  getGoldEarnedToday,
  getGoldState,
  listBlocks,
  listDetectionRegions,
  listGameStates,
  listOverlayState,
  listReferenceImages,
  listTodos,
  listZones,
  listZonesForBlock,
  reorderTodos,
  saveGoldState,
  setDetectedGameState,
  setDetectionRegions,
  setZoneGameStates,
  awardGold,
  awardTodoGold,
  deductGold,
  listGoldActivityDays,
  updateGoldActivityDate,
  type GoldActivityContext,
  saveAccountabilityState,
  setZoneRequirements,
  updateBlock,
  updateGameState,
  updateTodo,
  updateZone,
  getSetting,
  setSetting,
  awardBaseCurrency,
  getDefenseSnapshot,
  buyDefenseUpgrade,
  runDefenseSandboxAction,
  setDefenseDeathMode,
  getCrawlSnapshot,
  playCrawlCardAction,
  endCrawlTurnAction,
  drawCrawlCardAction,
  chooseCrawlRewardAction,
  restartCrawlAction,
  setCrawlWardAction,
  type CrawlSnapshot,
  getMicroState,
  awardMicroTenths,
  getCurrentStep,
  setCurrentStep,
  completeCurrentStep,
  SHOW_CURRENT_STEP_SETTING,
} from "./store.js";
import { referenceImagesDir } from "./db.js";
import { testDetection, clearRefPixelCache, getDetectionRefs, DETECTION_COMPARE_SIZE, DETECTION_TEMPLATE_WIDTH, DETECTION_TEMPLATE_HEIGHT } from "./image-match.js";
import { errorLogger, requestLogger } from "./logger.js";
import {
  acceptCloudFriendRequest,
  cancelCloudFriendRequest,
  removeCloudFriend,
  declineCloudFriendRequest,
  disconnectCloudConnection,
  getCloudConnectionStatus,
  getCloudFriendsFeed,
  reconcileReceivedFeedHearts,
  getCloudFriendsToday,
  getCloudSharedProfile,
  removeCloudFeedHeart,
  sendCloudFeedHeart,
  getLocalSocialSettings,
  getLocalSocialStatus,
  saveLocalSocialStatus,
  isCloudSyncReady,
  listCloudFriendRequests,
  listCloudFriends,
  pollCloudConnection,
  saveAndSyncLocalSocialSettings,
  searchCloudUsers,
  sendCloudEncouragement,
  sendCloudFriendRequest,
  startCloudConnection,
  syncCloudSnapshot,
  updateCloudUsername,
  getVaultVersion,
  pullVault,
  pushVault,
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

function buildOverlayState(): OverlayState & {
  showDetectionIndicator: boolean;
  detectionIntervalMs: number;
  screenDetectionEnabled: boolean;
  showGoldToday: boolean;
  goldEarnedToday: number;
  showBaseOverlay: boolean;
  overlayToggleHotkey: string;
  crawlToggleHotkey: string;
  currentStep: CurrentStep | null;
} {
  const rawInterval = Number(getSetting("detectionIntervalMs"));
  const detectionIntervalMs = Number.isFinite(rawInterval) && rawInterval > 0
    ? Math.min(800, Math.max(100, Math.round(rawInterval)))
    : 100;
  const showGoldToday = getSetting("showGoldToday") === "true";
  return {
    gameWindow: { titleHint: "Slay the Spire 2" },
    zones: listOverlayState(),
    detectedGameState: getDetectedGameState(),
    gameStates: listGameStates(),
    lastUpdatedAt: new Date().toISOString(),
    showDetectionIndicator: getSetting("showDetectionIndicator") !== "false",
    detectionIntervalMs,
    screenDetectionEnabled: getSetting("screenDetectionEnabled") !== "false",
    showGoldToday,
    goldEarnedToday: showGoldToday ? getGoldEarnedToday() : 0,
    showBaseOverlay: getSetting("showBaseOverlay") === "true",
    overlayToggleHotkey: getSetting("overlayToggleHotkey") ?? "",
    crawlToggleHotkey: getSetting("crawlToggleHotkey") ?? "",
    // Rides the overlay-state broadcast rather than getting its own poll: this
    // payload already goes out on every mutation and on socket connect, so the
    // step lands in the overlay without the client ever asking for it.
    //
    // A completed step is withheld here rather than in the UI: "it disappears
    // when the agent marks it done" is a rule about the overlay, not a rendering
    // detail, so the surface never receives one it should not show.
    currentStep: currentStepForOverlay(),
  };
}

function currentStepForOverlay(): CurrentStep | null {
  if (getSetting(SHOW_CURRENT_STEP_SETTING) === "false") return null;
  const step = getCurrentStep();
  return step === null || step.doneAt !== null ? null : step;
}

function ok(res: express.Response, payload: unknown) {
  res.status(200).json(payload);
}

function badRequest(res: express.Response, message: string) {
  res.status(400).json({ error: message });
}

function triggerCloudSnapshotSync() {
  if (!isCloudSyncReady()) {
    return;
  }
  void syncCloudSnapshot().catch((error) => {
    console.error("[api] cloud snapshot sync failed", error);
  });
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

function parseZoneUnlockMode(value: unknown): "todos" | "gold" | "permanent" | "schedule" | undefined {
  if (value === undefined) return undefined;
  return value === "todos" || value === "gold" || value === "permanent" || value === "schedule" ? value : undefined;
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

// Compact per-friend overlay cards: status chips + today's shared log + base
// tier. `date` is the viewer's local YYYY-MM-DD (log days are date-keyed).
app.get("/api/cloud-social/friends/summary", async (req, res) => {
  const date =
    typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
  try {
    ok(res, await getCloudFriendsToday(date));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

// Queue of visible-to-you things friends got done since `since` (ISO 8601),
// newest first with per-entry heart state.
app.get("/api/cloud-social/friends/feed", async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  if (!since || !Number.isFinite(new Date(since).getTime())) {
    return badRequest(res, "since must be an ISO 8601 timestamp");
  }
  try {
    ok(res, await getCloudFriendsFeed(new Date(since).toISOString()));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/cloud-social/feed-hearts", async (req, res) => {
  const targetUserId = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : "";
  const entryId = typeof req.body?.entryId === "string" ? req.body.entryId : "";
  if (!targetUserId || !entryId) {
    return badRequest(res, "targetUserId and entryId are required");
  }
  try {
    ok(res, await sendCloudFeedHeart(targetUserId, entryId));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.delete("/api/cloud-social/feed-hearts/:entryId", async (req, res) => {
  try {
    await removeCloudFeedHeart(req.params.entryId);
    ok(res, { success: true });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

// Hearts friends put on the user's own entries — shown on the overlay. Also
// the moment new hearts get paid out (+1 gold each, ledger-logged), so the
// gold is already awarded by the time the overlay renders the heart.
app.get("/api/cloud-social/feed-hearts/received", async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : "";
  if (!since || !Number.isFinite(new Date(since).getTime())) {
    return badRequest(res, "since must be an ISO 8601 timestamp");
  }
  try {
    const sinceIso = new Date(since).toISOString();
    // Reconcile fetches with its own (longer) lookback; trim to the caller's
    // window for display.
    const { items } = await reconcileReceivedFeedHearts();
    ok(res, { items: items.filter((heart) => heart.createdAt >= sinceIso) });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

// The user's own status chips (energy / availability / custom), shared with
// friends through the social snapshot.
app.get("/api/social-status", (_req, res) => {
  ok(res, getLocalSocialStatus());
});

app.put("/api/social-status", (req, res) => {
  const parsed = statusChipSchema.array().max(8).safeParse(req.body?.chips);
  if (!parsed.success) {
    return badRequest(res, `invalid status chips: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  const status = saveLocalSocialStatus(parsed.data);
  triggerCloudSnapshotSync();
  ok(res, status);
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

app.delete("/api/cloud-social/friends/:friendUserId", async (req, res) => {
  try {
    ok(res, await removeCloudFriend(req.params.friendUserId));
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

app.post("/api/cloud-social/encourage", async (req, res) => {
  try {
    const result = await sendCloudEncouragement(req.body);
    ok(res, encouragementResponseSchema.parse(result));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

// ---------------------------------------------------------------------------
// Cloud Vault (E2E encrypted full-data sync)
// ---------------------------------------------------------------------------

app.get("/api/vault/version", async (_req, res) => {
  try {
    ok(res, await getVaultVersion());
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/vault/pull", async (_req, res) => {
  try {
    ok(res, await pullVault());
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.put("/api/vault/push", async (req, res) => {
  const parsed = vaultPushRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid vault push payload");
  }
  try {
    ok(res, await pushVault(parsed.data));
  } catch (error) {
    const err = error as Error & { message: string };
    if (err.message.includes("409") || err.message.includes("version conflict")) {
      res.status(409).json({ error: err.message });
    } else {
      return badRequest(res, err.message);
    }
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
  const pushCount = req.body?.pushCount;
  const deadlineAt = req.body?.deadlineAt;
  const deadlineTime = req.body?.deadlineTime;
  const visibility = req.body?.visibility;
  const parsedVisibility =
    visibility === undefined
      ? undefined
      : visibility === "visible" || visibility === "private"
        ? visibility
        : null;
  if (parsedVisibility === null) {
    return badRequest(res, "visibility must be 'visible' or 'private'");
  }
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
  const parsedPushCount =
    pushCount === undefined
      ? undefined
      : typeof pushCount === "number" && Number.isInteger(pushCount) && pushCount >= 0
        ? pushCount
        : null;
  if (parsedPushCount === null) {
    return badRequest(res, "pushCount must be a non-negative integer");
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
    parsedPushCount === undefined &&
    parsedDeadline.value === undefined &&
    parsedVisibility === undefined
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
    pushCount: parsedPushCount,
    visibility: parsedVisibility,
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
  ok(res, getAccountabilityState());
});

app.put("/api/accountability-state", (req, res) => {
  const parsed = accountabilityStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid accountability state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  const saved = saveAccountabilityState(parsed.data);
  ok(res, saved);
  triggerCloudSnapshotSync();
});

app.get("/api/gold-state", (req, res) => {
  ok(res, getGoldState());
});

app.put("/api/gold-state", (req, res) => {
  const parsed = goldStateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, `invalid gold state: ${parsed.error.issues[0]?.message ?? "invalid payload"}`);
  }
  ok(res, saveGoldState(parsed.data));
  triggerCloudSnapshotSync();
});

const GOLD_ACTIVITY_SOURCES = new Set(["todo", "habit", "encouragement", "manual", "spend", "prediction", "micro"]);

function parseActivity(raw: unknown): GoldActivityContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const sourceType = obj.sourceType;
  if (typeof sourceType !== "string" || !GOLD_ACTIVITY_SOURCES.has(sourceType)) return undefined;
  const date = typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : null;
  return {
    sourceType: sourceType as GoldActivityContext["sourceType"],
    sourceId: typeof obj.sourceId === "string" ? obj.sourceId : null,
    label: typeof obj.label === "string" ? obj.label.slice(0, 500) : "",
    date,
  };
}

// Map a friendly category name (as shown in the achievement view) to a ledger
// source type. Unknown / missing categories fall back to "manual" (the "Other"
// bucket in the UI).
function categoryToSourceType(category: unknown): GoldActivityContext["sourceType"] {
  const c = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (c === "tasks" || c === "task" || c === "todo" || c === "todos") return "todo";
  if (c === "habits" || c === "habit") return "habit";
  if (c === "encouragements" || c === "encouragement" || c === "encourage") return "encouragement";
  if (c === "predictions" || c === "prediction") return "prediction";
  if (c.startsWith("micro")) return "micro";
  return "manual";
}

// Build a log entry from the external-agent submission fields (title/category/
// source/timestamp). Returns undefined when no title is given, so bare balance
// bumps don't produce a log entry.
function parseAgentActivity(body: Record<string, unknown> | undefined): GoldActivityContext | undefined {
  const title = body?.title;
  if (typeof title !== "string" || !title.trim()) return undefined;
  const timestamp = typeof body?.timestamp === "string" ? body.timestamp : null;
  return {
    sourceType: categoryToSourceType(body?.category),
    label: title.trim().slice(0, 500),
    source: typeof body?.source === "string" ? body.source.slice(0, 120) : null,
    at: timestamp,
  };
}

app.post("/api/gold/award", (req, res) => {
  const amount = req.body?.amount;
  const withSound = req.body?.withSound === true;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  // Precedence: an explicit internal `activity` object, else agent
  // title/category fields, else nothing (balance-only).
  const activity = parseActivity(req.body?.activity) ?? parseAgentActivity(req.body);
  ok(res, awardGold(amount, undefined, activity));
  if (withSound) broadcastPlaySound("gold");
  broadcastOverlayState();
  triggerCloudSnapshotSync();
});

app.get("/api/gold/activity", (req, res) => {
  const rawLimit = req.query?.days;
  const parsed = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 30;
  ok(res, { days: listGoldActivityDays(days) });
});

// Move a ledger entry to a different day (the day the thing actually happened).
app.patch("/api/gold/activity/:id", (req, res) => {
  const date = req.body?.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    return badRequest(res, "date must be a YYYY-MM-DD string");
  }
  if (!updateGoldActivityDate(req.params.id, date)) {
    return res.status(404).json({ error: "activity entry not found" });
  }
  ok(res, { updated: true, id: req.params.id, date });
  triggerCloudSnapshotSync();
});

app.post("/api/gold/deduct", (req, res) => {
  const amount = req.body?.amount;
  const withSound = req.body?.withSound === true;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  ok(res, deductGold(amount, undefined, parseActivity(req.body?.activity)));
  if (withSound) broadcastPlaySound("gold");
  broadcastOverlayState();
  triggerCloudSnapshotSync();
});

app.get("/api/micro", (_req, res) => {
  ok(res, getMicroState());
});

// Record micro-actions in tenths of a gold. Ten tenths roll into one real gold
// automatically; three buy a card draw in the crawl.
app.post("/api/micro/award", (req, res) => {
  const tenths = req.body?.tenths;
  const withSound = req.body?.withSound === true;
  if (typeof tenths !== "number" || !Number.isInteger(tenths) || tenths < 1) {
    return badRequest(res, "tenths must be a positive integer");
  }
  const label = typeof req.body?.label === "string" ? req.body.label : null;
  const source = typeof req.body?.source === "string" ? req.body.source : null;
  ok(res, awardMicroTenths(tenths, { label, source }));
  if (withSound) broadcastPlaySound("gold");
  broadcastOverlayState();
  triggerCloudSnapshotSync();
});

app.post("/api/sound/play", (req, res) => {
  const raw = typeof req.body?.sound === "string" ? req.body.sound.trim() : "";
  const sound = raw.length > 0 ? raw : "gold";
  broadcastPlaySound(sound);
  ok(res, { played: true, sound });
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
  const activity = parseActivity(req.body?.activity) ?? {
    sourceType: "todo" as const,
    sourceId: todoId.trim(),
    label: "",
  };
  const result = awardTodoGold(todoId.trim(), amount, undefined, activity);
  ok(res, result);
  broadcastOverlayState();
  triggerCloudSnapshotSync();
});

app.get("/api/habits", (req, res) => {
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
  saveAccountabilityState({ ...state, habits: [...state.habits, created] });
  ok(res, created);
  triggerCloudSnapshotSync();
});

app.patch("/api/habits/:id", (req, res) => {
  const patch = req.body ?? {};
  const nextName = patch.name;
  const nextStatus = patch.status;
  const nextChecks = patch.checks;
  const nextVisibility = patch.visibility;
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
  const visibilityParsed =
    nextVisibility === undefined ? { success: true, data: undefined } : itemVisibilitySchema.safeParse(nextVisibility);
  if (!visibilityParsed.success) {
    return badRequest(res, "visibility must be visible or private");
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
    ...(visibilityParsed.data !== undefined ? { visibility: visibilityParsed.data } : {}),
  };
  const nextHabits = [...state.habits];
  nextHabits[index] = updated;
  saveAccountabilityState({ ...state, habits: nextHabits });
  ok(res, updated);
  triggerCloudSnapshotSync();
});

app.delete("/api/habits/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextHabits = state.habits.filter((habit) => habit.id !== req.params.id);
  if (nextHabits.length === state.habits.length) {
    return res.status(404).json({ error: "habit not found" });
  }
  saveAccountabilityState({ ...state, habits: nextHabits });
  ok(res, { deleted: true });
  triggerCloudSnapshotSync();
});

app.get("/api/predictions", (req, res) => {
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
  triggerCloudSnapshotSync();
});

app.patch("/api/predictions/:id", (req, res) => {
  const patch = req.body ?? {};
  const nextTitle = patch.title;
  const nextConfidence = patch.confidence;
  const nextOutcome = patch.outcome;
  const nextResolvedAt = patch.resolvedAt;
  const nextLogDate = patch.logDate;
  const nextVisibility = patch.visibility;
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
  if (
    nextLogDate !== undefined &&
    nextLogDate !== null &&
    (typeof nextLogDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(nextLogDate))
  ) {
    return badRequest(res, "logDate must be a YYYY-MM-DD string or null");
  }
  const visibilityParsed =
    nextVisibility === undefined ? { success: true, data: undefined } : itemVisibilitySchema.safeParse(nextVisibility);
  if (!visibilityParsed.success) {
    return badRequest(res, "visibility must be visible or private");
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
    // null clears the override (falls back to resolution/made-day grouping).
    logDate: nextLogDate === undefined ? current.logDate : nextLogDate ?? undefined,
    resolvedAt:
      nextResolvedAt === undefined
        ? resolvedAtFromOutcome === undefined
          ? current.resolvedAt
          : resolvedAtFromOutcome
        : nextResolvedAt,
    ...(visibilityParsed.data !== undefined ? { visibility: visibilityParsed.data } : {}),
  };
  const nextPredictions = [...state.predictions];
  nextPredictions[index] = updated;
  saveAccountabilityState({ ...state, predictions: nextPredictions });
  ok(res, updated);
  triggerCloudSnapshotSync();
});

app.delete("/api/predictions/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextPredictions = state.predictions.filter((prediction) => prediction.id !== req.params.id);
  if (nextPredictions.length === state.predictions.length) {
    return res.status(404).json({ error: "prediction not found" });
  }
  saveAccountabilityState({ ...state, predictions: nextPredictions });
  ok(res, { deleted: true });
  triggerCloudSnapshotSync();
});

app.get("/api/reflections", (req, res) => {
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
  triggerCloudSnapshotSync();
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
  triggerCloudSnapshotSync();
});

app.delete("/api/reflections/:id", (req, res) => {
  const state = accountabilityStateSchema.parse(getAccountabilityState());
  const nextReflections = state.reflections.filter((reflection) => reflection.id !== req.params.id);
  if (nextReflections.length === state.reflections.length) {
    return res.status(404).json({ error: "reflection not found" });
  }
  saveAccountabilityState({ ...state, reflections: nextReflections });
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
  const blockId = typeof body.blockId === "string" ? body.blockId : undefined;
  const zone = createZone({
    name: body.name.trim(),
    x: asFiniteNumber(body.x, 100),
    y: asFiniteNumber(body.y, 100),
    width,
    height,
    locked: body.locked !== false,
    unlockMode: parseZoneUnlockMode(body.unlockMode) ?? "todos",
    cooldownEnabled: body.cooldownEnabled === true,
    cooldownSeconds: typeof body.cooldownSeconds === "number" && body.cooldownSeconds > 0
      ? Math.floor(body.cooldownSeconds)
      : 3600,
    goldCost: typeof body.goldCost === "number" && Number.isInteger(body.goldCost) && body.goldCost > 0
      ? body.goldCost
      : 10,
    schedules: Array.isArray(body.schedules) ? body.schedules : [],
  }, blockId);
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
    locked: typeof patch.locked === "boolean" ? patch.locked : undefined,
    unlockMode: parseZoneUnlockMode(patch.unlockMode),
    cooldownEnabled: typeof patch.cooldownEnabled === "boolean" ? patch.cooldownEnabled : undefined,
    cooldownSeconds: typeof patch.cooldownSeconds === "number" && patch.cooldownSeconds > 0
      ? Math.floor(patch.cooldownSeconds)
      : undefined,
    goldCost: typeof patch.goldCost === "number" && Number.isInteger(patch.goldCost) && patch.goldCost > 0
      ? patch.goldCost
      : undefined,
    schedules: Array.isArray(patch.schedules) ? patch.schedules : undefined,
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
    parsedPatch.locked === undefined &&
    parsedPatch.unlockMode === undefined &&
    parsedPatch.cooldownEnabled === undefined &&
    parsedPatch.cooldownSeconds === undefined &&
    parsedPatch.goldCost === undefined &&
    parsedPatch.schedules === undefined
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
  if (!zoneState.zone.locked) {
    return badRequest(res, "zone is already unlocked");
  }
  if (!zoneState.isLocked) {
    return badRequest(res, "zone is already unlocked");
  }

  try {
    spendGoldAndActivateUnlock(req.params.id, zoneState.zone.goldCost);
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
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
  if (typeof patch.alwaysDetect === "boolean") parsedPatch.alwaysDetect = patch.alwaysDetect;
  if (Object.keys(parsedPatch).length === 0) {
    return badRequest(res, "no valid fields provided");
  }
  const updated = updateGameState(req.params.id, parsedPatch as Partial<{ name: string; enabled: boolean; matchThreshold: number; alwaysDetect: boolean }>);
  if (!updated) {
    return res.status(404).json({ error: "game state not found" });
  }
  ok(res, updated);
  broadcastOverlayState();
});

app.get("/api/game-states/:id/detection-regions", (req, res) => {
  const stateExists = listGameStates().some((gs) => gs.id === req.params.id);
  if (!stateExists) {
    return res.status(404).json({ error: "game state not found" });
  }
  ok(res, { items: listDetectionRegions(req.params.id) });
});

app.put("/api/game-states/:id/detection-regions", (req, res) => {
  const stateExists = listGameStates().some((gs) => gs.id === req.params.id);
  if (!stateExists) {
    return res.status(404).json({ error: "game state not found" });
  }
  const regions = req.body?.regions;
  if (!Array.isArray(regions)) {
    return badRequest(res, "regions must be an array");
  }
  for (const r of regions) {
    if (typeof r !== "object" || r === null) return badRequest(res, "each region must be an object");
    if (typeof r.x !== "number" || typeof r.y !== "number" || typeof r.width !== "number" || typeof r.height !== "number") {
      return badRequest(res, "each region must have numeric x, y, width, height");
    }
    if (r.width <= 0 || r.height <= 0) return badRequest(res, "region width and height must be positive");
  }
  const saved = setDetectionRegions(req.params.id, regions as Array<{ x: number; y: number; width: number; height: number }>);
  ok(res, { items: saved });
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
  if (imageData.length > 10_000_000) {
    return badRequest(res, "imageData is too large (max ~7.5 MB)");
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
  clearRefPixelCache();
  ok(res, created);
});

app.delete("/api/game-states/reference-images/:imageId", (req, res) => {
  if (!deleteReferenceImage(req.params.imageId)) {
    return res.status(404).json({ error: "reference image not found" });
  }
  clearRefPixelCache();
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
  const existingGameStateIds = new Set(listGameStates().map((gs) => gs.id));
  const unknownId = gameStateIds.find((id: string) => !existingGameStateIds.has(id));
  if (unknownId) {
    return badRequest(res, `game state not found: ${unknownId}`);
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
  // The overlay agent PUTs this on every detection scan (~100ms). Confidence
  // jitters every frame, so only a change of the detected *state* warrants
  // fanning out a broadcast — each one triggers a full refresh in every open
  // web page (which in cloud-vault mode also pings the cloud server).
  const previousGameStateId = getDetectedGameState().gameStateId;
  const detected = setDetectedGameState(gameStateId, confidence);
  ok(res, detected);
  if (detected.gameStateId !== previousGameStateId) broadcastOverlayState();
});

app.post("/api/game-states/test-detection", async (req, res) => {
  const imageData = req.body?.imageData;
  if (typeof imageData !== "string" || !imageData) {
    return badRequest(res, "imageData (base64) is required");
  }
  if (imageData.length > 10_000_000) {
    return badRequest(res, "imageData is too large (max ~7.5 MB)");
  }
  try {
    const testBuffer = Buffer.from(imageData, "base64");
    const states = listGameStates();
    const refMap = new Map<string, Array<{ id: string; filename: string }>>();
    const regionsMap = new Map<string, import("./image-match.js").DetectionRegion[]>();
    for (const gs of states) {
      refMap.set(gs.id, listReferenceImages(gs.id));
      const regions = listDetectionRegions(gs.id);
      if (regions.length > 0) {
        regionsMap.set(gs.id, regions);
      }
    }
    const results = await testDetection(testBuffer, states, refMap, regionsMap);
    ok(res, { results });
  } catch (err) {
    res.status(500).json({ error: `detection test failed: ${(err as Error).message}` });
  }
});

app.get("/api/detection-refs", async (_req, res) => {
  try {
    // Empty refs make every agent skip the screenshot before capturing, so
    // this filter is the cross-platform kill switch for screen detection:
    // the master setting turns it off wholesale, and per-state `enabled`
    // flags drop individual states (previously ignored here).
    const detectionOff = getSetting("screenDetectionEnabled") === "false";
    const states = detectionOff ? [] : listGameStates().filter((gs) => gs.enabled);
    const refMap = new Map<string, Array<{ id: string; filename: string }>>();
    const regionsMap = new Map<string, import("./image-match.js").DetectionRegion[]>();
    for (const gs of states) {
      refMap.set(gs.id, listReferenceImages(gs.id));
      const regions = listDetectionRegions(gs.id);
      if (regions.length > 0) regionsMap.set(gs.id, regions);
    }
    const refs = await getDetectionRefs(states, refMap, regionsMap);
    ok(res, {
      compareSize: DETECTION_COMPARE_SIZE,
      templateWidth: DETECTION_TEMPLATE_WIDTH,
      templateHeight: DETECTION_TEMPLATE_HEIGHT,
      refs,
    });
  } catch (err) {
    res.status(500).json({ error: `failed to compute detection refs: ${(err as Error).message}` });
  }
});

app.use("/api/reference-images", express.static(referenceImagesDir));

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

app.get("/api/blocks", (_req, res) => {
  ok(res, { items: listBlocks() });
});

app.post("/api/blocks", (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string" || !name.trim()) {
    return badRequest(res, "name is required");
  }
  const gameStateId = req.body?.gameStateId;
  if (typeof gameStateId !== "string" || !gameStateId) {
    return badRequest(res, "gameStateId is required");
  }
  const unlockMode = req.body?.unlockMode;
  const parsedUnlockMode =
    unlockMode === "independent" || unlockMode === "shared" ? unlockMode : undefined;
  const created = createBlock(name.trim(), gameStateId, parsedUnlockMode);
  ok(res, created);
  broadcastOverlayState();
});

app.put("/api/blocks/:id", (req, res) => {
  const patch = req.body ?? {};
  const parsedPatch: Record<string, unknown> = {};
  if (typeof patch.name === "string") parsedPatch.name = patch.name.trim();
  if (typeof patch.gameStateId === "string") parsedPatch.gameStateId = patch.gameStateId;
  if (patch.unlockMode === "independent" || patch.unlockMode === "shared") {
    parsedPatch.unlockMode = patch.unlockMode;
  }
  if (typeof patch.enabled === "boolean") parsedPatch.enabled = patch.enabled;
  if (typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)) {
    parsedPatch.sortOrder = Math.floor(patch.sortOrder);
  }
  if (Object.keys(parsedPatch).length === 0) {
    return badRequest(res, "no valid fields provided");
  }
  const updated = updateBlock(
    req.params.id,
    parsedPatch as Partial<{ name: string; gameStateId: string; unlockMode: "independent" | "shared"; enabled: boolean; sortOrder: number }>,
  );
  if (!updated) {
    return res.status(404).json({ error: "block not found" });
  }
  ok(res, updated);
  broadcastOverlayState();
});

app.delete("/api/blocks/:id", (req, res) => {
  if (!deleteBlock(req.params.id)) {
    return res.status(404).json({ error: "block not found" });
  }
  ok(res, { deleted: true });
  broadcastOverlayState();
});

app.get("/api/blocks/:id/zones", (req, res) => {
  const block = getBlock(req.params.id);
  if (!block) {
    return res.status(404).json({ error: "block not found" });
  }
  ok(res, { items: listZonesForBlock(req.params.id) });
});

// ---------------------------------------------------------------------------
// App Settings
// ---------------------------------------------------------------------------

app.get("/api/settings/:key", (req, res) => {
  const value = getSetting(req.params.key);
  ok(res, { value });
});

app.put("/api/settings/:key", (req, res) => {
  const { value } = req.body;
  if (typeof value !== "string") {
    return badRequest(res, "value must be a string");
  }
  setSetting(req.params.key, value);
  // Turning screen detection off leaves the last detected state dangling —
  // clear it so game-state-bound zones/blocks don't stay locked on a stale
  // detection that will never update again.
  if (req.params.key === "screenDetectionEnabled" && value === "false") {
    setDetectedGameState(null, 0);
  }
  broadcastOverlayState();
  ok(res, { updated: true });
});

// ---------------------------------------------------------------------------
// Self-update (drives the same GUI wizard as update.bat)
// ---------------------------------------------------------------------------

function findRepoRoot(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url)); // backend/api/src
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runGit(
  repo: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: repo, timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const rawCode = (err as NodeJS.ErrnoException | null)?.code;
      const code = typeof rawCode === "number" ? rawCode : err ? 1 : 0;
      resolve({ code, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" });
    });
  });
}

app.get("/api/update/check", async (_req, res) => {
  const repo = findRepoRoot();
  if (!repo) {
    return ok(res, { supported: false, available: false, reason: "This install isn't a git checkout." });
  }
  const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
  if (!head) {
    return ok(res, { supported: false, available: false, reason: "git not available." });
  }
  const upstream = await runGit(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const branch = (await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  if (upstream.code !== 0) {
    return ok(res, { supported: true, available: false, currentCommit: head, branch, reason: "No upstream branch is configured." });
  }
  const up = upstream.stdout.trim();
  const fetched = await runGit(repo, ["fetch", "--quiet"], 25_000);
  const remoteCommit = (await runGit(repo, ["rev-parse", up])).stdout.trim();
  const behind = Number.parseInt((await runGit(repo, ["rev-list", "--count", `HEAD..${up}`])).stdout.trim(), 10) || 0;
  ok(res, {
    supported: true,
    available: behind > 0,
    behind,
    currentCommit: head,
    remoteCommit,
    branch,
    fetchOk: fetched.code === 0,
    reason: fetched.code === 0 ? undefined : "Couldn't reach the remote (offline?).",
  });
});

app.post("/api/update/apply", (_req, res) => {
  const repo = findRepoRoot();
  if (!repo) return badRequest(res, "This install isn't a git checkout — can't self-update.");
  if (process.platform !== "win32") return badRequest(res, "The update wizard is only available on Windows.");
  const bat = path.join(repo, "update.bat");
  if (!existsSync(bat)) return badRequest(res, "update.bat not found at the repo root.");
  try {
    // Launch detached via `start` so the wizard survives this API being killed
    // when start.bat relaunches everything at the end of the update.
    const child = spawn("cmd.exe", ["/c", "start", "", bat], {
      cwd: repo,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    ok(res, { started: true });
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "Failed to launch the updater.");
  }
});

// ---------------------------------------------------------------------------
// Auto-start on login (Windows Startup-folder shortcut)
// ---------------------------------------------------------------------------

function runAutostartManage(
  action: "status" | "enable" | "disable",
): Promise<{ enabled: boolean; path: string }> {
  return new Promise((resolve, reject) => {
    const repo = findRepoRoot();
    if (!repo) return reject(new Error("This install isn't a git checkout."));
    const app = path.join(repo, "app");
    const script = path.join(app, "scripts", "autostart-manage.ps1");
    if (!existsSync(script)) return reject(new Error("autostart-manage.ps1 not found."));
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action, "-Root", app],
      { timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout.toString().trim()));
        } catch {
          reject(new Error("Couldn't parse auto-start status."));
        }
      },
    );
  });
}

app.get("/api/autostart", async (_req, res) => {
  if (process.platform !== "win32") {
    return ok(res, { supported: false, enabled: false, reason: "Auto-start is only available on Windows." });
  }
  try {
    const state = await runAutostartManage("status");
    ok(res, { supported: true, enabled: state.enabled });
  } catch (err) {
    ok(res, { supported: false, enabled: false, reason: err instanceof Error ? err.message : "unavailable" });
  }
});

app.post("/api/autostart", async (req, res) => {
  if (process.platform !== "win32") return badRequest(res, "Auto-start is only available on Windows.");
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") return badRequest(res, "`enabled` must be a boolean.");
  try {
    const state = await runAutostartManage(enabled ? "enable" : "disable");
    ok(res, { supported: true, enabled: state.enabled });
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "Failed to change auto-start.");
  }
});

// ---------------------------------------------------------------------------
// Premium currencies (the isometric base builder is sunset; balances remain)
// ---------------------------------------------------------------------------

// Award premium currency (diamonds/emeralds) — e.g. arena run rewards.
// Gold is intentionally rejected: gold is minted by productivity only.
app.post("/api/base-currencies/award", (req, res) => {
  const currency = req.body?.currency;
  const amount = req.body?.amount;
  if (currency !== "diamonds" && currency !== "emeralds") {
    return badRequest(res, "currency must be 'diamonds' or 'emeralds'");
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return badRequest(res, "amount must be a non-negative integer");
  }
  ok(res, awardBaseCurrency(currency, amount));
});

// ---------------------------------------------------------------------------
// Base — lane defense (Stage 1)
// ---------------------------------------------------------------------------

const isDefenseSandbox = (value: unknown) => value === true || value === "1" || value === "true";

app.get("/api/defense-state", (req, res) => {
  ok(res, getDefenseSnapshot(isDefenseSandbox(req.query.sandbox)));
});

app.post("/api/defense/upgrade", (req, res) => {
  const slotIndex = req.body?.slotIndex;
  if (typeof slotIndex !== "number" || !Number.isInteger(slotIndex)) {
    return badRequest(res, "slotIndex must be an integer");
  }
  const sandbox = isDefenseSandbox(req.body?.sandbox);
  try {
    ok(res, buyDefenseUpgrade(sandbox, slotIndex));
  } catch (err) {
    return badRequest(res, err instanceof Error ? err.message : "upgrade failed");
  }
  // The real defense run is shared with friends via the social snapshot.
  if (!sandbox) triggerCloudSnapshotSync();
});

// Collapse behaviour A/B toggle ("knockback" | "reset") — applies to both the
// real battle and the sandbox.
app.post("/api/defense/config", (req, res) => {
  const mode = req.body?.deathMode;
  if (mode !== "knockback" && mode !== "reset") {
    return badRequest(res, "deathMode must be 'knockback' or 'reset'");
  }
  setDefenseDeathMode(mode);
  ok(res, getDefenseSnapshot(isDefenseSandbox(req.body?.sandbox)));
});

// Sandbox-only playtest controls: skip time, grant practice gold, reset.
// Never touches the real defense run or real gold.
app.post("/api/defense/sandbox", (req, res) => {
  const action = req.body?.action;
  if (action === "skip") {
    const hours = req.body?.hours;
    if (typeof hours !== "number" || !(hours > 0) || hours > 24 * 30) {
      return badRequest(res, "hours must be a positive number (max 720)");
    }
    return ok(res, runDefenseSandboxAction({ action: "skip", hours }));
  }
  if (action === "grant") {
    const amount = req.body?.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) {
      return badRequest(res, "amount must be a positive integer (max 1000000)");
    }
    return ok(res, runDefenseSandboxAction({ action: "grant", amount }));
  }
  if (action === "reset") {
    return ok(res, runDefenseSandboxAction({ action: "reset" }));
  }
  badRequest(res, "action must be 'skip', 'grant', or 'reset'");
});

// ---------------------------------------------------------------------------
// The Crawl — overlay dungeon run. Every route returns the same full snapshot,
// so the panel replaces its state wholesale and never has to merge.
// ---------------------------------------------------------------------------

/** Wraps a crawl mutation: engine errors become 400s, not 500s. */
function crawlRoute(res: express.Response, run: () => CrawlSnapshot) {
  try {
    ok(res, run());
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "crawl action failed");
  }
}

app.get("/api/crawl", (_req, res) => {
  crawlRoute(res, () => getCrawlSnapshot());
});

app.post("/api/crawl/play", (req, res) => {
  const handIndex = req.body?.handIndex;
  if (typeof handIndex !== "number" || !Number.isInteger(handIndex) || handIndex < 0) {
    return badRequest(res, "handIndex must be a non-negative integer");
  }
  crawlRoute(res, () => playCrawlCardAction(handIndex));
});

app.post("/api/crawl/end-turn", (_req, res) => {
  crawlRoute(res, () => endCrawlTurnAction());
});

// Spend one micro-gold draw credit. No body: a draw is always exactly one card.
app.post("/api/crawl/draw", (_req, res) => {
  crawlRoute(res, () => drawCrawlCardAction());
});

app.post("/api/crawl/reward", (req, res) => {
  const cardId = req.body?.cardId;
  // null is meaningful here: it means "skip the card and keep the deck lean".
  if (cardId !== null && cardId !== undefined && typeof cardId !== "string") {
    return badRequest(res, "cardId must be a string or null");
  }
  crawlRoute(res, () => chooseCrawlRewardAction(cardId ?? null));
});

app.post("/api/crawl/restart", (_req, res) => {
  crawlRoute(res, () => restartCrawlAction());
});

// The agent's hook: pin a todo so the current enemy is warded until it is done.
app.post("/api/crawl/ward", (req, res) => {
  const todoId = req.body?.todoId;
  if (todoId !== null && todoId !== undefined && typeof todoId !== "string") {
    return badRequest(res, "todoId must be a string or null");
  }
  crawlRoute(res, () => setCrawlWardAction(todoId ?? null));
});

app.get("/api/overlay-state", (_req, res) => {
  ok(res, buildOverlayState());
});

// The current step: one line of "do this now", written by an agent. Reading is
// unfiltered by the display toggle — an agent should see what it wrote even if
// the user has the overlay display switched off.
// Re-broadcast the overlay state. The MCP server talks straight to SQLite and so
// cannot push anything itself; this is how a write made over MCP reaches an open
// overlay without waiting for the next heartbeat.
app.post("/api/overlay/refresh", (_req, res) => {
  broadcastOverlayState();
  ok(res, { broadcast: true });
});

app.get("/api/current-step", (_req, res) => {
  ok(res, { step: getCurrentStep() });
});

// Mark it done. The only way a step leaves the overlay early — there is no user
// dismissal, by design.
app.post("/api/current-step/complete", (_req, res) => {
  const step = completeCurrentStep();
  ok(res, { step });
  broadcastOverlayState();
});

// `text: null` (or an empty string) clears it. Broadcasts so the overlay updates
// immediately instead of waiting for the next 5s heartbeat.
app.put("/api/current-step", (req, res) => {
  const text = req.body?.text;
  if (text !== null && text !== undefined && typeof text !== "string") {
    return badRequest(res, "text must be a string or null");
  }
  const subtitle = typeof req.body?.subtitle === "string" ? req.body.subtitle : null;
  const source = typeof req.body?.source === "string" ? req.body.source : null;
  const step = setCurrentStep(text ?? null, { subtitle, source });
  ok(res, { step });
  broadcastOverlayState();
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

function broadcastPlaySound(sound: string = "gold") {
  sendEvent("play_sound", { sound });
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

// Periodically push overlay state so cooldown expirations are reflected in the overlay agent
// without requiring a separate user action to trigger a broadcast.
setInterval(() => {
  broadcastOverlayState();
}, 5_000).unref();

// Pay out received feed hearts (+1 gold each) even while the friends panel is
// closed. The overlay's received-hearts poll reconciles too; the table guard
// makes the two paths safely overlap.
setInterval(() => {
  if (!isCloudSyncReady()) return;
  void reconcileReceivedFeedHearts().catch((error) => {
    console.error("[api] feed-heart reconcile failed", error);
  });
}, 5 * 60_000).unref();

app.use(errorLogger);

// Overlay visibility is session state, not a sticky preference: hiding the
// overlay (toggle hotkey or the Settings checkboxes) lasts until the app is
// restarted, and a fresh start always brings it back. Without this, one hotkey
// press hides the overlay for good and it is easy to forget it exists.
setSetting("showGoldToday", "true");
setSetting("showBaseOverlay", "true");

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
