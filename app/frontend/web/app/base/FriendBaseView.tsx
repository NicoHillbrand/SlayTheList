"use client";

/**
 * Read-only view of someone else's lane defense, rendered from the shared
 * social snapshot. No sim loop and no controls — the state is shown as of the
 * owner's last cloud sync; only the theater animation runs.
 */
import { DEFAULT_PARAMS, slotDps, type DefenseState } from "@slaythelist/defense-engine";
import type { SharedBase } from "@slaythelist/contracts";
import { battleMath, clamp, fmtDps, laneVisuals } from "../../lib/defense/math";
import { LaneTheater } from "./LaneTheater";
import styles from "./base.module.css";

const P = DEFAULT_PARAMS;

function syncedAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function FriendBaseView({ base }: { base: SharedBase }) {
  // The shared state mirrors DefenseState with widened number types.
  const state = base.state as DefenseState;
  const math = battleMath(state);
  const { frontPct, reclaiming, monsterCount } = laneVisuals(state, math.adv);
  const hpPct = clamp((state.baseHp / P.hpMax) * 100, 0, 100);
  const killPct = clamp((state.kills / P.killsPerTier) * 100, 0, 100);

  return (
    <div>
      <section className={`${styles.statusCard} ${styles[math.status]}`}>
        <div className={styles.statusLine}>
          Tier {state.tier}
          {state.meta.bestTier > state.tier ? ` · best ${state.meta.bestTier}` : ""}
          {state.meta.runsLost > 0 ? ` · overrun ×${state.meta.runsLost}` : ""}
        </div>
        <div className={styles.forecast}>{math.statusLine}</div>
        <div className={styles.hpRow}>
          <span className={styles.hpLabel}>Base</span>
          <div className={styles.hpTrack}>
            <div className={styles.hpFill} style={{ width: `${hpPct}%` }} />
          </div>
          <span className={styles.hpValue}>
            {Math.floor(state.baseHp).toLocaleString()}/{P.hpMax.toLocaleString()}
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

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
          fontSize: 12,
          color: "#9a9ab8",
        }}
      >
        {state.slots.map((slot, i) => (
          <span
            key={i}
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(30, 30, 58, 0.8)",
              border: "1px solid #333",
            }}
          >
            Tower {i + 1} · lv {slot.level} · {fmtDps(slotDps(slot.level, P))}dps
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>synced {syncedAgo(base.updatedAt)}</span>
      </div>
    </div>
  );
}
