import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const PASSWORD_KEYLEN = 64;

export const SESSION_COOKIE_NAME = "slaythelist_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_KEYLEN).toString("hex");
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derivedKey = scryptSync(password, salt, PASSWORD_KEYLEN);
  const storedKeyBuffer = Buffer.from(key, "hex");
  if (storedKeyBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, storedKeyBuffer);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== name) continue;
    const rawValue = rawValueParts.join("=");
    if (!rawValue) return undefined;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return undefined;
}
