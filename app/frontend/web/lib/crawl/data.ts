/**
 * The Crawl data layer — the seam between the UI and the API.
 *
 * The run lives server-side (the engine is pure, the API owns the state and the
 * gold), so this module only posts actions and receives full snapshots. Every
 * call returns the whole snapshot, so the UI replaces state wholesale and never
 * merges — which matters because the same run is open in two windows at once
 * (the overlay panel and the /crawl page) and neither may drift.
 */
import type { CardId, CrawlEvent, CrawlState } from "@slaythelist/crawl-engine";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";

/**
 * The API's event socket. It broadcasts `overlay_state` on every mutation that
 * can move gold or todos, which is precisely what changes the run's energy,
 * locks, and momentum — so the panel listens instead of waiting for a poll.
 */
export const EVENTS_URL = `${API_BASE.replace(/^http/, "ws")}/ws`;

export interface CrawlSnapshot {
  state: CrawlState;
  /** Energy still spendable today. */
  energy: number;
  /** Today's earned gold — the full size of today's pool. */
  goldEarnedToday: number;
  /** True when a todo was completed within the momentum window. */
  momentum: boolean;
  /** Null when the player can act, otherwise why they cannot. */
  blocked: string | null;
  lock: { todoId: string; title: string; done: boolean } | null;
  events: CrawlEvent[];
}

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

export function fetchCrawl(): Promise<CrawlSnapshot> {
  return api<CrawlSnapshot>("/api/crawl");
}

export function playCard(handIndex: number): Promise<CrawlSnapshot> {
  return api<CrawlSnapshot>("/api/crawl/play", {
    method: "POST",
    body: JSON.stringify({ handIndex }),
  });
}

export function endTurn(): Promise<CrawlSnapshot> {
  return api<CrawlSnapshot>("/api/crawl/end-turn", { method: "POST" });
}

/** `cardId` null skips the reward and keeps the deck lean. */
export function chooseReward(cardId: CardId | null): Promise<CrawlSnapshot> {
  return api<CrawlSnapshot>("/api/crawl/reward", {
    method: "POST",
    body: JSON.stringify({ cardId }),
  });
}

export function restartRun(): Promise<CrawlSnapshot> {
  return api<CrawlSnapshot>("/api/crawl/restart", { method: "POST" });
}
