import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

export function createOpaqueToken() {
  return randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createDeviceCode() {
  return createOpaqueToken();
}

export function createUserCode() {
  let output = "";
  for (let index = 0; index < 6; index += 1) {
    output += USER_CODE_ALPHABET[Math.floor(Math.random() * USER_CODE_ALPHABET.length)];
  }
  return output;
}

export function parseBearerToken(headerValue: string | undefined) {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token.trim() || undefined;
}

export function isValidUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(username.trim());
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function getPublicCloudSocialUrl() {
  return requireEnv("PUBLIC_CLOUD_SOCIAL_URL");
}

export function getGoogleOAuthClient() {
  return new OAuth2Client(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    `${getPublicCloudSocialUrl()}/api/oauth/google/callback`,
  );
}

export function buildGoogleAuthorizationUrl(state: string) {
  return getGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "profile"],
    state,
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  const idToken = tokens.id_token;
  if (!idToken) {
    throw new Error("google oauth response did not include an id_token");
  }
  const ticket = await client.verifyIdToken({
    idToken,
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("google oauth response did not include the required identity fields");
  }
  if (payload.email_verified === false) {
    throw new Error("google account email must be verified");
  }
  return {
    provider: "google",
    providerSubject: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
  };
}
