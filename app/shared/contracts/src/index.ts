import { z } from "zod";

export const todoStatusSchema = z.enum(["active", "done"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  status: todoStatusSchema,
  indent: z.number().int().nonnegative(),
  sortOrder: z.number().int().nonnegative(),
  deadlineAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  pushCount: z.number().int().nonnegative(),
  // Controls whether this todo's title shows up in the shared daily gold log.
  // Defaults to "visible"; toggled per-todo from the edit (pen) UI.
  visibility: z.enum(["visible", "private"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Todo = z.infer<typeof todoSchema>;

export const habitCheckSchema = z.object({
  date: z.string(),
  done: z.boolean(),
});
export type HabitCheck = z.infer<typeof habitCheckSchema>;

export const habitStatusSchema = z.enum(["active", "archived", "idea"]);
export type HabitStatus = z.infer<typeof habitStatusSchema>;

export const itemVisibilitySchema = z.enum(["visible", "private"]);
export type ItemVisibility = z.infer<typeof itemVisibilitySchema>;

export const habitSchema = z.object({
  id: z.string(),
  name: z.string(),
  checks: z.array(habitCheckSchema),
  createdAt: z.number(),
  status: habitStatusSchema.default("active"),
  bonus: z.boolean().optional(),
  visibility: itemVisibilitySchema.optional(),
});
export type Habit = z.infer<typeof habitSchema>;

export const predictionOutcomeSchema = z.enum(["pending", "hit", "miss"]);
export type PredictionOutcome = z.infer<typeof predictionOutcomeSchema>;

export const predictionSchema = z.object({
  id: z.string(),
  title: z.string(),
  confidence: z.number().int().min(1).max(99),
  outcome: predictionOutcomeSchema,
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
  murphy: z.boolean().optional(),
  targetTitle: z.string().optional(),
  visibility: itemVisibilitySchema.optional(),
  // Daily-log grouping override (local YYYY-MM-DD): the day this prediction
  // shows up in the log, without touching createdAt/resolvedAt. Absent =
  // group by resolution day (resolved) or made day (pending).
  logDate: z.string().optional(),
  // Gold escrowed on this prediction at creation. While pending, a staked
  // prediction's confidence is locked (it determines the payout).
  stake: z.number().int().min(1).optional(),
  // Gold returned at resolution (0 = stake fully lost). Set iff stake is set
  // and the prediction is resolved.
  payout: z.number().int().min(0).optional(),
});
export type Prediction = z.infer<typeof predictionSchema>;

// Payout for a staked prediction: baseline-relative quadratic scoring.
// Break-even at 50% confidence, up to 2× the stake back when confident and
// right, clamped at 0 so the maximum loss is the stake. Honest confidence
// maximizes expected gold (mildly overconfidence-tolerant above ~71% only
// because of the clamp).
export function predictionStakePayout(stake: number, confidence: number, outcome: "hit" | "miss"): number {
  const f = confidence / 100;
  const o = outcome === "hit" ? 1 : 0;
  return Math.round(stake * Math.max(0, 2 - 4 * (f - o) ** 2));
}

export const walkthroughSchema = z.object({
  id: z.string(),
  date: z.string(), // YYYY-MM-DD
  plan: z.string(),
  divergences: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  visibility: itemVisibilitySchema.optional(),
});
export type Walkthrough = z.infer<typeof walkthroughSchema>;

export const reflectionEntrySchema = z.object({
  id: z.string(),
  date: z.string(),
  prompts: z
    .object({
      wins: z.string(),
      challenges: z.string(),
      learnings: z.string(),
      tomorrow: z.string(),
      gratitude: z.string(),
    })
    .catchall(z.string())
    .optional(),
  items: z.record(z.string(), z.array(z.string())).optional(),
  wins: z.string(),
  challenges: z.string(),
  notes: z.string(),
  tomorrow: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ReflectionEntry = z.infer<typeof reflectionEntrySchema>;

export const accountabilityStateSchema = z.object({
  habits: z.array(habitSchema),
  predictions: z.array(predictionSchema),
  reflections: z.array(reflectionEntrySchema),
  walkthroughs: z.array(walkthroughSchema).optional(),
});
export type AccountabilityState = z.infer<typeof accountabilityStateSchema>;

export const goldStateSchema = z.object({
  gold: z.number().int().nonnegative(),
  rewardedTodoIds: z.array(z.string()),
});
export type GoldState = z.infer<typeof goldStateSchema>;

// ---------------------------------------------------------------------------
// Gold activity ledger — a per-action history of how gold was earned/spent,
// aggregated per day for the "daily log" shown on your own and friends' profiles.
// ---------------------------------------------------------------------------

export const goldActivitySourceSchema = z.enum([
  "todo",
  "habit",
  "encouragement",
  "manual",
  "spend",
  "prediction",
  "micro",
]);
export type GoldActivitySource = z.infer<typeof goldActivitySourceSchema>;

// A single ledger row as stored/served locally (full detail, no privacy applied).
export const goldActivityEntrySchema = z.object({
  id: z.string(),
  date: z.string(), // YYYY-MM-DD (local day the action happened)
  createdAt: z.string(), // ISO timestamp
  delta: z.number().int(), // positive = earned, negative = spent
  sourceType: goldActivitySourceSchema,
  sourceId: z.string().nullable(),
  label: z.string(), // e.g. todo title or habit name at time of the action
  // When true, the entry is hidden from shared views (rolled into "Private
  // items"). Used e.g. for untitled agent awards.
  private: z.boolean().default(false),
});
export type GoldActivityEntry = z.infer<typeof goldActivityEntrySchema>;

// A single day's rollup for local display.
export const goldActivityDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  total: z.number().int(), // net gold for the day
  entries: z.array(goldActivityEntrySchema),
});
export type GoldActivityDay = z.infer<typeof goldActivityDaySchema>;

// The privacy-applied form that gets shared with friends. Private entries keep
// their delta (so day totals still reconcile) but drop the identifying label.
export const sharedDailyLogEntrySchema = z.object({
  // Ledger id + timestamp let friends' overlays build a recent-activity feed
  // and heart individual entries. Optional: older snapshots predate them.
  id: z.string().optional(),
  createdAt: z.string().optional(), // ISO timestamp
  delta: z.number().int(),
  sourceType: goldActivitySourceSchema,
  label: z.string().nullable(), // null when the source item is private
  private: z.boolean(),
});
export type SharedDailyLogEntry = z.infer<typeof sharedDailyLogEntrySchema>;

export const sharedDailyLogDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  total: z.number().int(),
  entries: z.array(sharedDailyLogEntrySchema),
});
export type SharedDailyLogDay = z.infer<typeof sharedDailyLogDaySchema>;

// ---------------------------------------------------------------------------
// Status — short-lived, color-coded "how my day is going" chips shared with
// friends (energy level, open to a call, co-working, custom labels).
// ---------------------------------------------------------------------------

export const statusChipSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(40),
  /** CSS color of the chip — the at-a-glance code for energy/availability. */
  color: z.string().min(1).max(32),
});
export type StatusChip = z.infer<typeof statusChipSchema>;

export const sharedStatusSchema = z.object({
  chips: z.array(statusChipSchema).max(8),
  updatedAt: z.string(),
});
export type SharedStatus = z.infer<typeof sharedStatusSchema>;

export const socialVisibilitySchema = z.enum(["private", "friends", "public"]);
export type SocialVisibility = z.infer<typeof socialVisibilitySchema>;

export const userProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const sessionUserSchema = userProfileSchema.pick({
  id: true,
  username: true,
  email: true,
  createdAt: true,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authResponseSchema = z.object({
  user: sessionUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const socialSettingsSchema = z.object({
  habitsVisibility: socialVisibilitySchema.default("friends"),
  predictionsVisibility: socialVisibilitySchema.default("friends"),
  goldVisibility: socialVisibilitySchema.default("friends"),
  walkthroughsVisibility: socialVisibilitySchema.default("private"),
  // "Base" = the lane-defense game — governs the shared defense snapshot.
  baseVisibility: socialVisibilitySchema.default("friends"),
  dailyLogVisibility: socialVisibilitySchema.default("friends"),
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;

// ---------------------------------------------------------------------------
// Base (lane defense) — shared via the social snapshot so friends can view it
// ---------------------------------------------------------------------------

// Mirrors DefenseState from @slaythelist/defense-engine, kept permissive
// (plain numbers, no literals) so engine version bumps don't invalidate
// stored snapshots. Deliberately excludes the wallet — in real mode that is
// the actual gold balance, which is shared separately under goldVisibility.
export const sharedBaseStateSchema = z.object({
  version: z.number().int(),
  lastTickMs: z.number(),
  runStartedMs: z.number(),
  tier: z.number(),
  kills: z.number(),
  baseHp: z.number(),
  slots: z.array(z.object({ level: z.number() })),
  goldInvestedRun: z.number(),
  meta: z.object({
    bestTier: z.number(),
    runsLost: z.number(),
    totalTierUps: z.number(),
    totalGoldInvested: z.number(),
  }),
});
export type SharedBaseState = z.infer<typeof sharedBaseStateSchema>;

export const sharedBaseSchema = z.object({
  state: sharedBaseStateSchema,
  updatedAt: z.string(),
});
export type SharedBase = z.infer<typeof sharedBaseSchema>;

export const friendRelationshipSchema = z.enum([
  "self",
  "friend",
  "incoming_request",
  "outgoing_request",
  "none",
]);
export type FriendRelationship = z.infer<typeof friendRelationshipSchema>;

export const friendRequestStatusSchema = z.enum(["pending", "accepted", "declined", "cancelled"]);
export type FriendRequestStatus = z.infer<typeof friendRequestStatusSchema>;

export const friendSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
});
export type FriendSummary = z.infer<typeof friendSummarySchema>;

export const friendRequestSchema = z.object({
  id: z.string(),
  sender: friendSummarySchema,
  receiver: friendSummarySchema,
  status: friendRequestStatusSchema,
  createdAt: z.string(),
  respondedAt: z.string().nullable(),
});
export type FriendRequest = z.infer<typeof friendRequestSchema>;

export const friendSearchResultSchema = z.object({
  user: friendSummarySchema,
  relationship: friendRelationshipSchema,
});
export type FriendSearchResult = z.infer<typeof friendSearchResultSchema>;

/** Compact per-friend card for the overlay taskbar: status chips + what
 *  they've done today + base tier. Sections the friend doesn't share are null. */
export const friendTodaySummarySchema = z.object({
  user: friendSummarySchema,
  status: sharedStatusSchema.nullable(),
  today: sharedDailyLogDaySchema.nullable(),
  base: z.object({ tier: z.number(), bestTier: z.number() }).nullable(),
});
export type FriendTodaySummary = z.infer<typeof friendTodaySummarySchema>;

/** One completed item in the friends activity feed — the overlay's queue of
 *  visible-to-you things friends got done inside the configured time window. */
export const friendFeedItemSchema = z.object({
  user: friendSummarySchema,
  entryId: z.string(),
  label: z.string(),
  delta: z.number().int(),
  sourceType: goldActivitySourceSchema,
  createdAt: z.string(), // ISO timestamp
  heartedByMe: z.boolean(),
  hearts: z.number().int(),
});
export type FriendFeedItem = z.infer<typeof friendFeedItemSchema>;

/** A heart a friend put on one of your shared log entries. The label is
 *  captured at heart time so it survives the entry rolling out of the
 *  14-day shared snapshot. */
export const feedHeartSchema = z.object({
  id: z.string(),
  sender: friendSummarySchema,
  entryId: z.string(),
  entryLabel: z.string(),
  createdAt: z.string(),
});
export type FeedHeart = z.infer<typeof feedHeartSchema>;

export const sharedProfileSectionSchema = z.object({
  visibility: socialVisibilitySchema,
  canView: z.boolean(),
});
export type SharedProfileSection = z.infer<typeof sharedProfileSectionSchema>;

export const sharedProfileSchema = z.object({
  user: friendSummarySchema,
  relationship: friendRelationshipSchema,
  settings: socialSettingsSchema,
  habits: z.object({
    visibility: socialVisibilitySchema,
    canView: z.boolean(),
    items: z.array(habitSchema),
  }),
  predictions: z.object({
    visibility: socialVisibilitySchema,
    canView: z.boolean(),
    items: z.array(predictionSchema),
  }),
  gold: z.object({
    visibility: socialVisibilitySchema,
    canView: z.boolean(),
    state: goldStateSchema.nullable(),
  }),
  // The base (lane defense). Optional so this schema still validates against
  // older cloud servers.
  base: z
    .object({
      visibility: socialVisibilitySchema,
      canView: z.boolean(),
      snapshot: sharedBaseSchema.nullable(),
    })
    .optional(),
  // Friends-only status chips; null when unset or not visible to the viewer.
  // Optional so this schema still validates against older cloud servers.
  status: sharedStatusSchema.nullable().optional(),
  // Optional so this schema still validates against older cloud servers that
  // predate the daily-log feature.
  dailyLog: z
    .object({
      visibility: socialVisibilitySchema,
      canView: z.boolean(),
      days: z.array(sharedDailyLogDaySchema),
    })
    .optional(),
  encouragedEntryIds: z.array(z.string()).optional(),
  encouragementsRemainingToday: z.number().optional(),
});
export type SharedProfile = z.infer<typeof sharedProfileSchema>;

export const encouragementKindSchema = z.enum(["encourage", "celebrate"]);
export type EncouragementKind = z.infer<typeof encouragementKindSchema>;

export const encouragementEntryTypeSchema = z.enum(["habit", "prediction"]);
export type EncouragementEntryType = z.infer<typeof encouragementEntryTypeSchema>;

export const encouragementSchema = z.object({
  id: z.string(),
  senderUserId: z.string(),
  senderUsername: z.string(),
  targetUserId: z.string(),
  entryType: encouragementEntryTypeSchema,
  entryId: z.string(),
  kind: encouragementKindSchema,
  createdAt: z.string(),
});
export type Encouragement = z.infer<typeof encouragementSchema>;

export const encouragementResponseSchema = z.object({
  encouragement: encouragementSchema,
  senderGoldAwarded: z.number(),
  remainingToday: z.number(),
});
export type EncouragementResponse = z.infer<typeof encouragementResponseSchema>;

export const cloudAuthProviderSchema = z.string().min(1).max(64);
export type CloudAuthProvider = z.infer<typeof cloudAuthProviderSchema>;

export const cloudIdentityUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().email().nullable(),
  createdAt: z.string(),
});
export type CloudIdentityUser = z.infer<typeof cloudIdentityUserSchema>;

export const socialSnapshotSchema = z.object({
  settings: socialSettingsSchema,
  habits: z.array(habitSchema),
  predictions: z.array(predictionSchema),
  walkthroughs: z.array(walkthroughSchema).optional(),
  gold: goldStateSchema,
  // Privacy already applied before this leaves the local machine.
  dailyLog: z.array(sharedDailyLogDaySchema).optional(),
  // The base (lane-defense run).
  base: sharedBaseSchema.optional(),
  // Color-coded "how's my day" chips, shown to friends.
  status: sharedStatusSchema.optional(),
  sourceUpdatedAt: z.string(),
  syncedAt: z.string().optional(),
});
export type SocialSnapshot = z.infer<typeof socialSnapshotSchema>;

export const cloudSyncStateSchema = z.enum(["idle", "pending", "success", "error"]);
export type CloudSyncState = z.infer<typeof cloudSyncStateSchema>;

export const cloudPendingAuthSchema = z.object({
  provider: cloudAuthProviderSchema,
  authorizationUrl: z.string(),
  expiresAt: z.string(),
  intervalSeconds: z.number().int().positive(),
});
export type CloudPendingAuth = z.infer<typeof cloudPendingAuthSchema>;

export const cloudConnectionStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  cloudBaseUrl: z.string().nullable(),
  user: cloudIdentityUserSchema.nullable(),
  pendingAuth: cloudPendingAuthSchema.nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncState: cloudSyncStateSchema,
  lastSyncError: z.string().nullable(),
});
export type CloudConnectionStatus = z.infer<typeof cloudConnectionStatusSchema>;

export const cloudDeviceStartRequestSchema = z.object({
  provider: cloudAuthProviderSchema.default("generic_stub"),
});
export type CloudDeviceStartRequest = z.infer<typeof cloudDeviceStartRequestSchema>;

export const cloudDeviceStartResponseSchema = z.object({
  deviceCode: z.string(),
  authorizationUrl: z.string(),
  expiresAt: z.string(),
  intervalSeconds: z.number().int().positive(),
  provider: cloudAuthProviderSchema,
});
export type CloudDeviceStartResponse = z.infer<typeof cloudDeviceStartResponseSchema>;

export const cloudDevicePollPendingSchema = z.object({
  status: z.literal("pending"),
});

export const cloudDevicePollApprovedSchema = z.object({
  status: z.literal("approved"),
  accessToken: z.string(),
  user: cloudIdentityUserSchema,
});

export const cloudDevicePollExpiredSchema = z.object({
  status: z.literal("expired"),
});

export const cloudDevicePollResponseSchema = z.discriminatedUnion("status", [
  cloudDevicePollPendingSchema,
  cloudDevicePollApprovedSchema,
  cloudDevicePollExpiredSchema,
]);
export type CloudDevicePollResponse = z.infer<typeof cloudDevicePollResponseSchema>;

export const cloudSyncResponseSchema = z.object({
  syncedAt: z.string(),
  snapshot: socialSnapshotSchema,
});
export type CloudSyncResponse = z.infer<typeof cloudSyncResponseSchema>;

export const cloudUsernameUpdateRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]{3,24}$/),
});
export type CloudUsernameUpdateRequest = z.infer<typeof cloudUsernameUpdateRequestSchema>;

export const gameStateDetectionMethodSchema = z.enum(["screenshot_match"]);
export type GameStateDetectionMethod = z.infer<typeof gameStateDetectionMethodSchema>;

export const gameStateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  enabled: z.boolean(),
  detectionMethod: gameStateDetectionMethodSchema,
  matchThreshold: z.number().min(0).max(1),
  alwaysDetect: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GameState = z.infer<typeof gameStateSchema>;

export const gameStateReferenceImageSchema = z.object({
  id: z.string(),
  gameStateId: z.string(),
  filename: z.string(),
  createdAt: z.string(),
});
export type GameStateReferenceImage = z.infer<typeof gameStateReferenceImageSchema>;

export const gameStateDetectionRegionSchema = z.object({
  id: z.string(),
  gameStateId: z.string(),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type GameStateDetectionRegion = z.infer<typeof gameStateDetectionRegionSchema>;

export const detectedGameStateSchema = z.object({
  gameStateId: z.string().nullable(),
  gameStateName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string(),
});
export type DetectedGameState = z.infer<typeof detectedGameStateSchema>;

export const lockZoneUnlockModeSchema = z.enum(["todos", "gold", "permanent", "schedule"]);
export type LockZoneUnlockMode = z.infer<typeof lockZoneUnlockModeSchema>;

export const lockScheduleEntrySchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type LockScheduleEntry = z.infer<typeof lockScheduleEntrySchema>;

export const lockZoneSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  locked: z.boolean(),
  unlockMode: lockZoneUnlockModeSchema,
  cooldownEnabled: z.boolean(),
  cooldownSeconds: z.number().int().positive(),
  goldCost: z.number().int().positive(),
  schedules: z.array(lockScheduleEntrySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LockZone = z.infer<typeof lockZoneSchema>;

export const blockUnlockModeSchema = z.enum(["independent", "shared"]);
export type BlockUnlockMode = z.infer<typeof blockUnlockModeSchema>;

export const blockSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  gameStateId: z.string(),
  unlockMode: blockUnlockModeSchema,
  enabled: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Block = z.infer<typeof blockSchema>;

export const lockZoneRequirementSchema = z.object({
  zoneId: z.string(),
  todoId: z.string(),
});
export type LockZoneRequirement = z.infer<typeof lockZoneRequirementSchema>;

export const lockZoneStateSchema = z.object({
  zone: lockZoneSchema,
  requiredTodoIds: z.array(z.string()),
  requiredTodoTitles: z.array(z.string()),
  goldUnlockActive: z.boolean(),
  cooldownExpiresAt: z.string().nullable(),
  isLocked: z.boolean(),
  activeForGameStateIds: z.array(z.string()),
  activeForCurrentState: z.boolean(),
  blockId: z.string().nullable(),
  blockUnlockMode: blockUnlockModeSchema.nullable(),
});
export type LockZoneState = z.infer<typeof lockZoneStateSchema>;

export const overlayStateSchema = z.object({
  gameWindow: z.object({
    titleHint: z.string(),
  }),
  zones: z.array(lockZoneStateSchema),
  detectedGameState: detectedGameStateSchema.nullable(),
  gameStates: z.array(gameStateSchema),
  lastUpdatedAt: z.string(),
});
export type OverlayState = z.infer<typeof overlayStateSchema>;

export const eventEnvelopeSchema = z.object({
  type: z.enum(["overlay_state", "health", "play_sound"]),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const playSoundPayloadSchema = z.object({
  sound: z.string().min(1),
});
export type PlaySoundPayload = z.infer<typeof playSoundPayloadSchema>;

// ---------------------------------------------------------------------------
// Cloud Vault (E2E encrypted full-data sync)
// ---------------------------------------------------------------------------

export const vaultPushRequestSchema = z.object({
  encryptedBlob: z.string(),  // base64-encoded encrypted data
  salt: z.string(),            // base64-encoded PBKDF2 salt (stored alongside blob)
  iv: z.string(),              // base64-encoded AES-GCM IV
  version: z.number().int().nonnegative(),  // optimistic concurrency version
});
export type VaultPushRequest = z.infer<typeof vaultPushRequestSchema>;

export const vaultPushResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type VaultPushResponse = z.infer<typeof vaultPushResponseSchema>;

export const vaultPullResponseSchema = z.object({
  encryptedBlob: z.string().nullable(),
  salt: z.string().nullable(),
  iv: z.string().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
});
export type VaultPullResponse = z.infer<typeof vaultPullResponseSchema>;

export const vaultVersionResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
});
export type VaultVersionResponse = z.infer<typeof vaultVersionResponseSchema>;

/** The shape of the unencrypted data inside the vault blob */
export const vaultPayloadSchema = z.object({
  todos: z.array(todoSchema),
  habits: z.array(habitSchema),
  predictions: z.array(predictionSchema),
  reflections: z.array(reflectionEntrySchema),
  gold: goldStateSchema,
  updatedAt: z.string(),
});
export type VaultPayload = z.infer<typeof vaultPayloadSchema>;
