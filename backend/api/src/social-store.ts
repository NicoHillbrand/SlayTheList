import { randomUUID } from "node:crypto";
import type {
  AccountabilityState,
  FriendRelationship,
  FriendRequest,
  FriendRequestStatus,
  FriendSearchResult,
  FriendSummary,
  SessionUser,
  SharedProfile,
  SocialSettings,
  SocialVisibility,
} from "@slaythelist/contracts";
import { db } from "./db.js";
import { getAccountabilityState, getGoldState, saveAccountabilityState, saveGoldState } from "./store.js";

type UserRow = {
  id: string;
  username: string;
  username_normalized: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

type SocialSettingsRow = {
  habits_visibility: SocialVisibility;
  predictions_visibility: SocialVisibility;
  gold_visibility: SocialVisibility;
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

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

function toSessionUser(row: UserRow): SessionUser {
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

function getUserRowById(userId: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
}

function getUserRowByUsername(username: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE username_normalized = ?")
    .get(normalizeValue(username)) as UserRow | undefined;
}

function pairUsers(userAId: string, userBId: string) {
  return userAId < userBId ? [userAId, userBId] as const : [userBId, userAId] as const;
}

function ensureUserSocialRows(userId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_accountability_state (user_id, habits_json, predictions_json, reflections_json, updated_at)
     VALUES (?, '[]', '[]', '[]', ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now);
  db.prepare(
    `INSERT INTO user_gold_state (user_id, gold, rewarded_todo_ids_json, updated_at)
     VALUES (?, 0, '[]', ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now);
  db.prepare(
    `INSERT INTO user_social_settings (user_id, habits_visibility, predictions_visibility, gold_visibility, updated_at)
     VALUES (?, 'friends', 'friends', 'friends', ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, now);
}

export function createUserAccount(input: {
  username: string;
  email: string;
  passwordHash: string;
}): SessionUser {
  const username = input.username.trim();
  const email = input.email.trim();
  const usernameNormalized = normalizeValue(username);
  const emailNormalized = normalizeValue(email);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users
      (id, username, username_normalized, email, email_normalized, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, username, usernameNormalized, email, emailNormalized, input.passwordHash, now, now);
  ensureUserSocialRows(id);
  return {
    id,
    username,
    email,
    createdAt: now,
  };
}

export function findUserAuthByLogin(login: string): (SessionUser & { passwordHash: string }) | undefined {
  const normalized = normalizeValue(login);
  const row = db
    .prepare("SELECT * FROM users WHERE username_normalized = ? OR email_normalized = ? LIMIT 1")
    .get(normalized, normalized) as UserRow | undefined;
  if (!row) return undefined;
  return {
    ...toSessionUser(row),
    passwordHash: row.password_hash,
  };
}

export function findUserByUsername(username: string): SessionUser | undefined {
  const row = getUserRowByUsername(username);
  if (!row) return undefined;
  return toSessionUser(row);
}

export function getUserById(userId: string): SessionUser | undefined {
  const row = getUserRowById(userId);
  if (!row) return undefined;
  return toSessionUser(row);
}

export function createSessionRecord(userId: string, tokenHash: string, expiresAt: string) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, tokenHash, expiresAt, createdAt);
}

export function getSessionUserByTokenHash(tokenHash: string): SessionUser | undefined {
  const row = db
    .prepare(
      `SELECT users.*
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?
         AND sessions.expires_at > ?
       LIMIT 1`,
    )
    .get(tokenHash, new Date().toISOString()) as UserRow | undefined;
  return row ? toSessionUser(row) : undefined;
}

export function deleteSessionByTokenHash(tokenHash: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
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

export function saveSocialSettings(userId: string, settings: SocialSettings): SocialSettings {
  ensureUserSocialRows(userId);
  const updatedAt = new Date().toISOString();
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
    updatedAt,
    userId,
  );
  return settings;
}

export function listFriends(userId: string): FriendSummary[] {
  const rows = db
    .prepare(
      `SELECT users.id, users.username, users.created_at
       FROM friendships
       INNER JOIN users
         ON users.id = CASE
           WHEN friendships.user_low_id = ? THEN friendships.user_high_id
           ELSE friendships.user_low_id
         END
       WHERE friendships.user_low_id = ? OR friendships.user_high_id = ?
       ORDER BY users.username COLLATE NOCASE ASC`,
    )
    .all(userId, userId, userId) as Array<Pick<UserRow, "id" | "username" | "created_at">>;
  return rows.map(toFriendSummary);
}

export function getFriendRelationship(viewerUserId: string, targetUserId: string): FriendRelationship {
  if (viewerUserId === targetUserId) return "self";
  const [lowId, highId] = pairUsers(viewerUserId, targetUserId);
  const friendship = db
    .prepare("SELECT 1 FROM friendships WHERE user_low_id = ? AND user_high_id = ? LIMIT 1")
    .get(lowId, highId) as { 1: number } | undefined;
  if (friendship) return "friend";
  const pending = db
    .prepare(
      `SELECT sender_user_id, receiver_user_id
       FROM friend_requests
       WHERE status = 'pending'
         AND ((sender_user_id = ? AND receiver_user_id = ?)
           OR (sender_user_id = ? AND receiver_user_id = ?))
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(viewerUserId, targetUserId, targetUserId, viewerUserId) as
    | { sender_user_id: string; receiver_user_id: string }
    | undefined;
  if (!pending) return "none";
  return pending.sender_user_id === viewerUserId ? "outgoing_request" : "incoming_request";
}

export function searchUsers(viewerUserId: string, query: string): FriendSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const rows = db
    .prepare(
      `SELECT id, username, created_at
       FROM users
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

function getFriendRequestRowById(requestId: string): FriendRequestRow | undefined {
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

export function createFriendRequest(senderUserId: string, targetUsername: string): FriendRequest {
  const receiver = getUserRowByUsername(targetUsername);
  if (!receiver) {
    throw new Error("user not found");
  }
  if (receiver.id === senderUserId) {
    throw new Error("you cannot friend yourself");
  }
  const relationship = getFriendRelationship(senderUserId, receiver.id);
  if (relationship === "friend") {
    throw new Error("you are already friends");
  }
  if (relationship === "outgoing_request") {
    throw new Error("friend request already sent");
  }
  if (relationship === "incoming_request") {
    throw new Error("this user already sent you a friend request");
  }
  const row: FriendRequestRow = {
    id: randomUUID(),
    sender_user_id: senderUserId,
    receiver_user_id: receiver.id,
    status: "pending",
    created_at: new Date().toISOString(),
    responded_at: null,
  };
  db.prepare(
    `INSERT INTO friend_requests
      (id, sender_user_id, receiver_user_id, status, created_at, responded_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(row.id, row.sender_user_id, row.receiver_user_id, row.status, row.created_at);
  return toFriendRequest(row);
}

export function acceptFriendRequest(requestId: string, receiverUserId: string): FriendRequest {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") {
    throw new Error("friend request not found");
  }
  if (request.receiver_user_id !== receiverUserId) {
    throw new Error("you cannot accept this friend request");
  }
  const respondedAt = new Date().toISOString();
  const [lowId, highId] = pairUsers(request.sender_user_id, request.receiver_user_id);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE friend_requests
       SET status = 'accepted', responded_at = ?
       WHERE id = ?`,
    ).run(respondedAt, requestId);
    db.prepare(
      `INSERT INTO friendships (user_low_id, user_high_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_low_id, user_high_id) DO NOTHING`,
    ).run(lowId, highId, respondedAt);
  });
  tx();
  return toFriendRequest({ ...request, status: "accepted", responded_at: respondedAt });
}

export function declineFriendRequest(requestId: string, receiverUserId: string): FriendRequest {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") {
    throw new Error("friend request not found");
  }
  if (request.receiver_user_id !== receiverUserId) {
    throw new Error("you cannot decline this friend request");
  }
  const respondedAt = new Date().toISOString();
  db.prepare(
    `UPDATE friend_requests
     SET status = 'declined', responded_at = ?
     WHERE id = ?`,
  ).run(respondedAt, requestId);
  return toFriendRequest({ ...request, status: "declined", responded_at: respondedAt });
}

export function cancelFriendRequest(requestId: string, senderUserId: string): FriendRequest {
  const request = getFriendRequestRowById(requestId);
  if (!request || request.status !== "pending") {
    throw new Error("friend request not found");
  }
  if (request.sender_user_id !== senderUserId) {
    throw new Error("you cannot cancel this friend request");
  }
  const respondedAt = new Date().toISOString();
  db.prepare(
    `UPDATE friend_requests
     SET status = 'cancelled', responded_at = ?
     WHERE id = ?`,
  ).run(respondedAt, requestId);
  return toFriendRequest({ ...request, status: "cancelled", responded_at: respondedAt });
}

function canViewerSeeSection(
  visibility: SocialVisibility,
  relationship: FriendRelationship,
  viewerUserId: string | undefined,
): boolean {
  if (relationship === "self") return true;
  if (visibility === "private") return false;
  if (visibility === "public") return viewerUserId !== undefined;
  return relationship === "friend";
}

export function getSharedProfile(viewerUserId: string, targetUsername: string): SharedProfile {
  const target = getUserRowByUsername(targetUsername);
  if (!target) {
    throw new Error("user not found");
  }
  ensureUserSocialRows(target.id);
  const relationship = getFriendRelationship(viewerUserId, target.id);
  const settings = getSocialSettings(target.id);
  const accountabilityState: AccountabilityState = getAccountabilityState(target.id);
  const goldState = getGoldState(target.id);
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
      items: canViewHabits ? accountabilityState.habits : [],
    },
    predictions: {
      visibility: settings.predictionsVisibility,
      canView: canViewPredictions,
      items: canViewPredictions ? accountabilityState.predictions : [],
    },
    gold: {
      visibility: settings.goldVisibility,
      canView: canViewGold,
      state: canViewGold ? goldState : null,
    },
  };
}

export function bootstrapUserSocialStateFromLegacy(userId: string) {
  ensureUserSocialRows(userId);
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count !== 1) {
    return;
  }
  const currentAccountability = getAccountabilityState(userId);
  const currentGold = getGoldState(userId);
  const shouldCopyAccountability =
    currentAccountability.habits.length === 0 &&
    currentAccountability.predictions.length === 0 &&
    currentAccountability.reflections.length === 0;
  const shouldCopyGold = currentGold.gold === 0 && currentGold.rewardedTodoIds.length === 0;
  if (shouldCopyAccountability) {
    saveAccountabilityState(getAccountabilityState(), userId);
  }
  if (shouldCopyGold) {
    saveGoldState(getGoldState(), userId);
  }
}
