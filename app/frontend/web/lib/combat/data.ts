/**
 * The combat data layer — the single seam between the game and the rest of
 * SlayTheList.
 *
 * Gold is REAL: it reads and spends the same gold balance as the todo app, via
 * the existing `/api/gold-*` endpoints. If the local API isn't running (e.g.
 * you booted just the game via `dev:combat`), it transparently falls back to a
 * localStorage "practice wallet" so the game is still fully playable in
 * isolation — no backend required for clean testing.
 *
 * Progression (owned cards, current deck, defeated opponents) is persisted in
 * localStorage for now. Moving it server-side later is a drop-in change behind
 * this module — nothing else in the game imports fetch or localStorage.
 */
import type { CardId } from "@slaythelist/combat-engine";
import { STARTER_DECK } from "./cards";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";
const PROGRESS_KEY = "slaythelist.combat.progress.v1";
const WALLET_KEY = "slaythelist.combat.practiceWallet.v1";
const EMERALD_WALLET_KEY = "slaythelist.combat.practiceEmeralds.v1";
const PRACTICE_START = 120;

export interface CombatProgress {
  ownedCardIds: CardId[];
  deckCardIds: CardId[];
  defeatedOpponentIds: string[];
  /** Earned achievement badge ids. */
  badges: string[];
  /** True while gold is coming from the local practice wallet, not the app. */
  usingPracticeWallet: boolean;
}

// ---------------------------------------------------------------------------
// Gold — real SlayTheList balance, with a localStorage fallback.
// ---------------------------------------------------------------------------

let practiceMode = false;

function readWallet(): number {
  if (typeof window === "undefined") return PRACTICE_START;
  const raw = window.localStorage.getItem(WALLET_KEY);
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : PRACTICE_START;
}

function writeWallet(value: number): number {
  const next = Math.max(0, Math.round(value));
  if (typeof window !== "undefined") window.localStorage.setItem(WALLET_KEY, String(next));
  return next;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    // Fail fast when the API isn't up so we drop to practice mode quickly.
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export async function getGold(): Promise<number> {
  try {
    const state = await api<{ gold: number }>("/api/gold-state");
    practiceMode = false;
    return state.gold;
  } catch {
    practiceMode = true;
    return readWallet();
  }
}

export async function spendGold(amount: number): Promise<number> {
  if (!practiceMode) {
    try {
      const state = await api<{ gold: number }>("/api/gold/deduct", {
        method: "POST",
        body: JSON.stringify({ amount, activity: { sourceType: "spend", label: "Card purchase (Arena)" } }),
      });
      return state.gold;
    } catch {
      practiceMode = true;
    }
  }
  return writeWallet(readWallet() - amount);
}

export async function awardGold(amount: number): Promise<number> {
  if (amount <= 0) return getGold();
  if (!practiceMode) {
    try {
      const state = await api<{ gold: number }>("/api/gold/award", {
        method: "POST",
        body: JSON.stringify({ amount, withSound: true, activity: { sourceType: "manual", label: "Arena victory" } }),
      });
      return state.gold;
    } catch {
      practiceMode = true;
    }
  }
  return writeWallet(readWallet() + amount);
}

export function isPracticeMode(): boolean {
  return practiceMode;
}

/**
 * Award emeralds — the premium cosmetic currency spent in the base-builder
 * shop. Runs never mint gold (gold flows one way: todos → game), so this is
 * the run-reward channel. Falls back to a local practice counter offline.
 */
export async function awardEmeralds(amount: number): Promise<void> {
  if (amount <= 0) return;
  if (!practiceMode) {
    try {
      await api("/api/base-currencies/award", {
        method: "POST",
        body: JSON.stringify({ currency: "emeralds", amount }),
      });
      return;
    } catch {
      practiceMode = true;
    }
  }
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(EMERALD_WALLET_KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10) || 0;
    window.localStorage.setItem(EMERALD_WALLET_KEY, String(n + amount));
  }
}

// ---------------------------------------------------------------------------
// Progression — localStorage.
// ---------------------------------------------------------------------------

function defaultProgress(): CombatProgress {
  return {
    ownedCardIds: [...STARTER_DECK],
    deckCardIds: [...STARTER_DECK],
    defeatedOpponentIds: [],
    badges: [],
    usingPracticeWallet: practiceMode,
  };
}

export function loadProgress(): CombatProgress {
  if (typeof window === "undefined") return defaultProgress();
  const raw = window.localStorage.getItem(PROGRESS_KEY);
  if (!raw) return defaultProgress();
  try {
    const parsed = JSON.parse(raw) as Partial<CombatProgress>;
    return {
      ownedCardIds: parsed.ownedCardIds ?? [...STARTER_DECK],
      deckCardIds: parsed.deckCardIds ?? [...STARTER_DECK],
      defeatedOpponentIds: parsed.defeatedOpponentIds ?? [],
      badges: parsed.badges ?? [],
      usingPracticeWallet: practiceMode,
    };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(progress: CombatProgress): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

/** Reset all progression + practice wallet — handy while iterating. */
export function resetProgress(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROGRESS_KEY);
  window.localStorage.removeItem(WALLET_KEY);
}
