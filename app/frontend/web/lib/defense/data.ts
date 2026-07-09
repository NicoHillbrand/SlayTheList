/**
 * Lane defense data layer — the seam between the /defense page and the API.
 *
 * The simulation itself lives server-side (backend advances it lazily on every
 * read), so this module only fetches snapshots and posts actions. Two modes:
 *  - real (default): upgrades spend the actual SlayTheList gold balance.
 *  - sandbox: a separate parallel run with a practice wallet and playtest
 *    controls (time-skip, free gold, reset). Never touches real gold.
 */
import type { DefenseEvent, DefenseState } from "@slaythelist/defense-engine";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";

export type DefenseDeathMode = "knockback" | "reset";

export interface DefenseSnapshot {
  state: DefenseState;
  /** Spendable gold: the real balance, or the sandbox practice wallet. */
  wallet: number;
  sandbox: boolean;
  /** Collapse behaviour currently in effect (applies to real and sandbox). */
  deathMode: DefenseDeathMode;
  /** Events produced by the fast-forward that served this snapshot. */
  events: DefenseEvent[];
}

export type SandboxAction =
  | { action: "skip"; hours: number }
  | { action: "grant"; amount: number }
  | { action: "reset" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the status code
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchDefense(sandbox: boolean): Promise<DefenseSnapshot> {
  return api<DefenseSnapshot>(`/api/defense-state${sandbox ? "?sandbox=1" : ""}`);
}

export function buyUpgrade(sandbox: boolean, slotIndex: number): Promise<DefenseSnapshot> {
  return api<DefenseSnapshot>("/api/defense/upgrade", {
    method: "POST",
    body: JSON.stringify({ sandbox, slotIndex }),
  });
}

export function sandboxAction(action: SandboxAction): Promise<DefenseSnapshot> {
  return api<DefenseSnapshot>("/api/defense/sandbox", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function setDeathMode(
  deathMode: DefenseDeathMode,
  sandbox: boolean,
): Promise<DefenseSnapshot> {
  return api<DefenseSnapshot>("/api/defense/config", {
    method: "POST",
    body: JSON.stringify({ deathMode, sandbox }),
  });
}
