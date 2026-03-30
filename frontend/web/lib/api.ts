import type {
  AccountabilityState,
  Block,
  BlockUnlockMode,
  CloudConnectionStatus,
  DetectedGameState,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  GameState,
  GameStateDetectionRegion,
  GameStateReferenceImage,
  GoldState,
  Habit,
  HabitStatus,
  LockZone,
  LockZoneUnlockMode,
  OverlayState,
  Prediction,
  PredictionOutcome,
  ReflectionEntry,
  SharedProfile,
  SocialSettings,
  Todo,
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

export async function getCloudSharedProfile(username: string) {
  return request<SharedProfile>(`/api/cloud-social/users/${encodeURIComponent(username)}`);
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
  enabled?: boolean;
  unlockMode?: LockZoneUnlockMode;
  cooldownEnabled?: boolean;
  cooldownSeconds?: number;
  goldCost?: number;
  blockId?: string;
}) {
  return request<LockZone>("/api/zones", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateZone(
  id: string,
  patch: Partial<LockZone> & { cooldownEnabled?: boolean; cooldownSeconds?: number },
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

export async function awardGold(amount: number) {
  return request<GoldState>("/api/gold/award", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export async function deductGold(amount: number) {
  return request<GoldState>("/api/gold/deduct", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

export async function awardTodoGold(todoId: string, amount: number) {
  return request<{ state: GoldState; awarded: boolean }>("/api/gold/award-todo", {
    method: "POST",
    body: JSON.stringify({ todoId, amount }),
  });
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
  patch: Partial<{ name: string; status: HabitStatus; checks: Habit["checks"] }>,
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
