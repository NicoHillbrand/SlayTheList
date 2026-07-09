/**
 * Cloud API client for the mobile app.
 * Talks directly to the cloud-social server (not the local API).
 */

const CLOUD_BASE_URL = "https://slaythelist.nicohillbrand.com";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const res = await fetch(`${CLOUD_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// Auth
export async function startGoogleAuth() {
  return request<{
    deviceCode: string;
    authorizationUrl: string;
    expiresAt: string;
    intervalSeconds: number;
    provider: string;
  }>("/api/oauth/google/start", {
    method: "POST",
    headers: { Authorization: "" },
  });
}

export async function pollDeviceAuth(deviceCode: string) {
  return request<
    | { status: "pending" }
    | { status: "approved"; accessToken: string; user: { id: string; username: string; email: string | null; createdAt: string } }
    | { status: "expired" }
  >("/api/device/poll", {
    method: "POST",
    body: JSON.stringify({ deviceCode }),
    headers: { Authorization: "" },
  });
}

export async function getMe() {
  return request<{ user: { id: string; username: string; email: string | null; createdAt: string } | null }>("/api/me");
}

// Vault
export async function getVaultVersion() {
  return request<{ version: number; updatedAt: string | null }>("/api/vault/version");
}

export async function pullVault() {
  return request<{
    encryptedBlob: string | null;
    salt: string | null;
    iv: string | null;
    version: number;
    updatedAt: string | null;
  }>("/api/vault/pull");
}

export async function pushVault(data: {
  encryptedBlob: string;
  salt: string;
  iv: string;
  version: number;
}) {
  return request<{ version: number; updatedAt: string }>("/api/vault/push", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
