import type {
  AccountabilityState,
  Block,
  BlockUnlockMode,
  CloudConnectionStatus,
  CurrentStep,
  DetectedGameState,
  FeedHeart,
  FriendFeedItem,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  FriendTodaySummary,
  GameState,
  GameStateDetectionRegion,
  GameStateReferenceImage,
  GoldActivityDay,
  GoldActivitySource,
  GoldState,
  Habit,
  HabitStatus,
  LockScheduleEntry,
  LockZone,
  LockZoneUnlockMode,
  OverlayState,
  Prediction,
  PredictionOutcome,
  ReflectionEntry,
  EncouragementEntryType,
  EncouragementKind,
  EncouragementResponse,
  SharedProfile,
  SharedStatus,
  SocialSettings,
  StatusChip,
  Todo,
  VaultPullResponse,
  VaultPushRequest,
  VaultPushResponse,
  VaultVersionResponse,
} from "@slaythelist/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type UpdateCheckResult = {
  supported: boolean;
  available: boolean;
  behind?: number;
  currentCommit?: string;
  remoteCommit?: string;
  branch?: string;
  fetchOk?: boolean;
  reason?: string;
};

export async function checkForUpdates() {
  return request<UpdateCheckResult>("/api/update/check");
}

export async function applyUpdate() {
  return request<{ started: boolean }>("/api/update/apply", { method: "POST" });
}

export type AutostartState = {
  supported: boolean;
  enabled: boolean;
  reason?: string;
};

export async function getAutostart() {
  return request<AutostartState>("/api/autostart");
}

export async function setAutostart(enabled: boolean) {
  return request<AutostartState>("/api/autostart", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function getCloudConnectionStatus() {
  return request<CloudConnectionStatus>("/api/cloud-social/status");
}

export async function startCloudConnect(provider = "google") {
  return request<CloudConnectionStatus>("/api/cloud-social/connect/start", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export async function pollCloudConnect() {
  return request<CloudConnectionStatus>("/api/cloud-social/connect/poll", {
    method: "POST",
  });
}

export async function disconnectCloudConnect() {
  return request<CloudConnectionStatus>("/api/cloud-social/disconnect", {
    method: "POST",
  });
}

export async function updateCloudUsername(username: string) {
  return request<CloudConnectionStatus>("/api/cloud-social/me/username", {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });
}

export async function syncCloudSnapshot() {
  return request<CloudConnectionStatus>("/api/cloud-social/sync", {
    method: "POST",
  });
}

export async function getCloudSocialSettings() {
  return request<SocialSettings>("/api/cloud-social/settings");
}

export async function saveCloudSocialSettings(settings: SocialSettings) {
  return request<SocialSettings>("/api/cloud-social/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

// Own color-coded status chips (energy / availability / custom), shared with
// friends via the cloud snapshot.
export async function getSocialStatus() {
  return request<SharedStatus>("/api/social-status");
}

export async function saveSocialStatus(chips: StatusChip[]) {
  return request<SharedStatus>("/api/social-status", {
    method: "PUT",
    body: JSON.stringify({ chips }),
  });
}

// Compact per-friend cards for the overlay taskbar. `date` = local YYYY-MM-DD.
export async function getCloudFriendsSummary(date: string) {
  return request<{ items: FriendTodaySummary[] }>(
    `/api/cloud-social/friends/summary?date=${encodeURIComponent(date)}`,
  );
}

// Queue of visible-to-you things friends got done since `since` (ISO 8601).
export async function getCloudFriendsFeed(since: string) {
  return request<{ items: FriendFeedItem[] }>(
    `/api/cloud-social/friends/feed?since=${encodeURIComponent(since)}`,
  );
}

export async function sendFeedHeart(targetUserId: string, entryId: string) {
  return request<FeedHeart>("/api/cloud-social/feed-hearts", {
    method: "POST",
    body: JSON.stringify({ targetUserId, entryId }),
  });
}

export async function removeFeedHeart(entryId: string) {
  return request<{ success: true }>(`/api/cloud-social/feed-hearts/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
}

// Hearts friends put on your own entries since `since`.
export async function getFeedHeartsReceived(since: string) {
  return request<{ items: FeedHeart[] }>(
    `/api/cloud-social/feed-hearts/received?since=${encodeURIComponent(since)}`,
  );
}

export async function searchCloudSocialUsers(query: string) {
  return request<{ items: FriendSearchResult[] }>(`/api/cloud-social/users?q=${encodeURIComponent(query)}`);
}

export async function listCloudFriends() {
  return request<{ items: FriendSummary[] }>("/api/cloud-social/friends");
}

export async function listCloudFriendRequests() {
  return request<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/api/cloud-social/friend-requests");
}

export async function sendCloudFriendRequest(username: string) {
  return request<FriendRequest>("/api/cloud-social/friend-requests", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export async function acceptCloudFriendRequest(requestId: string) {
  return request<FriendRequest>(`/api/cloud-social/friend-requests/${requestId}/accept`, {
    method: "POST",
  });
}

export async function declineCloudFriendRequest(requestId: string) {
  return request<FriendRequest>(`/api/cloud-social/friend-requests/${requestId}/decline`, {
    method: "POST",
  });
}

export async function cancelCloudFriendRequest(requestId: string) {
  return request<FriendRequest>(`/api/cloud-social/friend-requests/${requestId}`, {
    method: "DELETE",
  });
}

export async function removeCloudFriend(friendUserId: string) {
  return request<{ success: boolean }>(`/api/cloud-social/friends/${friendUserId}`, {
    method: "DELETE",
  });
}

export async function getCloudSharedProfile(username: string) {
  return request<SharedProfile>(`/api/cloud-social/users/${encodeURIComponent(username)}`);
}

export async function sendEncouragement(
  targetUserId: string,
  entryType: EncouragementEntryType,
  entryId: string,
  kind: EncouragementKind,
) {
  return request<EncouragementResponse>("/api/cloud-social/encourage", {
    method: "POST",
    body: JSON.stringify({ targetUserId, entryType, entryId, kind }),
  });
}

// ---------------------------------------------------------------------------
// Cloud Vault
// ---------------------------------------------------------------------------

export async function getVaultVersion() {
  return request<VaultVersionResponse>("/api/vault/version");
}

export async function pullVaultData() {
  return request<VaultPullResponse>("/api/vault/pull");
}

export async function pushVaultData(data: VaultPushRequest) {
  return request<VaultPushResponse>("/api/vault/push", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function listTodos() {
  return request<{ items: Todo[] }>("/api/todos");
}

export async function createTodo(
  title: string,
  options?: { deadlineAt?: string | null; deadlineTime?: string },
) {
  return request<Todo>("/api/todos", {
    method: "POST",
    body: JSON.stringify({
      title,
      deadlineAt: options?.deadlineAt ?? null,
      deadlineTime: options?.deadlineTime,
    }),
  });
}

export async function setTodoStatus(id: string, status: "active" | "done") {
  return request<Todo>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function updateTodo(
  id: string,
  patch: Partial<{
    title: string;
    context: string;
    status: "active" | "done";
    indent: number;
    deadlineAt: string | null;
    deadlineTime: string;
    archived: boolean;
    pushCount: number;
    visibility: "visible" | "private";
  }>,
) {
  return request<Todo>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteTodo(id: string) {
  return request<{ deleted: true }>(`/api/todos/${id}`, {
    method: "DELETE",
  });
}

export async function reorderTodos(orderedTodoIds: string[]) {
  return request<{ items: Todo[] }>("/api/todos/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedTodoIds }),
  });
}

export async function listZones() {
  return request<{ items: LockZone[] }>("/api/zones");
}

export async function createZone(input: {
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  locked?: boolean;
  unlockMode?: LockZoneUnlockMode;
  cooldownEnabled?: boolean;
  cooldownSeconds?: number;
  goldCost?: number;
  schedules?: LockScheduleEntry[];
  blockId?: string;
}) {
  return request<LockZone>("/api/zones", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateZone(
  id: string,
  patch: Partial<LockZone> & { cooldownEnabled?: boolean; cooldownSeconds?: number; schedules?: LockScheduleEntry[] },
) {
  return request<LockZone>(`/api/zones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteZone(id: string) {
  return request<{ deleted: true }>(`/api/zones/${id}`, {
    method: "DELETE",
  });
}

export async function setZoneRequirements(zoneId: string, todoIds: string[]) {
  return request<{ updated: true }>(`/api/zones/${zoneId}/requirements`, {
    method: "PUT",
    body: JSON.stringify({ todoIds }),
  });
}

export async function purchaseZoneGoldUnlock(zoneId: string) {
  return request<{ updated: true }>(`/api/zones/${zoneId}/gold-unlock`, {
    method: "POST",
  });
}

export async function clearZoneGoldUnlock(zoneId: string) {
  return request<{ updated: true }>(`/api/zones/${zoneId}/gold-unlock`, {
    method: "DELETE",
  });
}

export async function getOverlayState() {
  return request<OverlayState>("/api/overlay-state");
}

/** Settings key for the overlay's current-step line. "false" hides it entirely. */
export const SHOW_CURRENT_STEP_SETTING_KEY = "showCurrentStep";

export async function getCurrentStep() {
  return request<{ step: CurrentStep | null }>("/api/current-step");
}

/** `text: null` clears the step. */
export async function setCurrentStep(
  text: string | null,
  options?: { subtitle?: string | null; source?: string | null },
) {
  return request<{ step: CurrentStep | null }>("/api/current-step", {
    method: "PUT",
    body: JSON.stringify({ text, ...options }),
  });
}

export async function getAccountabilityState() {
  return request<AccountabilityState>("/api/accountability-state");
}

export async function saveAccountabilityState(state: AccountabilityState) {
  return request<AccountabilityState>("/api/accountability-state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

export async function getGoldState() {
  return request<GoldState>("/api/gold-state");
}

export async function saveGoldState(state: GoldState) {
  return request<GoldState>("/api/gold-state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

export type GoldActivityInput = {
  sourceType: GoldActivitySource;
  sourceId?: string | null;
  label?: string;
  // Grouping day (YYYY-MM-DD) this entry belongs under, when it differs from the
  // day of the click — e.g. ticking a habit for a past day.
  date?: string;
};

export async function awardGold(amount: number, activity?: GoldActivityInput) {
  return request<GoldState>("/api/gold/award", {
    method: "POST",
    body: JSON.stringify({ amount, activity }),
  });
}

export async function deductGold(amount: number, activity?: GoldActivityInput) {
  return request<GoldState>("/api/gold/deduct", {
    method: "POST",
    body: JSON.stringify({ amount, activity }),
  });
}

export async function awardTodoGold(todoId: string, amount: number, activity?: GoldActivityInput) {
  return request<{ state: GoldState; awarded: boolean }>("/api/gold/award-todo", {
    method: "POST",
    body: JSON.stringify({ todoId, amount, activity }),
  });
}

export async function listGoldActivity(days = 30) {
  return request<{ days: GoldActivityDay[] }>(`/api/gold/activity?days=${days}`);
}

// Move a ledger entry to a different day (the day it actually happened).
export async function updateGoldActivityDate(id: string, date: string) {
  return request<{ updated: boolean; id: string; date: string }>(
    `/api/gold/activity/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ date }),
    },
  );
}

export async function listHabits() {
  return request<{ items: Habit[] }>("/api/habits");
}

export async function createHabit(input: { name: string; status?: HabitStatus }) {
  return request<Habit>("/api/habits", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateHabit(
  id: string,
  patch: Partial<{ name: string; status: HabitStatus; checks: Habit["checks"]; visibility: "visible" | "private" }>,
) {
  return request<Habit>(`/api/habits/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteHabit(id: string) {
  return request<{ deleted: true }>(`/api/habits/${id}`, {
    method: "DELETE",
  });
}

export async function listPredictions() {
  return request<{ items: Prediction[] }>("/api/predictions");
}

export async function createPrediction(input: { title: string; confidence: number }) {
  return request<Prediction>("/api/predictions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePrediction(
  id: string,
  patch: Partial<{
    title: string;
    confidence: number;
    outcome: PredictionOutcome;
    resolvedAt: number | null;
    logDate: string | null;
    visibility: "visible" | "private";
  }>,
) {
  return request<Prediction>(`/api/predictions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deletePrediction(id: string) {
  return request<{ deleted: true }>(`/api/predictions/${id}`, {
    method: "DELETE",
  });
}

export async function listReflections() {
  return request<{ items: ReflectionEntry[] }>("/api/reflections");
}

export async function createReflection(
  input: Pick<ReflectionEntry, "date" | "wins" | "challenges" | "notes" | "tomorrow">,
) {
  return request<ReflectionEntry>("/api/reflections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateReflection(
  id: string,
  patch: Partial<Pick<ReflectionEntry, "date" | "wins" | "challenges" | "notes" | "tomorrow">>,
) {
  return request<ReflectionEntry>(`/api/reflections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteReflection(id: string) {
  return request<{ deleted: true }>(`/api/reflections/${id}`, {
    method: "DELETE",
  });
}

/** App-settings key for how far back the overlay's friends activity feed
 *  looks (minutes). Stored in the local API so the overlay window and the
 *  browser app read the same value. */
export const FEED_WINDOW_SETTING_KEY = "friendsFeedWindowMinutes";

export async function getAppSetting(key: string) {
  return request<{ value: string | null }>(`/api/settings/${encodeURIComponent(key)}`);
}

export async function setAppSetting(key: string, value: string) {
  return request<{ updated: true }>(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

export function overlayWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

// ---------------------------------------------------------------------------
// Game States
// ---------------------------------------------------------------------------

export async function listGameStates() {
  return request<{ items: GameState[] }>("/api/game-states");
}

export async function createGameState(input: { name: string; matchThreshold?: number }) {
  return request<GameState>("/api/game-states", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateGameState(
  id: string,
  patch: Partial<{ name: string; enabled: boolean; matchThreshold: number; alwaysDetect: boolean }>,
) {
  return request<GameState>(`/api/game-states/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteGameState(id: string) {
  return request<{ deleted: true }>(`/api/game-states/${id}`, {
    method: "DELETE",
  });
}

export async function listReferenceImages(gameStateId: string) {
  return request<{ items: GameStateReferenceImage[] }>(`/api/game-states/${gameStateId}/reference-images`);
}

export async function uploadReferenceImage(gameStateId: string, imageData: string, filename: string) {
  return request<GameStateReferenceImage>(`/api/game-states/${gameStateId}/reference-images`, {
    method: "POST",
    body: JSON.stringify({ imageData, filename }),
  });
}

export async function deleteReferenceImage(imageId: string) {
  return request<{ deleted: true }>(`/api/game-states/reference-images/${imageId}`, {
    method: "DELETE",
  });
}

export async function setZoneGameStates(zoneId: string, gameStateIds: string[]) {
  return request<{ updated: true }>(`/api/zones/${zoneId}/game-states`, {
    method: "PUT",
    body: JSON.stringify({ gameStateIds }),
  });
}

export async function getDetectedGameState() {
  return request<DetectedGameState>("/api/detected-game-state");
}

export async function setDetectedGameState(gameStateId: string | null, confidence: number) {
  return request<DetectedGameState>("/api/detected-game-state", {
    method: "PUT",
    body: JSON.stringify({ gameStateId, confidence }),
  });
}

export function referenceImageUrl(gameStateId: string, filename: string) {
  return `${API_BASE}/api/reference-images/${gameStateId}/${filename}`;
}

export type DetectionTestResult = {
  gameStateId: string;
  gameStateName: string;
  imageId: string;
  filename: string;
  ncc: number;
  histogram: number;
  combined: number;
};

export async function testDetection(imageData: string) {
  return request<{ results: DetectionTestResult[] }>("/api/game-states/test-detection", {
    method: "POST",
    body: JSON.stringify({ imageData }),
  });
}

export async function listDetectionRegions(gameStateId: string) {
  return request<{ items: GameStateDetectionRegion[] }>(`/api/game-states/${gameStateId}/detection-regions`);
}

export async function setDetectionRegions(
  gameStateId: string,
  regions: Array<{ x: number; y: number; width: number; height: number }>,
) {
  return request<{ items: GameStateDetectionRegion[] }>(`/api/game-states/${gameStateId}/detection-regions`, {
    method: "PUT",
    body: JSON.stringify({ regions }),
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export async function listBlocks() {
  return request<{ items: Block[] }>("/api/blocks");
}

export async function createBlock(
  name: string,
  gameStateId: string,
  unlockMode?: BlockUnlockMode,
) {
  return request<Block>("/api/blocks", {
    method: "POST",
    body: JSON.stringify({ name, gameStateId, unlockMode }),
  });
}

export async function updateBlock(
  id: string,
  patch: Partial<{ name: string; gameStateId: string; unlockMode: BlockUnlockMode; enabled: boolean; sortOrder: number }>,
) {
  return request<Block>(`/api/blocks/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function deleteBlock(id: string) {
  return request<{ deleted: true }>(`/api/blocks/${id}`, {
    method: "DELETE",
  });
}

