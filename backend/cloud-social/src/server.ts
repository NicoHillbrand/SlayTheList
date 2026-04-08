import cors from "cors";
import express from "express";
import {
  cloudDevicePollResponseSchema,
  cloudDeviceStartRequestSchema,
  cloudUsernameUpdateRequestSchema,
  cloudSyncResponseSchema,
  friendRequestSchema,
  friendSearchResultSchema,
  sharedProfileSchema,
  socialSettingsSchema,
  socialSnapshotSchema,
  vaultPullResponseSchema,
  vaultPushRequestSchema,
  vaultPushResponseSchema,
  vaultVersionResponseSchema,
} from "@slaythelist/contracts";
import { parseBearerToken } from "./auth.js";
import { errorLogger, requestLogger } from "./logger.js";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  removeFriend,
  completeGoogleAuthorization,
  createFriendRequest,
  declineFriendRequest,
  getCloudUserByAccessToken,
  getSharedProfile,
  getSocialSettings,
  listFriendRequests,
  listFriends,
  pollDeviceAuthorization,
  revokeAccessToken,
  saveSocialSettings,
  saveSocialSnapshot,
  searchUsers,
  startDeviceAuthorization,
  updateCloudUsername,
} from "./store.js";
import { getVaultVersion, pullVault, pushVault } from "./vault-store.js";

const port = Number(process.env.PORT ?? 8790);
const app = express();

type AuthedRequest = express.Request & {
  cloudUser?: ReturnType<typeof getCloudUserByAccessToken>;
  accessToken?: string;
};

app.set("trust proxy", 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(requestLogger);

function ok(res: express.Response, payload: unknown) {
  res.status(200).json(payload);
}

function badRequest(res: express.Response, message: string) {
  res.status(400).json({ error: message });
}

function unauthorized(res: express.Response, message = "authentication required") {
  res.status(401).json({ error: message });
}

function requireAuth(req: AuthedRequest, res: express.Response) {
  if (!req.cloudUser || !req.accessToken) {
    unauthorized(res);
    return undefined;
  }
  return req.cloudUser;
}

app.use((req, _res, next) => {
  const token = parseBearerToken(req.headers.authorization);
  if (token) {
    const cloudUser = getCloudUserByAccessToken(token);
    if (cloudUser) {
      (req as AuthedRequest).cloudUser = cloudUser;
      (req as AuthedRequest).accessToken = token;
    }
  }
  next();
});

app.get("/health", (_req, res) => {
  ok(res, { status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/device/start", (req, res) => {
  const parsed = cloudDeviceStartRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid device auth payload");
  }
  ok(res, startDeviceAuthorization(parsed.data.provider));
});

app.post("/api/oauth/google/start", (_req, res) => {
  try {
    ok(res, startDeviceAuthorization("google"));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

app.get("/api/oauth/google/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";
  if (error) {
    res.status(400).send(`<html><body><h1>Google sign-in failed</h1><p>${escapeHtml(error)}</p></body></html>`);
    return;
  }
  if (!state || !code) {
    res.status(400).send("<html><body><h1>Google sign-in failed</h1><p>Missing state or code.</p></body></html>");
    return;
  }
  try {
    const user = await completeGoogleAuthorization({ state, code });
    res.send(
      `<html><body><h1>Connected</h1><p>@${escapeHtml(user.username)} is now linked to SlayTheList cloud sync. You can close this window.</p></body></html>`,
    );
  } catch (callbackError) {
    res.status(400).send(
      `<html><body><h1>Google sign-in failed</h1><p>${escapeHtml(String((callbackError as Error).message ?? "Unknown error"))}</p></body></html>`,
    );
  }
});

app.post("/api/device/poll", (req, res) => {
  const deviceCode = typeof req.body?.deviceCode === "string" ? req.body.deviceCode.trim() : "";
  if (!deviceCode) {
    return badRequest(res, "deviceCode is required");
  }
  ok(res, cloudDevicePollResponseSchema.parse(pollDeviceAuthorization(deviceCode)));
});

app.get("/api/me", (req, res) => {
  ok(res, { user: (req as AuthedRequest).cloudUser ?? null });
});

app.patch("/api/me/username", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const parsed = cloudUsernameUpdateRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid username payload");
  }
  try {
    ok(res, { user: updateCloudUsername(user.id, parsed.data.username) });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/signout", (req, res) => {
  const token = (req as AuthedRequest).accessToken;
  if (token) {
    revokeAccessToken(token);
  }
  ok(res, { signedOut: true });
});

app.get("/api/social/settings", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  ok(res, getSocialSettings(user.id));
});

app.put("/api/social/settings", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const parsed = socialSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid social settings");
  }
  ok(res, saveSocialSettings(user.id, parsed.data));
});

app.put("/api/social/snapshot", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const parsed = socialSnapshotSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid social snapshot");
  }
  ok(
    res,
    cloudSyncResponseSchema.parse({
      syncedAt: new Date().toISOString(),
      snapshot: saveSocialSnapshot(user.id, parsed.data),
    }),
  );
});

app.get("/api/social/users", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const query = typeof req.query.q === "string" ? req.query.q : "";
  ok(res, { items: friendSearchResultSchema.array().parse(searchUsers(user.id, query)) });
});

app.get("/api/social/friends", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  ok(res, { items: listFriends(user.id) });
});

app.get("/api/social/friend-requests", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const requests = listFriendRequests(user.id);
  ok(res, {
    incoming: friendRequestSchema.array().parse(requests.incoming),
    outgoing: friendRequestSchema.array().parse(requests.outgoing),
  });
});

app.post("/api/social/friend-requests", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    return badRequest(res, "username is required");
  }
  try {
    ok(res, friendRequestSchema.parse(createFriendRequest(user.id, username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/social/friend-requests/:id/accept", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  try {
    ok(res, friendRequestSchema.parse(acceptFriendRequest(req.params.id, user.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.post("/api/social/friend-requests/:id/decline", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  try {
    ok(res, friendRequestSchema.parse(declineFriendRequest(req.params.id, user.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.delete("/api/social/friends/:friendUserId", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  try {
    removeFriend(user.id, req.params.friendUserId);
    ok(res, { success: true });
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.delete("/api/social/friend-requests/:id", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  try {
    ok(res, friendRequestSchema.parse(cancelFriendRequest(req.params.id, user.id)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

app.get("/api/social/users/:username", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  try {
    ok(res, sharedProfileSchema.parse(getSharedProfile(user.id, req.params.username)));
  } catch (error) {
    return badRequest(res, (error as Error).message);
  }
});

// ---------------------------------------------------------------------------
// Vault (E2E encrypted full-data sync)
// ---------------------------------------------------------------------------

app.get("/api/vault/version", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  ok(res, vaultVersionResponseSchema.parse(getVaultVersion(user.id)));
});

app.get("/api/vault/pull", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  ok(res, vaultPullResponseSchema.parse(pullVault(user.id)));
});

app.put("/api/vault/push", (req, res) => {
  const user = requireAuth(req as AuthedRequest, res);
  if (!user) return;
  const parsed = vaultPushRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, parsed.error.issues[0]?.message ?? "invalid vault push payload");
  }
  try {
    ok(res, vaultPushResponseSchema.parse(pushVault(user.id, parsed.data)));
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    if (err.statusCode === 409) {
      res.status(409).json({ error: err.message });
    } else {
      return badRequest(res, err.message);
    }
  }
});

app.use(errorLogger);

app.listen(port, () => {
  console.log(`[cloud-social] listening on http://localhost:${port}`);
});
