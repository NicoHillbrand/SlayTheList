"use client";

/**
 * LaneTheater — the decorative battle layer of /defense.
 *
 * Purely visual: a client-side skirmish loop (monsters walk in from the right,
 * trade blows at the battle line, take tower bolts, die, respawn) whose tempo
 * is loosely driven by the real sim (kill rate, advantage, tier). Nothing here
 * touches game state; the deterministic engine stays headless, so Math.random
 * is fine in this file.
 */

import { useEffect, useRef, useState } from "react";
import styles from "./defense.module.css";

interface LaneTheaterProps {
  tier: number;
  slotLevels: number[];
  /** Battle-line x in lane %, derived from power advantage. */
  frontPct: number;
  /** True while the base is taking damage (deficit). */
  bleeding: boolean;
  /** Sim kill rate (monsters/hour) — mapped to visual tempo. */
  killRate: number;
  /** Target on-screen population. */
  monsterCount: number;
  /** True while below bestTier: the reclaim sprint plays as fast carnage. */
  reclaiming: boolean;
}

type MonsterState = "walking" | "fighting" | "dying";

interface Monster {
  id: number;
  x: number;
  yJitter: number;
  scale: number;
  state: MonsterState;
  hp: number;
  hitAt: number;
  diedAt: number;
  /** Personal offset from the battle line so fighters don't stack. */
  frontOffset: number;
  speed: number;
}

interface Bolt {
  id: number;
  fromX: number;
  toX: number;
  toY: number;
  bornAt: number;
  targetId: number;
}

const TICK_MS = 130;
const BOLT_FLIGHT_MS = 220;
const DEATH_MS = 420;
const HIT_FLASH_MS = 160;
const TOWER_XS = [7, 10.4, 13.8, 17.2];

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function LaneTheater({
  tier,
  slotLevels,
  frontPct,
  bleeding,
  killRate,
  monsterCount,
  reclaiming,
}: LaneTheaterProps) {
  const monstersRef = useRef<Monster[]>([]);
  const boltsRef = useRef<Bolt[]>([]);
  const idRef = useRef(1);
  const nextFireAtRef = useRef(0);
  const nextSpawnAtRef = useRef(0);
  const wallFlashAtRef = useRef(0);
  const firingTowerRef = useRef({ index: -1, at: 0 });
  const propsRef = useRef({ frontPct, bleeding, killRate, monsterCount, reclaiming });
  propsRef.current = { frontPct, bleeding, killRate, monsterCount, reclaiming };
  const [, setFrame] = useState(0);

  useEffect(() => {
    const spawnMonster = (x: number, state: MonsterState): Monster => ({
      id: idRef.current++,
      x,
      yJitter: rand(0, 12),
      scale: rand(0.85, 1.2),
      state,
      hp: 2 + Math.floor(rand(0, 2)),
      hitAt: 0,
      diedAt: 0,
      frontOffset: rand(0.5, 7),
      speed: rand(4.5, 7.5),
    });

    // Initial fill: a skirmish already in progress, not a parade walking in.
    if (monstersRef.current.length === 0) {
      const { frontPct: fx, monsterCount: count } = propsRef.current;
      monstersRef.current = Array.from({ length: count }, (_, i) => {
        const t = i / Math.max(1, count - 1);
        const x = fx + 1 + t * (94 - fx);
        const m = spawnMonster(Math.min(96, x), "walking");
        if (m.x <= fx + m.frontOffset + 0.5) m.state = "fighting";
        return m;
      });
    }

    const interval = setInterval(() => {
      const now = performance.now();
      const {
        frontPct: fx,
        bleeding: bleed,
        killRate: kr,
        monsterCount: count,
        reclaiming: rec,
      } = propsRef.current;
      const dt = TICK_MS / 1000;
      // Visual tempo: parity kill rate (~4.5/h) → ~1×; the reclaim sprint's
      // boosted rates play as outright carnage.
      const tempo = Math.min(rec ? 7 : 2.2, Math.max(0.6, 0.7 + kr / 12));
      let monsters = monstersRef.current;
      let bolts = boltsRef.current;

      // Move walkers, settle fighters.
      for (const m of monsters) {
        if (m.state === "walking") {
          m.x -= m.speed * dt * (bleed ? 1.25 : 1);
          if (m.x <= fx + m.frontOffset) {
            m.x = fx + m.frontOffset;
            m.state = "fighting";
          }
        } else if (m.state === "fighting") {
          // The battle line follows the advantage: drift toward it.
          const target = fx + m.frontOffset;
          m.x += (target - m.x) * Math.min(1, dt * 2);
        }
      }

      // Wall flash while bleeding: fighters land hits on the keep.
      if (bleed && now >= wallFlashAtRef.current + rand(1100, 2100)) {
        if (monsters.some((m) => m.state === "fighting")) {
          wallFlashAtRef.current = now;
        }
      }

      // Towers fire: pick a fighter (or the closest walker), spawn a bolt.
      const fireEvery = (bleed ? 2200 : 1300) / tempo;
      if (now >= nextFireAtRef.current) {
        nextFireAtRef.current = now + fireEvery * rand(0.7, 1.3);
        const targets = monsters.filter((m) => m.state === "fighting");
        const pool = targets.length
          ? targets
          : monsters.filter((m) => m.state === "walking").sort((a, b) => a.x - b.x).slice(0, 3);
        const target = pool[Math.floor(rand(0, pool.length))];
        if (target) {
          const towerIndex = Math.floor(rand(0, TOWER_XS.length));
          firingTowerRef.current = { index: towerIndex, at: now };
          bolts.push({
            id: idRef.current++,
            fromX: TOWER_XS[towerIndex] + 1,
            toX: target.x + 0.5,
            toY: 40 + target.yJitter,
            bornAt: now,
            targetId: target.id,
          });
        }
      }

      // Bolt impacts.
      for (const bolt of bolts) {
        if (now - bolt.bornAt >= BOLT_FLIGHT_MS && bolt.targetId !== 0) {
          const target = monsters.find((m) => m.id === bolt.targetId);
          bolt.targetId = 0;
          if (target && target.state !== "dying") {
            target.hp -= 1;
            target.hitAt = now;
            if (target.hp <= 0) {
              target.state = "dying";
              target.diedAt = now;
            }
          }
        }
      }
      bolts = bolts.filter((b) => now - b.bornAt < BOLT_FLIGHT_MS + 60);

      // Bury the dead, keep the population topped up.
      monsters = monsters.filter((m) => m.state !== "dying" || now - m.diedAt < DEATH_MS);
      const alive = monsters.filter((m) => m.state !== "dying").length;
      if (alive < count && now >= nextSpawnAtRef.current) {
        nextSpawnAtRef.current = now + rand(400, 1600) / tempo;
        monsters.push(spawnMonster(rand(97, 103), "walking"));
      } else if (alive > count + 2) {
        const extra = monsters.find((m) => m.state !== "dying");
        if (extra) {
          extra.state = "dying";
          extra.diedAt = now;
        }
      }

      monstersRef.current = monsters;
      boltsRef.current = bolts;
      setFrame((f) => f + 1);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  const now = performance.now();
  const keepHit = bleeding && now - wallFlashAtRef.current < 220;
  const firing = firingTowerRef.current;

  return (
    <section className={styles.lane} aria-label="battle lane">
      <div className={styles.laneGround} />
      <div className={`${styles.keep} ${keepHit ? styles.keepHit : ""}`} title="Your base">
        <div className={styles.keepBody} />
      </div>
      {slotLevels.map((level, i) => (
        <div
          key={i}
          className={`${styles.tower} ${
            firing.index === i && now - firing.at < HIT_FLASH_MS ? styles.towerFiring : ""
          }`}
          style={{ left: `${TOWER_XS[i]}%` }}
          title={`Tower ${i + 1} — level ${level}`}
        >
          <div className={styles.towerBody} />
          <span className={styles.towerLevel}>{level}</span>
        </div>
      ))}
      <div
        className={`${styles.frontLine} ${bleeding ? styles.frontRetreating : styles.frontAdvancing}`}
        style={{ left: `${frontPct}%` }}
      />
      {monstersRef.current.map((m) => {
        const classes = [styles.monster];
        if (m.state === "fighting") classes.push(styles.mFighting);
        if (m.state === "dying") classes.push(styles.mDying);
        if (m.state !== "dying" && now - m.hitAt < HIT_FLASH_MS) classes.push(styles.mHit);
        return (
          <div
            key={m.id}
            className={classes.join(" ")}
            style={
              {
                left: `${m.x}%`,
                bottom: `${32 + m.yJitter}px`,
                animationDelay: `${(m.id % 7) * 0.13}s`,
                "--scale": m.scale,
              } as React.CSSProperties
            }
          />
        );
      })}
      {boltsRef.current.map((b) => (
        <div
          key={b.id}
          className={styles.bolt}
          style={
            {
              "--fromX": `${b.fromX}%`,
              "--toX": `${b.toX}%`,
              "--toBottom": `${b.toY}px`,
            } as React.CSSProperties
          }
        />
      ))}
      <div className={styles.gate}>
        <span className={styles.gateTier}>Tier {tier}</span>
      </div>
    </section>
  );
}
