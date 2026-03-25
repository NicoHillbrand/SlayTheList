import { randomUUID } from "node:crypto";
import type {
  CloudDevicePollResponse,
  CloudDeviceStartResponse,
  CloudIdentityUser,
  FriendRelationship,
  FriendRequest,
  FriendRequestStatus,
  FriendSearchResult,
  FriendSummary,
  GoldState,
  SessionUser,
  SharedProfile,
  SocialSettings,
  SocialSnapshot,
} from "@slaythelist/contracts";
import { db } from "./db.js";
import {
  buildGoogleAuthorizationUrl,
  createDeviceCode,
  createOpaqueToken,
  createUserCode,
  exchangeGoogleCode,
  hashOpaqueToken,
  isValidUsername,
  normalizeValue,
} from "./auth.js";

type UserRow = {
  id: string;
  username: string;
  username_normalized: string;
  email: string | null;
  created_at: string;
  updated_at: string;
};

type OauthIdentityRow = {
  id: string;
  cloud_user_id: string;
  provider: string;
  provider_subject: string;
  email: string | null;
  created_at: string;
};

type DeviceAuthRow = {
  device_code: string;
  provider: string;
  status: "pending" | "approved" | "exchanged" | "expired";
  cloud_user_id: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
};

type SocialSettingsRow = {
  habits_visibility: SocialSettings["habitsVisibility"];
  predictions_visibility: SocialSettings["predictionsVisibility"];
  gold_visibility: SocialSettings["goldVisibility"];
};

type SnapshotRow = {
  habits_json: string;
  predictions_json: string;
  gold_json: string;
  source_updated_at: string;
  synced_at: string;
};

type FriendRequestRow = {
  id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: FriendRequestStatus;
  created_at: string;
  responded_at: string | null;
};

const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  habitsVisibility: "friends",
  predictionsVisibility: "friends",
  goldVisibility: "friends",
};

function toCloudUser(row: UserRow): CloudIdentityUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
  };
}

function toFriendSummary(row: Pick<UserRow, "id" | "username" | "created_at">): FriendSummary {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  };
}

function getUserRowById(userId: string) {
  return db.prepare("SELECT * FROM cloud_users WHERE id = ?").get(userId) as UserRow | undefined;
}

function getUserRowByUsername(username: string) {
  return db
    .prepare("SELECT * FROM cloud_users WHERE username_normalized = ?")
    .get(normalizeValue(username)) as UserRow | undefined;
}

function getIdentityByProviderSubject(provider: string, subject: string) {
  return db
    .prepare("SELECT * FROM oauth_identities WHERE provider = ? AND provider_subject = ?")
    .get(provider, subject) as OauthIdentityRow | undefined;
}

function pairUsers(userAId: string, userBId: string) {
  return userAId < userBId ? [userAId, userBId] as const : [userBId, userAId] as const;
}

function safeParseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseGoldState(value: string): GoldState {
  try {
    const parsed = JSON.parse(value) as GoldState;
    return {
      gold: Math.max(0, Number(parsed.gold ?? 0) || 0),
      rewardedTodoIds: Array.isArray(parsed.rewardedTodoIds)
        ? parsed.rewardedTodoIds.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return { gold: 0, rewardedTodoIds: [] };
  }
}

function ensureUserSocialRows(userId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_social_settings (user_id, habits_visibility, predictions_visibility, gold_visibility, updated_at)
     VALUES (?, 'friends', 'friends', 'friends', ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now);
  db.prepare(
    `INSERT INTO user_social_snapshots (user_id, habits_json, predictions_json, gold_json, source_updated_at, synced_at)
     VALUES (?, '[]', '[]', '{"gold":0,"rewardedTodoIds":[]}', ?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now, now);
}

function usernameSeedFromEmail(email: string) {
  const [localPart] = email.split("@", 1);
  const normalized = localPart
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const fallback = normalized || "user";
  const clipped = fallback.slice(0, 24);
  if (clipped.length >= 3) {
    return clipped;
  }
  return `${clipped}${"user".slice(0, 3 - clipped.length)}`;
}

function buildAvailableUsername(email: string) {
  const base = usernameSeedFromEmail(email);
  let candidate = base;
  let suffix = 1;
  while (getUserRowByUsername(candidate)) {
    const suffixText = String(suffix);
    candidate = `${base.slice(0, Math.max(3, 24 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function createCloudUser(input: { username: string; email: string | null }) {
  if (!isValidUsername(input.username)) {
    throw new Error("username must be 3-24 characters using letters, numbers, or underscores");
  }
  const now = new Date().toISOString();
  const row: UserRow = {
    id: randomUUID(),
    username: input.username.trim(),
    username_normalized: normalizeValue(input.username),
    email: input.email?.trim() ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO cloud_users (id, username, username_normalized, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.username, row.username_normalized, row.email, row.created_at, row.updated_at);
  ensureUserSocialRows(row.id);
  return toCloudUser(row);
}

function createOrLookupIdentity(input: { provider: string; providerSubject: string; email: string }) {
  const existingIdentity = getIdentityByProviderSubject(input.provider, input.providerSubject);
  if (existingIdentity) {
    const existingUser = getUserRowById(existingIdentity.cloud_user_id);
    if (!existingUser) {
      throw new Error("identity references a missing user");
    }
    return toCloudUser(existingUser);
  }

  const user = createCloudUser({ username: buildAvailableUsername(input.email), email: input.email });
  db.prepare(
    `INSERT INTO oauth_identities (id, cloud_user_id, provider, provider_subject, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), user.id, input.provider, input.providerSubject, input.email, new Date().toISOString());
  return user;
}

export function startDeviceAuthorization(provider: string): CloudDeviceStartResponse {
  if (provider !== "google") {
    throw new Error(`unsupported cloud auth provider: ${provider}`);
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 10).toISOString();
  const response: CloudDeviceStartResponse = {
    deviceCode: createDeviceCode(),
    authorizationUrl: "",
    expiresAt,
    intervalSeconds: 2,
    provider,
  };
  response.authorizationUrl = buildGoogleAuthorizationUrl(response.deviceCode);
  db.prepare(
    `INSERT INTO device_auth_sessions (device_code, user_code, provider, status, cloud_user_id, created_at, expires_at, approved_at)
     VALUES (?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
  ).run(response.deviceCode, createUserCode(), response.provider, now.toISOString(), response.expiresAt);
  return response;
}

export async function completeGoogleAuthorization(input: { state: string; code: string }) {
  const row = db
    .prepare("SELECT * FROM device_auth_sessions WHERE device_code = ? LIMIT 1")
    .get(input.state) as DeviceAuthRow | undefined;
  if (!row) {
    throw new Error("device authorization not found");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("UPDATE device_auth_sessions SET status = 'expired' WHERE device_code = ?").run(row.device_code);
    throw new Error("device authorization expired");
  }
  if (row.status !== "pending") {
    throw new Error("device authorization already completed");
  }
  const googleIdentity = await exchangeGoogleCode(input.code);
  const user = createOrLookupIdentity({
    provider: googleIdentity.provider,
    providerSubject: googleIdentity.providerSubject,
    email: googleIdentity.email,
  });
  db.prepare(
    `UPDATE device_auth_sessions
     SET status = 'approved', cloud_user_id = ?, approved_at = ?
     WHERE device_code = ?`,
  ).run(user.id, new Date().toISOString(), row.device_code);
  return user;
}

export function pollDeviceAuthorization(deviceCode: string): CloudDevicePollResponse {
  const row = db.prepare("SELECT * FROM device_auth_sessions WHERE device_code = ?").get(deviceCode) as DeviceAuthRow | undefined;
  if (!row) {
    return { status: "expired" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("UPDATE device_auth_sessions SET status = 'expired' WHERE device_code = ?").run(deviceCode);
    return { status: "expired" };
  }
  if (row.status !== "approved" || !row.cloud_user_id) {
    return { status: "pending" };
  }

  const user = getUserRowById(row.cloud_user_id);
  if (!user) {
    return { status: "expired" };
  }

  const accessToken = createOpaqueToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  db.prepare(
    `INSERT INTO access_tokens (token_hash, cloud_user_id, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hashOpaqueToken(accessToken), user.id, now, expiresAt, now);
  db.prepare("UPDATE device_auth_sessions SET status = 'exchanged' WHERE device_code = ?").run(deviceCode);
  return {
    status: "approved",
    accessToken,
    user: toCloudUser(user),
  };
}

export function getCloudUserByAccessToken(token: string): CloudIdentityUser | undefined {
  const row = db
    .prepare(
      `SELECT cloud_users.*
       FROM access_tokens
       INNER JOIN cloud_users ON cloud_users.id = access_tokens.cloud_user_id
       WHERE access_tokens.token_hash = ?
         AND access_tokens.expires_at > ?
       LIMIT 1`,
    )
    .get(hashOpaqueToken(token), new Date().toISOString()) as UserRow | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE access_tokens SET last_used_at = ? WHERE token_hash = ?").run(new Date().toISOString(), hashOpaqueToken(token));
  return toCloudUser(row);
}

export function revokeAccessToken(token: string) {
  db.prepare("DELETE FROM access_tokens WHERE token_hash = ?").run(hashOpaqueToken(token));
}

export function updateCloudUsername(userId: string, username: string) {
  const trimmed = username.trim();
  if (!isValidUsername(trimmed)) {
    throw new Error("username must be 3-24 characters using letters, numbers, or underscores");
  }
  const current = getUserRowById(userId);
  if (!current) {
    throw new Error("user not found");
  }
  const existing = getUserRowByUsername(trimmed);
  if (existing && existing.id !== userId) {
    throw new Error("username is already taken");
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE cloud_users
     SET username = ?, username_normalized = ?, updated_at = ?
     WHERE id = ?`,
  ).run(trimmed, normalizeValue(trimmed), updatedAt, userId);
  return toCloudUser({
    ...current,
    username: trimmed,
    username_normalized: normalizeValue(trimmed),
    updated_at: updatedAt,
  });
}

export function getSocialSettings(userId: string): SocialSettings {
  ensureUserSocialRows(userId);
  const row = db
    .prepare(
      `SELECT habits_visibility, predictions_visibility, gold_visibility
       FROM user_social_settings
       WHERE user_id = ?`,
    )
    .get(userId) as SocialSettingsRow | undefined;
  if (!row) return DEFAULT_SOCIAL_SETTINGS;
  return {
    habitsVisibility: row.habits_visibility,
    predictionsVisibility: row.predictions_visibility,
    goldVisibility: row.gold_visibility,
  };
}

export function saveSocialSettings(userId: string, settings: SocialSettings) {
  ensureUserSocialRows(userId);
  db.prepare(
    `UPDATE user_social_settings
     SET habits_visibility = ?,
         predictions_visibility = ?,
         gold_visibility = ?,
         updated_at = ?
     WHERE user_id = ?`,
  ).run(
    settings.habitsVisibility,
    settings.predictionsVisibility,
    settings.goldVisibility,
    new Date().toISOString(),
    userId,
  );
  return settings;
}

export function saveSocialSnapshot(userId: string, snapshot: SocialSnapshot) {
  ensureUserSocialRows(userId);
  const syncedAt = new Date().toISOString();
  db.prepare(
    `UPDATE user_social_snapshots
     SET habits_json = ?,
         predictions_json = ?,
         gold_json = ?,
         source_updated_at = ?,
         synced_at = ?
     WHERE user_id = ?`,
  ).run(
    JSON.stringify(snapshot.habits),
    JSON.stringify(snapshot.predictions),
    JSON.stringify(snapshot.gold),
    snapshot.sourceUpdatedAt,
    syncedAt,
    userId,
  );
  return {
    ...snapshot,
    syncedAt,
  } satisfies SocialSnapshot;
}

function getSnapshot(userId: string): SocialSnapshot {
  ensureUserSocialRows(userId);
  const row = db
    .prepare(
      `SELECT habits_json, predictions_json, gold_json, source_updated_at, synced_at
       FROM user_social_snapshots
       WHERE user_id = ?`,
    )
    .get(userId) as SnapshotRow | undefined;
  if (!row) {
    const now = new Date().toISOString();
    return {
      settings: getSocialSettings(userId),
      habits: [],
      predictions: [],
      gold: { gold: 0, rewardedTodoIds: [] },
      sourceUpdatedAt: now,
      syncedAt: now,
    };
  }
  return {
    settings: getSocialSettings(userId),
    habits: safeParseArray(row.habits_json),
    predictions: safeParseArray(row.predictions_json),
    gold: safeParseGoldState(row.gold_json),
    sourceUpdatedAt: row.source_updated_at,
    syncedAt: row.synced_at,
  };
}

export function listFriends(userId: string): FriendSummary[] {
  const rows = db
    .prepare(
      `SELECT cloud_users.id, cloud_users.username, cloud_users.created_at
       FROM friendships
       INNER JOIN cloud_users
         ON cloud_users.id = CASE
           WHEN friendships.user_low_id = ? THEN friendships.user_high_id
           ELSE friendships.user_low_id
         END
       WHERE friendships.user_low_id = ? OR friendships.user_high_id = ?
       ORDER BY cloud_users.username COLLATE NOCASE ASC`,
    )
    .all(userId, userId, userId) as Array<Pick<UserRow, "id" | "username" | "created_at">>;
  return rows.map(toFriendSummary);
}

function getFriendRelationship(viewerUserId: string, targetUserId: string): FriendRelationship {
  if (viewerUserId === targetUserId) return "self";
  const [lowId, highId] = pairUsers(viewerUserId, targetUserId);
  const friendship = db
    .prepare("SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ? LIMIT 1")
    .get(lowId, highId) as { 1: number } | undefined;
  if (friendship) return "friend";
  const pending = db
    .prepare(
      `SELECT sender_user_id
       FROM friend_requests
       WHERE status = 'pending'
         AND ((sender_user_id = ? AND receiver_user_id = ?)
           OR (sender_user_id = ? AND receiver_user_id = ?))
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(viewerUserId, targetUserId, targetUserId, viewerUserId) as { sender_user_id: string } | undefined;
  if (!pending) return "none";
  return pending.sender_user_id === viewerUserId ? "outgoing_request" : "incoming_request";
}

export function searchUsers(viewerUserId: string, query: string): FriendSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const rows = db
    .prepare(
      `SELECT id, username, created_at
       FROM cloud_users
       WHERE username_normalized LIKE ?
         AND id != ?
       ORDER BY username COLLATE NOCASE ASC
       LIMIT 20`,
    )
    .all(`%${normalizeValue(trimmed)}%`, viewerUserId) as Array<Pick<UserRow, "id" | "username" | "created_at">>;
  return rows.map((row) => ({
    user: toFriendSummary(row),
    relationship: getFriendRelationship(viewerUserId, row.id),
  }));
}

function getFriendRequestRowById(requestId: string) {
  return db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(requestId) as FriendRequestRow | undefined;
}

function toFriendRequest(row: FriendRequestRow): FriendRequest {
  const sender = getUserRowById(row.sender_user_id);
  const receiver = getUserRowById(row.receiver_user_id);
  if (!sender || !receiver) {
    throw new Error("friend request references a missing user");
  }
  return {
    id: row.id,
    sender: toFriendSummary(sender),
    receiver: toFriendSummary(receiver),
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

export function listFriendRequests(userId: string): { incoming: FriendRequest[]; outgoing: FriendRequest[] } {
  const incomingRows = db
    .prepare(
      `SELECT *
       FROM friend_requests
       WHERE receiver_user_id = ?
         AND status = 'pending'
       ORDER BY created_at DESC`,
    )
    .all(userId) as FriendRequestRow[];
  const outgoingRows = db
    .prepare(
      `SELECT *
       FROM friend_requests
       WHERE sender_user_id = ?
         AND status = 'pending'
       ORDER BY created_at DESC`,
    )
    .all(userId) as FriendRequestRow[];
  return {
    incoming: incomingRows.map(toFriendRequest),
    outgoing: outgoingRows.map(toFriendRequest),
  };
}

export function createFriendRequest(senderUserId: string, targetUsername: string) {
  const receiver = getUserRowByUsername(targetUsername);
  if (!receiver) throw new Error("user not found");
  if (receiver.id === senderUserId) throw new Error("you cannot friend yourself");
  const relationship = getFriendRelationship(senderUserId, receiver.id);
  if (relationship === "friend") throw new Error("you are already friends");
  if (relationship === "outgoing_request") throw new Error("friend request already sent");
  if (relationship === "incoming_request") throw new Error("this user already sent you a friend request");

  const row: FriendRequestRow = {
    id: randomUUID(),
    sender_user_id: senderUserId,
    receiver_user_id: receiver.id,
    status: "pending",
    created_at: new Date().toISOString(),
    responded_at: null,
  };
  db.prepare(
    `INSERT INTO friend_requests (id, sender_user_id, receiver_user_id, status, created_at, responded_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(row.id, row.sender_user_id, row.receiver_user_id, row.status, row.created_at);
  return toFriendRequest(row);
}

export function acceptFriendRequest(requestId: string, receiverUserId: string) {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") throw new Error("friend request not found");
  if (request.receiver_user_id !== receiverUserId) throw new Error("you cannot accept this friend request");
  const respondedAt = new Date().toISOString();
  const [lowId, highId] = pairUsers(request.sender_user_id, request.receiver_user_id);
  const tx = db.transaction(() => {
    db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?").run(respondedAt, requestId);
    db.prepare(
      `INSERT INTO friendships (user_low_id, user_high_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_low_id, user_high_id) DO NOTHING`,
    ).run(lowId, highId, respondedAt);
  });
  tx();
  return toFriendRequest({ ...request, status: "accepted", responded_at: respondedAt });
}

export function declineFriendRequest(requestId: string, receiverUserId: string) {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") throw new Error("friend request not found");
  if (request.receiver_user_id !== receiverUserId) throw new Error("you cannot decline this friend request");
  const respondedAt = new Date().toISOString();
  db.prepare("UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?").run(respondedAt, requestId);
  return toFriendRequest({ ...request, status: "declined", responded_at: respondedAt });
}

export function cancelFriendRequest(requestId: string, senderUserId: string) {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") throw new Error("friend request not found");
  if (request.sender_user_id !== senderUserId) throw new Error("you cannot cancel this friend request");
  const respondedAt = new Date().toISOString();
  db.prepare("UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE id = ?").run(respondedAt, requestId);
  return toFriendRequest({ ...request, status: "cancelled", responded_at: respondedAt });
}

function canViewerSeeSection(
  visibility: SocialSettings["habitsVisibility"],
  relationship: FriendRelationship,
  viewerUserId: string | undefined,
) {
  if (relationship === "self") return true;
  if (visibility === "private") return false;
  if (visibility === "public") return viewerUserId !== undefined;
  return relationship === "friend";
}

export function getSharedProfile(viewerUserId: string, targetUsername: string): SharedProfile {
  const target = getUserRowByUsername(targetUsername);
  if (!target) throw new Error("user not found");
  const relationship = getFriendRelationship(viewerUserId, target.id);
  const settings = getSocialSettings(target.id);
  const snapshot = getSnapshot(target.id);
  const canViewHabits = canViewerSeeSection(settings.habitsVisibility, relationship, viewerUserId);
  const canViewPredictions = canViewerSeeSection(settings.predictionsVisibility, relationship, viewerUserId);
  const canViewGold = canViewerSeeSection(settings.goldVisibility, relationship, viewerUserId);
  return {
    user: toFriendSummary(target),
    relationship,
    settings,
    habits: {
      visibility: settings.habitsVisibility,
      canView: canViewHabits,
      items: canViewHabits ? snapshot.habits : [],
    },
    predictions: {
      visibility: settings.predictionsVisibility,
      canView: canViewPredictions,
      items: canViewPredictions ? snapshot.predictions : [],
    },
    gold: {
      visibility: settings.goldVisibility,
      canView: canViewGold,
      state: canViewGold ? snapshot.gold : null,
    },
  };
}
