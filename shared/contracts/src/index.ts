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
});
export type Prediction = z.infer<typeof predictionSchema>;

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
});
export type AccountabilityState = z.infer<typeof accountabilityStateSchema>;

export const goldStateSchema = z.object({
  gold: z.number().int().nonnegative(),
  rewardedTodoIds: z.array(z.string()),
});
export type GoldState = z.infer<typeof goldStateSchema>;

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
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;

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
});
export type SharedProfile = z.infer<typeof sharedProfileSchema>;

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
  gold: goldStateSchema,
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
  type: z.enum(["overlay_state", "health"]),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Base Builder
// ---------------------------------------------------------------------------

export const buildingPlacementSchema = z.object({
  itemId: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().int().min(0).max(3).default(0),
  flipped: z.boolean().default(false),
});
export type BuildingPlacement = z.infer<typeof buildingPlacementSchema>;

export const baseCurrenciesSchema = z.object({
  gold: z.number().int().nonnegative(),
  diamonds: z.number().int().nonnegative(),
  emeralds: z.number().int().nonnegative(),
});
export type BaseCurrencies = z.infer<typeof baseCurrenciesSchema>;

export const baseInventorySchema = z.record(z.string(), z.number().int().nonnegative());
export type BaseInventory = z.infer<typeof baseInventorySchema>;

export const baseStateSchema = z.object({
  placements: z.array(buildingPlacementSchema),
  inventory: baseInventorySchema,
  currencies: baseCurrenciesSchema,
  /** Tracks which streak milestones have already been rewarded */
  diamondMilestones: z.array(z.number().int()),
  updatedAt: z.string(),
});
export type BaseState = z.infer<typeof baseStateSchema>;

export const progressionSchema = z.object({
  gold: z.number(),
  diamonds: z.number(),
  emeralds: z.number(),
  totalTodosCompleted: z.number(),
  totalTodosCreated: z.number(),
  currentDayStreak: z.number(),
  longestDayStreak: z.number(),
  activeHabitsCount: z.number(),
  totalHabitChecks: z.number(),
  totalPredictions: z.number(),
  totalReflections: z.number(),
});
export type Progression = z.infer<typeof progressionSchema>;

export type BaseCurrencyType = "gold" | "diamonds" | "emeralds";

export const baseShopPurchaseRequestSchema = z.object({
  itemId: z.string(),
  cost: z.number().int().nonnegative(),
  currency: z.enum(["gold", "diamonds", "emeralds"]).default("gold"),
});
export type BaseShopPurchaseRequest = z.infer<typeof baseShopPurchaseRequestSchema>;

export const baseShopPurchaseResponseSchema = z.object({
  gold: z.number(),
  diamonds: z.number(),
  emeralds: z.number(),
  inventory: baseInventorySchema,
});
export type BaseShopPurchaseResponse = z.infer<typeof baseShopPurchaseResponseSchema>;

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
