"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PARAMS,
  currentEnemyDps,
  killsPerHour,
  metaCostMultiplier,
  playerDps,
  slotDps,
  upgradeCost,
  type DefenseEvent,
  type DefenseState,
} from "@slaythelist/defense-engine";
import { CoinIcon } from "../../lib/combat/icons";
import { setMuted, sfx } from "../../lib/combat/sfx";
import { LaneTheater } from "./LaneTheater";
import {
  buyUpgrade,
  fetchDefense,
  sandboxAction,
  type DefenseDeathMode,
  type DefenseSnapshot,
  type SandboxAction,
} from "../../lib/defense/data";
import styles from "./defense.module.css";

const P = DEFAULT_PARAMS;
const POLL_MS = 15_000;
const MUTE_KEY = "slaythelist.defense.muted";
/** Only sound events that just happened — not stale ones from offline catch-up. */
const FRESH_EVENT_MS = 5 * 60_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function fmtDps(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1);
}

interface BattleMath {
  pd: number;
  ed: number;
  adv: number;
  killRate: number;
  hoursToTier: number;
  status: "advancing" | "attacked";
  statusLine: string;
  forecast: string;
}

function battleMath(state: DefenseState): BattleMath {
  const pd = playerDps(state, P);
  const ed = currentEnemyDps(state, P);
  const adv = pd / ed - 1;
  const reclaiming = state.tier < state.meta.bestTier;
  const killRate = killsPerHour(pd, ed, P, reclaiming);
  const hoursToTier = Math.max(0, P.killsPerTier - state.kills) / killRate;

  if (adv >= 0) {
    return {
      pd,
      ed,
      adv,
      killRate,
      hoursToTier,
      status: "advancing",
      statusLine: reclaiming
        ? "Reclaiming lost ground — you know these enemies"
        : "Ahead of the horde — they still chip the walls, but slowly",
      forecast: `Next generation in ~${fmtHours(hoursToTier)} — and they keep growing on their own`,
    };
  }
  const bleedPerHour = P.hpMax * Math.min(1, -adv) * P.damageRatePerHour;
  const drainHours = state.baseHp / bleedPerHour;
  return {
    pd,
    ed,
    adv,
    killRate,
    hoursToTier,
    status: "attacked",
    statusLine: "The horde is at the walls — the base is bleeding",
    forecast: `Base falls in ~${fmtHours(drainHours)} at this rate — upgrade to turn the tide`,
  };
}

/** Base-HP loss per second at the current power balance (always negative). */
function hpRatePerSec(state: DefenseState): number {
  const pd = playerDps(state, P);
  const ed = currentEnemyDps(state, P);
  const deficit = Math.min(1, Math.max(P.chipBleedFloor, 1 - pd / ed));
  return -(P.hpMax * deficit * P.damageRatePerHour) / 3600;
}

function eventNotice(events: DefenseEvent[], deathMode: DefenseDeathMode): string | null {
  let death: string | null = null;
  let tier: string | null = null;
  for (const e of events) {
    if (e.type === "baseDestroyed") {
      death =
        deathMode === "reset"
          ? `Overrun at tier ${e.tierReached}! The base fell — rebuilt from tier 1 on your legacy floor. Reclaiming is fast.`
          : `Overrun at tier ${e.tierReached}! Knocked back ${P.collapseTierSetback} tiers and towers weakened — your legacy floor held.`;
    } else if (e.type === "tierUp") {
      tier = `Horde cleared — a stronger generation marches now (tier ${e.tier}).`;
    }
  }
  return death ?? tier;
}

export default function DefensePage() {
  const [snap, setSnap] = useState<DefenseSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [displayHp, setDisplayHp] = useState<number | null>(null);
  const sandboxRef = useRef(false);
  const snapRef = useRef<DefenseSnapshot | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((next: DefenseSnapshot) => {
    snapRef.current = next;
    setSnap(next);
    setDisplayHp(next.state.baseHp);
    setError(null);
    const cutoff = Date.now() - FRESH_EVENT_MS;
    if (next.events.some((e) => e.type === "baseDestroyed" && e.atMs > cutoff)) {
      sfx.defeat();
    } else if (next.events.some((e) => e.type === "tierUp" && e.atMs > cutoff)) {
      sfx.fanfare();
    }
    const message = eventNotice(next.events, next.deathMode);
    if (message) {
      setNotice(message);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 8000);
    }
  }, []);

  const refresh = useCallback(
    async (useSandbox?: boolean) => {
      try {
        applySnapshot(await fetchDefense(useSandbox ?? sandboxRef.current));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reach the API");
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("sandbox") === "1";
    sandboxRef.current = fromUrl;
    setSandbox(fromUrl);
    const storedMute = window.localStorage.getItem(MUTE_KEY) === "1";
    setSoundOn(!storedMute);
    setMuted(storedMute);
    void refresh(fromUrl);

    const interval = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Live HP ticker: interpolate between polls so the bleed/repair is visible.
    const hpTicker = setInterval(() => {
      const current = snapRef.current;
      if (!current) return;
      const rate = hpRatePerSec(current.state);
      setDisplayHp((prev) =>
        prev == null ? null : Math.max(0, Math.min(P.hpMax, prev + rate / 2)),
      );
    }, 500);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      clearInterval(hpTicker);
      document.removeEventListener("visibilitychange", onVisible);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [refresh]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setMuted(!next);
    window.localStorage.setItem(MUTE_KEY, next ? "0" : "1");
    if (next) sfx.buff();
  }

  function toggleSandbox() {
    const next = !sandboxRef.current;
    sandboxRef.current = next;
    setSandbox(next);
    setSnap(null);
    const url = next ? "/defense?sandbox=1" : "/defense";
    window.history.replaceState(null, "", url);
    void refresh(next);
  }

  async function runAction(work: () => Promise<DefenseSnapshot>) {
    if (busy) return;
    setBusy(true);
    try {
      applySnapshot(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const buy = (slotIndex: number) =>
    runAction(async () => {
      const result = await buyUpgrade(sandboxRef.current, slotIndex);
      sfx.buff();
      return result;
    });
  const doSandbox = (action: SandboxAction) => runAction(() => sandboxAction(action));

  if (!snap) {
    return (
      <div className={styles.root}>
        <div className={styles.shell}>
          <div className={styles.loading}>
            {error ? `Cannot reach the battle: ${error}` : "Scouting the lane…"}
          </div>
        </div>
      </div>
    );
  }

  const { state, wallet } = snap;
  const math = battleMath(state);
  const hp = displayHp ?? state.baseHp;
  const hpPct = clamp((hp / P.hpMax) * 100, 0, 100);
  const killPct = clamp((state.kills / P.killsPerTier) * 100, 0, 100);
  const costMult = metaCostMultiplier(state.meta, P);
  // Lane geometry: the fight happens at the walls — the battle line sits just
  // past the towers and only eases outward a little as your advantage grows.
  const hordePush = clamp((math.adv + 0.15) / 0.75, 0, 1);
  const frontPct = 19.5 + hordePush * 17;
  const reclaiming = state.tier < state.meta.bestTier;
  const monsterCount = Math.min(4 + state.tier, 14) + (reclaiming ? 4 : 0);

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <a className={styles.back} href="/">
          ← Back
        </a>
        <div className={styles.brandBox}>
          <span className={styles.brand}>Lane Defense</span>
          <span className={styles.subBrand}>
            Tier {state.tier}
            {state.meta.bestTier > state.tier ? ` · best ${state.meta.bestTier}` : ""}
            {state.meta.runsLost > 0 ? ` · overrun ×${state.meta.runsLost}` : ""}
          </span>
        </div>
        <div className={styles.topRight}>
          <button type="button" className={styles.sandboxToggle} onClick={toggleSound}>
            {soundOn ? "Sound: on" : "Sound: off"}
          </button>
          <button
            type="button"
            className={`${styles.sandboxToggle} ${sandbox ? styles.sandboxOn : ""}`}
            onClick={toggleSandbox}
          >
            {sandbox ? "Sandbox: on" : "Sandbox: off"}
          </button>
          <span className={styles.goldBadge} title={sandbox ? "Practice wallet" : "Your gold"}>
            <CoinIcon size={15} />
            {Math.floor(wallet).toLocaleString()}
          </span>
        </div>
      </header>

      <div className={styles.shell}>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.errorBar}>{error}</div> : null}

        <section className={`${styles.statusCard} ${styles[math.status]}`}>
          <div className={styles.statusLine}>{math.statusLine}</div>
          <div className={styles.forecast}>{math.forecast}</div>
          <div className={styles.hpRow}>
            <span className={styles.hpLabel}>Base</span>
            <div className={styles.hpTrack}>
              <div className={styles.hpFill} style={{ width: `${hpPct}%` }} />
            </div>
            <span className={styles.hpValue}>
              {Math.floor(hp).toLocaleString()}/{P.hpMax.toLocaleString()}
            </span>
          </div>
          <div className={styles.hpRow}>
            <span className={styles.hpLabel}>Horde</span>
            <div className={styles.hpTrack}>
              <div className={styles.killFill} style={{ width: `${killPct}%` }} />
            </div>
            <span className={styles.hpValue}>
              {Math.floor(state.kills)}/{P.killsPerTier} slain
            </span>
          </div>
        </section>

        <LaneTheater
          tier={state.tier}
          slotLevels={state.slots.map((s) => s.level)}
          frontPct={frontPct}
          bleeding={math.adv < 0}
          killRate={math.killRate}
          monsterCount={monsterCount}
          reclaiming={reclaiming}
        />

        <div className={styles.panels}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Towers</h2>
            <div className={styles.slotList}>
              {state.slots.map((slot, i) => {
                const cost = upgradeCost(state, i, P);
                const affordable = wallet >= cost;
                return (
                  <div key={i} className={styles.slotRow}>
                    <span className={styles.slotName}>Tower {i + 1}</span>
                    <span className={styles.slotStats}>
                      lv {slot.level} · {fmtDps(slotDps(slot.level, P))}dps
                    </span>
                    <button
                      type="button"
                      className={styles.upgradeBtn}
                      disabled={busy || !affordable}
                      onClick={() => void buy(i)}
                    >
                      Upgrade
                      <span className={styles.cost}>
                        <CoinIcon size={12} />
                        {cost.toLocaleString()}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Battle</h2>
            <dl className={styles.statList}>
              <div className={styles.statRow}>
                <dt>Your DPS</dt>
                <dd>{fmtDps(math.pd)}</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Horde DPS (tier {state.tier})</dt>
                <dd>{fmtDps(math.ed)}</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Advantage</dt>
                <dd className={math.adv >= 0 ? styles.good : styles.bad}>
                  {math.adv >= 0 ? "+" : ""}
                  {(math.adv * 100).toFixed(0)}%
                </dd>
              </div>
              <div className={styles.statRow}>
                <dt>Base HP</dt>
                <dd className={math.adv >= 0 ? styles.good : styles.bad}>
                  −{Math.abs(hpRatePerSec(state)).toFixed(1)}/s
                </dd>
              </div>
              <div className={styles.statRow}>
                <dt>Kill rate</dt>
                <dd>{math.killRate.toFixed(1)}/h</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Monsters slain</dt>
                <dd>
                  {Math.floor(state.kills)}/{P.killsPerTier}
                </dd>
              </div>
              <div className={styles.statRow}>
                <dt>Invested this run</dt>
                <dd>{state.goldInvestedRun.toLocaleString()}g</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Legacy</h2>
            <dl className={styles.statList}>
              <div className={styles.statRow}>
                <dt>Best tier</dt>
                <dd>{state.meta.bestTier || "—"}</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Overruns</dt>
                <dd>{state.meta.runsLost}</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Upgrade discount</dt>
                <dd>{costMult < 1 ? `−${Math.round((1 - costMult) * 100)}%` : "—"}</dd>
              </div>
              <div className={styles.statRow}>
                <dt>Lifetime invested</dt>
                <dd>{state.meta.totalGoldInvested.toLocaleString()}g</dd>
              </div>
            </dl>
            <p className={styles.legacyHint}>
              {snap.deathMode === "reset"
                ? "Getting overrun wipes the base back to tier 1 — but your legacy floor sets the rebuilt towers, and tiers below your best clear at many times the pace."
                : `Getting overrun is a knockback, not a wipe: the horde pushes you back ${P.collapseTierSetback} tiers and weakens your towers — never below the floor your best tier has earned.`}{" "}
              Tiers below your best always clear fast; scaling past it never does.
            </p>
          </section>
        </div>

        {sandbox ? (
          <section className={`${styles.panel} ${styles.sandboxPanel}`}>
            <h2 className={styles.panelTitle}>Sandbox controls</h2>
            <p className={styles.sandboxHint}>
              Practice wallet and a separate battle — your real gold and real run are untouched.
            </p>
            <div className={styles.sandboxRow}>
              {[1, 6, 24, 72].map((h) => (
                <button
                  key={h}
                  type="button"
                  className={styles.sandboxBtn}
                  disabled={busy}
                  onClick={() => void doSandbox({ action: "skip", hours: h })}
                >
                  Skip {h < 24 ? `${h}h` : `${h / 24}d`}
                </button>
              ))}
              <button
                type="button"
                className={styles.sandboxBtn}
                disabled={busy}
                onClick={() => void doSandbox({ action: "grant", amount: 250 })}
              >
                +250 gold
              </button>
              <button
                type="button"
                className={`${styles.sandboxBtn} ${styles.sandboxDanger}`}
                disabled={busy}
                onClick={() => void doSandbox({ action: "reset" })}
              >
                Reset sandbox
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
