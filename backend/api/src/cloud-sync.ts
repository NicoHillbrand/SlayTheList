import {
  cloudConnectionStatusSchema,
  cloudDevicePollResponseSchema,
  cloudDeviceStartRequestSchema,
  cloudUsernameUpdateRequestSchema,
  cloudDeviceStartResponseSchema,
  cloudSyncResponseSchema,
  friendRequestSchema,
  friendSearchResultSchema,
  friendSummarySchema,
  sharedProfileSchema,
  socialSettingsSchema,
  socialSnapshotSchema,
  vaultPullResponseSchema,
  vaultPushRequestSchema,
  vaultPushResponseSchema,
  vaultVersionResponseSchema,
  type CloudConnectionStatus,
  type CloudIdentityUser,
  type FriendRequest,
  type FriendSearchResult,
  type FriendSummary,
  type SharedProfile,
  type SocialSettings,
  type SocialSnapshot,
  type VaultPullResponse,
  type VaultPushRequest,
  type VaultPushResponse,
  type VaultVersionResponse,
} from "@slaythelist/contracts";
import { db } from "./db.js";
import { getAccountabilityState, getGoldState } from "./store.js";

type LocalSocialSettingsRow = {
  habits_visibility: SocialSettings["habitsVisibility"];
  predictions_visibility: SocialSettings["predictionsVisibility"];
  gold_visibility: SocialSettings["goldVisibility"];
};

type CloudConnectionRow = {
  cloud_base_url: string | null;
  cloud_user_id: string | null;
  cloud_username: string | null;
  cloud_email: string | null;
  access_token: string | null;
  pending_device_code: string | null;
  pending_user_code: string | null;
  pending_verification_uri: string | null;
  pending_provider: string | null;
  pending_expires_at: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_state: CloudConnectionStatus["lastSyncState"];
  last_sync_error: string | null;
};

const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  habitsVisibility: "friends",
  predictionsVisibility: "friends",
  goldVisibility: "friends",
};

const DEFAULT_CLOUD_BASE_URL = "https://slaythelist.nicohillbrand.com";

function configuredCloudBaseUrl() {
  return process.env.CLOUD_SOCIAL_BASE_URL?.trim() || DEFAULT_CLOUD_BASE_URL;
}

function getConnectionRow(): CloudConnectionRow {
  return db
    .prepare(
      `SELECT cloud_base_url, cloud_user_id, cloud_username, cloud_email, access_token,
              pending_device_code, pending_user_code, pending_verification_uri, pending_provider, pending_expires_at,
              connected_at, last_sync_at, last_sync_state, last_sync_error
       FROM cloud_connection_state
       WHERE id = 1`,
    )
    .get() as CloudConnectionRow;
}

function updateConnectionRow(patch: Partial<CloudConnectionRow>) {
  const current = getConnectionRow();
  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE cloud_connection_state
     SET cloud_base_url = ?,
         cloud_user_id = ?,
         cloud_username = ?,
         cloud_email = ?,
         access_token = ?,
         pending_device_code = ?,
         pending_user_code = ?,
         pending_verification_uri = ?,
         pending_provider = ?,
         pending_expires_at = ?,
         connected_at = ?,
         last_sync_at = ?,
         last_sync_state = ?,
         last_sync_error = ?
     WHERE id = 1`,
  ).run(
    next.cloud_base_url,
    next.cloud_user_id,
    next.cloud_username,
    next.cloud_email,
    next.access_token,
    next.pending_device_code,
    next.pending_user_code,
    next.pending_verification_uri,
    next.pending_provider,
    next.pending_expires_at,
    next.connected_at,
    next.last_sync_at,
    next.last_sync_state,
    next.last_sync_error,
  );
}

function getLocalSocialSettingsRow(): LocalSocialSettingsRow | undefined {
  return db
    .prepare(
      `SELECT habits_visibility, predictions_visibility, gold_visibility
       FROM local_social_settings
       WHERE id = 1`,
    )
    .get() as LocalSocialSettingsRow | undefined;
}

function connectedUserFromRow(row: CloudConnectionRow): CloudIdentityUser | null {
  if (!row.cloud_user_id || !row.cloud_username) return null;
  return {
    id: row.cloud_user_id,
    username: row.cloud_username,
    email: row.cloud_email,
    createdAt: row.connected_at ?? new Date(0).toISOString(),
  };
}

function pendingAuthFromRow(row: CloudConnectionRow) {
  if (
    !row.pending_verification_uri ||
    !row.pending_expires_at ||
    !row.pending_provider ||
    new Date(row.pending_expires_at).getTime() <= Date.now()
  ) {
    return null;
  }
  return {
    provider: row.pending_provider,
    authorizationUrl: row.pending_verification_uri,
    expiresAt: row.pending_expires_at,
    intervalSeconds: 2,
  };
}

async function requestCloud<T>(path: string, init?: RequestInit) {
  const baseUrl = configuredCloudBaseUrl();
  if (!baseUrl) {
    throw new Error("cloud social service is not configured");
  }
  const row = getConnectionRow();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Authorization") && row.access_token) {
    headers.set("Authorization", `Bearer ${row.access_token}`);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function setSyncState(state: CloudConnectionStatus["lastSyncState"], error: string | null, syncedAt?: string | null) {
  updateConnectionRow({
    last_sync_state: state,
    last_sync_error: error,
    last_sync_at: syncedAt === undefined ? getConnectionRow().last_sync_at : syncedAt,
  });
}

export function isCloudSyncReady() {
  const row = getConnectionRow();
  return !!configuredCloudBaseUrl() && !!row.access_token;
}

export function getLocalSocialSettings(): SocialSettings {
  const row = getLocalSocialSettingsRow();
  if (!row) {
    return DEFAULT_SOCIAL_SETTINGS;
  }
  return {
    habitsVisibility: row.habits_visibility,
    predictionsVisibility: row.predictions_visibility,
    goldVisibility: row.gold_visibility,
  };
}

export function saveLocalSocialSettings(settings: SocialSettings) {
  const parsed = socialSettingsSchema.parse(settings);
  db.prepare(
    `UPDATE local_social_settings
     SET habits_visibility = ?, predictions_visibility = ?, gold_visibility = ?, updated_at = ?
     WHERE id = 1`,
  ).run(parsed.habitsVisibility, parsed.predictionsVisibility, parsed.goldVisibility, new Date().toISOString());
  return parsed;
}

export function buildLocalSocialSnapshot(): SocialSnapshot {
  const now = new Date().toISOString();
  const state = getAccountabilityState();
  return socialSnapshotSchema.parse({
    settings: getLocalSocialSettings(),
    habits: state.habits.filter((h) => h.visibility !== "private"),
    predictions: state.predictions.filter((p) => p.visibility !== "private"),
    gold: getGoldState(),
    sourceUpdatedAt: now,
  });
}

export function getCloudConnectionStatus(): CloudConnectionStatus {
  const configured = configuredCloudBaseUrl();
  const row = getConnectionRow();
  const status = {
    configured: !!configured,
    connected: !!configured && !!row.access_token && !!row.cloud_user_id,
    cloudBaseUrl: configured,
    user: configured ? connectedUserFromRow(row) : null,
    pendingAuth: configured ? pendingAuthFromRow(row) : null,
    lastSyncAt: row.last_sync_at,
    lastSyncState: row.last_sync_state,
    lastSyncError: row.last_sync_error,
  };
  return cloudConnectionStatusSchema.parse(status);
}

export async function startCloudConnection(provider: string) {
  const parsed = cloudDeviceStartRequestSchema.parse({ provider });
  const response = cloudDeviceStartResponseSchema.parse(
    await requestCloud(
      parsed.provider === "google" ? "/api/oauth/google/start" : "/api/device/start",
      parsed.provider === "google"
        ? {
            method: "POST",
            headers: { Authorization: "" },
          }
        : {
            method: "POST",
            body: JSON.stringify(parsed),
            headers: { Authorization: "" },
          },
    ),
  );
  updateConnectionRow({
    cloud_base_url: configuredCloudBaseUrl(),
    pending_device_code: response.deviceCode,
    pending_user_code: null,
    pending_verification_uri: response.authorizationUrl,
    pending_provider: response.provider,
    pending_expires_at: response.expiresAt,
    last_sync_state: "idle",
    last_sync_error: null,
  });
  return getCloudConnectionStatus();
}

export async function pollCloudConnection() {
  const row = getConnectionRow();
  if (!row.pending_device_code) {
    return getCloudConnectionStatus();
  }
  const response = cloudDevicePollResponseSchema.parse(
    await requestCloud("/api/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode: row.pending_device_code }),
      headers: { Authorization: "" },
    }),
  );
  if (response.status === "approved") {
    updateConnectionRow({
      access_token: response.accessToken,
      cloud_user_id: response.user.id,
      cloud_username: response.user.username,
      cloud_email: response.user.email,
      connected_at: new Date().toISOString(),
      pending_device_code: null,
      pending_user_code: null,
      pending_verification_uri: null,
      pending_provider: null,
      pending_expires_at: null,
    });
    await syncCloudSnapshot();
  } else if (response.status === "expired") {
    updateConnectionRow({
      pending_device_code: null,
      pending_user_code: null,
      pending_verification_uri: null,
      pending_provider: null,
      pending_expires_at: null,
    });
  }
  return getCloudConnectionStatus();
}

export async function updateCloudUsername(username: string) {
  const parsed = cloudUsernameUpdateRequestSchema.parse({ username });
  const payload = await requestCloud<{ user: CloudIdentityUser }>("/api/me/username", {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
  updateConnectionRow({
    cloud_user_id: payload.user.id,
    cloud_username: payload.user.username,
    cloud_email: payload.user.email,
  });
  return getCloudConnectionStatus();
}

export async function disconnectCloudConnection() {
  const row = getConnectionRow();
  if (row.access_token) {
    try {
      await requestCloud("/api/signout", { method: "POST" });
    } catch {
      // Best effort for remote token cleanup.
    }
  }
  updateConnectionRow({
    cloud_base_url: configuredCloudBaseUrl(),
    cloud_user_id: null,
    cloud_username: null,
    cloud_email: null,
    access_token: null,
    pending_device_code: null,
    pending_user_code: null,
    pending_verification_uri: null,
    pending_provider: null,
    pending_expires_at: null,
    connected_at: null,
    last_sync_at: null,
    last_sync_state: "idle",
    last_sync_error: null,
  });
  return getCloudConnectionStatus();
}

export async function syncCloudSnapshot() {
  const row = getConnectionRow();
  if (!configuredCloudBaseUrl()) {
    throw new Error("cloud social service is not configured");
  }
  if (!row.access_token) {
    throw new Error("cloud social account is not connected");
  }
  const snapshot = buildLocalSocialSnapshot();
  setSyncState("pending", null);
  try {
    await requestCloud("/api/social/settings", {
      method: "PUT",
      body: JSON.stringify(snapshot.settings),
    });
    const response = cloudSyncResponseSchema.parse(
      await requestCloud("/api/social/snapshot", {
        method: "PUT",
        body: JSON.stringify(snapshot),
      }),
    );
    setSyncState("success", null, response.syncedAt);
    return response;
  } catch (error) {
    setSyncState("error", error instanceof Error ? error.message : "sync failed");
    throw error;
  }
}

export async function saveAndSyncLocalSocialSettings(settings: SocialSettings) {
  const saved = saveLocalSocialSettings(settings);
  const status = getCloudConnectionStatus();
  if (status.connected) {
    await syncCloudSnapshot();
  }
  return saved;
}

export async function searchCloudUsers(query: string) {
  const payload = await requestCloud<{ items: FriendSearchResult[] }>(`/api/social/users?q=${encodeURIComponent(query)}`);
  return { items: friendSearchResultSchema.array().parse(payload.items) };
}

export async function listCloudFriends() {
  const payload = await requestCloud<{ items: FriendSummary[] }>("/api/social/friends");
  return { items: friendSummarySchema.array().parse(payload.items) };
}

export async function listCloudFriendRequests() {
  const payload = await requestCloud<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/api/social/friend-requests");
  return {
    incoming: friendRequestSchema.array().parse(payload.incoming),
    outgoing: friendRequestSchema.array().parse(payload.outgoing),
  };
}

export async function sendCloudFriendRequest(username: string) {
  return friendRequestSchema.parse(
    await requestCloud("/api/social/friend-requests", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  );
}

export async function acceptCloudFriendRequest(requestId: string) {
  return friendRequestSchema.parse(await requestCloud(`/api/social/friend-requests/${requestId}/accept`, { method: "POST" }));
}

export async function declineCloudFriendRequest(requestId: string) {
  return friendRequestSchema.parse(await requestCloud(`/api/social/friend-requests/${requestId}/decline`, { method: "POST" }));
}

export async function cancelCloudFriendRequest(requestId: string) {
  return friendRequestSchema.parse(await requestCloud(`/api/social/friend-requests/${requestId}`, { method: "DELETE" }));
}

export async function removeCloudFriend(friendUserId: string) {
  return (await requestCloud(`/api/social/friends/${friendUserId}`, { method: "DELETE" })) as { success: boolean };
}

export async function getCloudSharedProfile(username: string) {
  return sharedProfileSchema.parse(await requestCloud<SharedProfile>(`/api/social/users/${encodeURIComponent(username)}`));
}

// ---------------------------------------------------------------------------
// Vault (E2E encrypted full-data sync)
// ---------------------------------------------------------------------------

export async function getVaultVersion(): Promise<VaultVersionResponse> {
  return vaultVersionResponseSchema.parse(await requestCloud<VaultVersionResponse>("/api/vault/version"));
}

export async function pullVault(): Promise<VaultPullResponse> {
  return vaultPullResponseSchema.parse(await requestCloud<VaultPullResponse>("/api/vault/pull"));
}

export async function pushVault(request: VaultPushRequest): Promise<VaultPushResponse> {
  return vaultPushResponseSchema.parse(
    await requestCloud<VaultPushResponse>("/api/vault/push", {
      method: "PUT",
      body: JSON.stringify(request),
    }),
  );
}
