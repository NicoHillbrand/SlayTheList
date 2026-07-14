"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PARAMS } from "@slaythelist/defense-engine";
import { LaneTheater } from "./LaneTheater";
import { fetchDefense, type DefenseSnapshot } from "../../lib/defense/data";
import { battleMath, clamp, laneVisuals } from "../../lib/defense/math";
import styles from "./base.module.css";

const P = DEFAULT_PARAMS;
const POLL_MS = 15_000;

/** Chromeless mini view of the user's own base (the lane defense) — polls the
 *  local API and renders the tier strip, HP bar, and battle theater. Used by
 *  the /base/overlay route and the overlay taskbar's Base dropdown. */
export function BaseOverlayMini() {
  const [snap, setSnap] = useState<DefenseSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await fetchDefense(false);
        if (!cancelled) setSnap(next);
      } catch {
        // API not up yet — keep polling.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!snap) {
    return (
      <div style={{ minHeight: 120, display: "grid", placeItems: "center" }}>
        <span style={{ color: "#8a89a6", fontSize: 12 }}>Scouting the lane…</span>
      </div>
    );
  }

  const { state } = snap;
  const math = battleMath(state);
  const { frontPct, reclaiming, monsterCount } = laneVisuals(state, math.adv);
  const hpPct = clamp((state.baseHp / P.hpMax) * 100, 0, 100);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 11 }}>
        <span style={{ color: "#f5c542", fontWeight: 600, whiteSpace: "nowrap" }}>
          Tier {state.tier}
          {state.meta.bestTier > state.tier ? ` · best ${state.meta.bestTier}` : ""}
        </span>
        <div className={styles.hpTrack} style={{ flex: 1 }}>
          <div className={styles.hpFill} style={{ width: `${hpPct}%` }} />
        </div>
        <span style={{ color: math.adv < 0 ? "#e46a6a" : "#7fd88f", whiteSpace: "nowrap" }}>
          {Math.floor(state.baseHp).toLocaleString()} HP
        </span>
      </div>
      <LaneTheater
        tier={state.tier}
        slotLevels={state.slots.map((s) => s.level)}
        frontPct={frontPct}
        bleeding={math.adv < 0}
        killRate={math.killRate}
        monsterCount={monsterCount}
        reclaiming={reclaiming}
      />
    </div>
  );
}
