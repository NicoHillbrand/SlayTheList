"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  attackIntervalMs,
  resolveBattle,
  type BattleEvent,
  type CardId,
  type Side,
  type TargetOutcome,
  type UnitState,
} from "@slaythelist/combat-engine";
import { CARD_CATALOG, FACTION_COLOR, RANGED_FACTIONS } from "./cards";
import { HeartIcon, Sigil, type SigilKind, SwordIcon } from "./icons";
import { isMuted, setMuted, sfx } from "./sfx";
import styles from "../../app/combat/combat.module.css";

interface Float {
  id: number;
  text: string;
  cls: string;
}

interface Unit {
  key: string;
  index: number;
  name: string;
  sigil: SigilKind;
  accent: string;
  ranged: boolean;
  /** ★ level for merged units (2/3); undefined for base units. */
  level?: number;
  /** ms between attacks (drives the cooldown fill bar); null = never attacks. */
  intervalMs: number | null;
  /** Bumped on every swing — restarts the cooldown bar animation. */
  attackTick: number;
  atk: number;
  maxHp: number;
  hp: number;
  shield: number;
  alive: boolean;
  anim: "" | "lunge" | "hurt" | "cast";
  floats: Float[];
}

let floatId = 0;

/** Idle gaps between events longer than this play compressed. */
const MAX_GAP_MS = 1100;

function buildUnits(deck: CardId[], prefix: string): Unit[] {
  const units: Unit[] = [];
  deck.forEach((id) => {
    const card = CARD_CATALOG[id];
    if (!card) return;
    units.push({
      key: `${prefix}-${units.length}-${id}`,
      index: units.length,
      name: card.name,
      sigil: card.sigil,
      accent: FACTION_COLOR[card.faction],
      ranged: RANGED_FACTIONS.has(card.faction),
      level: card.level,
      intervalMs: card.attackSpeed > 0 ? attackIntervalMs(card.attackSpeed) : null,
      attackTick: 0,
      atk: card.attack,
      maxHp: card.health,
      hp: card.health,
      shield: 0,
      alive: true,
      anim: "",
      floats: [],
    });
  });
  return units;
}

function fromFinal(deck: CardId[], prefix: string, finals: UnitState[]): Unit[] {
  const base = buildUnits(deck, prefix);
  return base.map((u, i) => {
    const f = finals[i];
    if (!f) return u;
    return {
      ...u,
      atk: f.attack,
      hp: Math.max(0, f.health),
      maxHp: f.maxHealth,
      shield: f.shield,
      alive: f.alive,
    };
  });
}

function withFloat(unit: Unit, text: string, cls: string): Unit {
  floatId += 1;
  const floats = [...unit.floats.slice(-2), { id: floatId, text, cls }];
  return { ...unit, floats };
}

interface BattleViewProps {
  playerDeck: CardId[];
  enemyDeck: CardId[];
  playerName: string;
  enemyName: string;
  /** Battle seed — same seed replays the same battle. */
  seed?: number;
  /** Optional sim time cap (e.g. training-dummy windows). */
  maxTimeMs?: number;
  onComplete: (winner: Side | "draw") => void;
}

export function BattleView({
  playerDeck,
  enemyDeck,
  playerName,
  enemyName,
  seed = 1,
  maxTimeMs,
  onComplete,
}: BattleViewProps) {
  const result = useMemo(
    () => resolveBattle({ cardIds: playerDeck }, { cardIds: enemyDeck }, CARD_CATALOG, seed, { maxTimeMs }),
    [playerDeck, enemyDeck, seed, maxTimeMs],
  );

  const [a, setA] = useState<Unit[]>(() => buildUnits(playerDeck, "a"));
  const [b, setB] = useState<Unit[]>(() => buildUnits(enemyDeck, "b"));
  const [finished, setFinished] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [mutedUi, setMutedUi] = useState(isMuted);

  const speedRef = useRef(1);
  const cancelledRef = useRef(false);
  const completedRef = useRef(false);
  const unitEls = useRef(new Map<string, HTMLDivElement>());
  const layerRef = useRef<HTMLDivElement>(null);

  function setSpeed(next: number) {
    speedRef.current = next;
    setSpeedState(next);
  }

  function updateUnit(side: Side, index: number, fn: (u: Unit) => Unit) {
    (side === "a" ? setA : setB)((prev) => prev.map((u) => (u.index === index ? fn(u) : u)));
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms / speedRef.current));
  }

  /** Schedule work on the playback clock; silently dropped after cancel. */
  function later(ms: number, fn: () => void) {
    window.setTimeout(() => {
      if (!cancelledRef.current) fn();
    }, ms / speedRef.current);
  }

  /** Fly a glowing orb from one unit to another (WAAPI, imperative DOM). */
  function fireProjectile(fromKey: string, toKey: string, color: string, flightMs: number) {
    const layer = layerRef.current;
    const fromEl = unitEls.current.get(fromKey);
    const toEl = unitEls.current.get(toKey);
    if (!layer || !fromEl || !toEl) return;
    const lr = layer.getBoundingClientRect();
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const orb = document.createElement("div");
    orb.className = styles.projectile;
    orb.style.setProperty("--pcolor", color);
    layer.appendChild(orb);
    const x0 = fr.left + fr.width / 2 - lr.left;
    const y0 = fr.top + fr.height / 2 - lr.top;
    const x1 = tr.left + tr.width / 2 - lr.left;
    const y1 = tr.top + tr.height / 2 - lr.top;
    const anim = orb.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(0.5)`, opacity: 0.95 },
        { transform: `translate(${(x0 + x1) / 2}px, ${(y0 + y1) / 2 - 26}px) scale(1.1)`, opacity: 1 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.9)`, opacity: 1 },
      ],
      { duration: flightMs, easing: "cubic-bezier(0.4, 0, 0.8, 1)" },
    );
    anim.onfinish = () => orb.remove();
  }

  /** Radial flash at a unit's position. */
  function impactFlash(atKey: string, color: string) {
    const layer = layerRef.current;
    const el = unitEls.current.get(atKey);
    if (!layer || !el) return;
    const lr = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const flash = document.createElement("div");
    flash.className = styles.impact;
    flash.style.setProperty("--pcolor", color);
    flash.style.left = `${r.left + r.width / 2 - lr.left}px`;
    flash.style.top = `${r.top + r.height / 2 - lr.top}px`;
    layer.appendChild(flash);
    window.setTimeout(() => flash.remove(), 450);
  }

  function applyAbilityTargets(effect: string, amount: number, targets: TargetOutcome[]) {
    for (const t of targets) {
      updateUnit(t.side, t.index, (u) => {
        let next: Unit = { ...u, hp: Math.max(0, t.health), shield: t.shield, atk: t.attack };
        if (effect === "buffHealth") next = { ...next, maxHp: u.maxHp + amount };
        switch (effect) {
          case "buffAttack":
            next = withFloat(next, `+${amount}⚔`, styles.fBuff);
            break;
          case "buffHealth":
            next = withFloat(next, `+${amount}♥`, styles.fHeal);
            break;
          case "heal":
            next = withFloat(next, `+${amount}`, styles.fHeal);
            break;
          case "shield":
            next = withFloat(next, `+${amount}🛡`, styles.fShield);
            break;
          case "damage":
            next = { ...withFloat(next, `-${amount}`, styles.fDmg), anim: "hurt" };
            break;
        }
        return next;
      });
      if (effect === "damage") impactFlash(`${t.side}-${t.index}`, "#b884e6");
    }
  }

  /** Apply one event's visuals + state. Non-blocking — impact lands via `later`. */
  function playEvent(ev: BattleEvent) {
    if (ev.type === "ability") {
      updateUnit(ev.source.side, ev.source.index, (u) => ({ ...u, anim: "cast" }));
      if (ev.effect === "damage") sfx.zap();
      else if (ev.effect === "shield") sfx.shield();
      else sfx.buff();
      const targets = ev.targets;
      const effect = ev.effect;
      const amount = ev.amount;
      later(200, () => applyAbilityTargets(effect, amount, targets));
      later(460, () => updateUnit(ev.source.side, ev.source.index, (u) => (u.anim === "cast" ? { ...u, anim: "" } : u)));
      return;
    }

    if (ev.type === "attack") {
      const attackerKey = `${ev.attacker.side}-${ev.attacker.index}`;
      const defenderKey = `${ev.defender.side}-${ev.defender.index}`;
      const attacker = (ev.attacker.side === "a" ? a : b)[ev.attacker.index];
      const ranged = attacker?.ranged ?? false;
      const color = attacker?.accent ?? "#f5c542";
      const impactDelay = ranged ? 270 : 150;

      updateUnit(ev.attacker.side, ev.attacker.index, (u) => ({ ...u, anim: "lunge", attackTick: u.attackTick + 1 }));
      if (ranged) {
        sfx.whoosh();
        fireProjectile(attackerKey, defenderKey, color, impactDelay / speedRef.current);
      }

      later(impactDelay, () => {
        if (ev.crit) sfx.crit();
        else sfx.hit();
        impactFlash(defenderKey, ev.crit ? "#ffd76a" : color);
        updateUnit(ev.defender.side, ev.defender.index, (u) => {
          let next: Unit = { ...u, hp: Math.max(0, ev.defenderHealth), shield: ev.defenderShield, anim: "hurt" };
          const healthLost = ev.damage - ev.absorbed;
          if (ev.absorbed > 0) next = withFloat(next, `-${ev.absorbed}🛡`, styles.fShield);
          if (healthLost > 0)
            next = withFloat(next, ev.crit ? `-${healthLost}!` : `-${healthLost}`, ev.crit ? styles.fCrit : styles.fDmg);
          if (ev.absorbed > 0 && healthLost === 0) sfx.shield();
          return next;
        });
      });
      later(impactDelay + 320, () => {
        updateUnit(ev.attacker.side, ev.attacker.index, (u) => (u.anim === "lunge" ? { ...u, anim: "" } : u));
        updateUnit(ev.defender.side, ev.defender.index, (u) => (u.anim === "hurt" ? { ...u, anim: "" } : u));
      });
      return;
    }

    if (ev.type === "faint") {
      // Small delay so the killing blow's impact reads before the fade.
      later(200, () => {
        sfx.faint();
        (ev.side === "a" ? setA : setB)((prev) => {
          const units = prev.map((u) => (u.index === ev.index ? { ...u, alive: false, anim: "" as const } : u));
          // The next melee unit steps up — restart its cooldown bar.
          const newFront = units.find((u) => u.alive);
          if (newFront && !newFront.ranged) {
            return units.map((u) => (u === newFront ? { ...u, attackTick: u.attackTick + 1 } : u));
          }
          return units;
        });
      });
      return;
    }

    if (ev.type === "end") {
      later(450, () => {
        if (ev.winner === "a") sfx.fanfare();
        else if (ev.winner === "b") sfx.defeat();
        setFinished(true);
      });
    }
  }

  // The playback runner: walk events on their own timeline, compressing gaps.
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      let prevT = 0;
      await sleep(400); // beat before the fight starts
      for (const ev of result.events) {
        if (cancelledRef.current) return;
        const gap = Math.min(Math.max(0, ev.t - prevT), MAX_GAP_MS);
        prevT = ev.t;
        if (gap > 0) await sleep(gap);
        if (cancelledRef.current) return;
        playEvent(ev);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    if (!finished || completedRef.current) return;
    completedRef.current = true;
    const id = window.setTimeout(() => onComplete(result.winner), 600);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  /** Jump straight to the final state the engine already computed. */
  function skip() {
    cancelledRef.current = true;
    setA(fromFinal(playerDeck, "a", result.finalA));
    setB(fromFinal(enemyDeck, "b", result.finalB));
    setFinished(true);
  }

  function registerEl(key: string) {
    return (el: HTMLDivElement | null) => {
      if (el) unitEls.current.set(key, el);
      else unitEls.current.delete(key);
    };
  }

  return (
    <div className={styles.arena}>
      <div className={styles.arenaHead}>
        <div className={styles.arenaVs}>Battle</div>
        <div className={styles.arenaNames}>
          <span>{playerName}</span> vs {enemyName}
        </div>
      </div>

      <div className={styles.field}>
        <div className={`${styles.side} ${styles.sideEnemy}`}>
          {b.map((u) => (
            <UnitTile
              key={u.key}
              unit={u}
              side="enemy"
              waiting={!u.ranged && u.alive && b.find((x) => x.alive) !== u}
              speed={speed}
              finished={finished}
              registerEl={registerEl(`b-${u.index}`)}
            />
          ))}
        </div>
        <div className={styles.midline}>— ⚔ —</div>
        <div className={`${styles.side} ${styles.sidePlayer}`}>
          {a.map((u) => (
            <UnitTile
              key={u.key}
              unit={u}
              side="player"
              waiting={!u.ranged && u.alive && a.find((x) => x.alive) !== u}
              speed={speed}
              finished={finished}
              registerEl={registerEl(`a-${u.index}`)}
            />
          ))}
        </div>
      </div>

      {/* projectile / impact overlay */}
      <div ref={layerRef} className={styles.fxLayer} />

      <div className={styles.battleControls}>
        <button
          className={styles.btn}
          onClick={() => {
            const next = !isMuted();
            setMuted(next);
            setMutedUi(next);
          }}
        >
          {mutedUi ? "🔇" : "🔊"}
        </button>
        {!finished && (
          <>
            <button className={styles.btn} onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}>
              {speed === 1 ? "▶ ×1" : speed === 2 ? "▶▶ ×2" : "▶▶▶ ×4"}
            </button>
            <button className={styles.btn} onClick={skip}>
              Skip ⏭
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function UnitTile({
  unit,
  side,
  waiting,
  speed,
  finished,
  registerEl,
}: {
  unit: Unit;
  side: "player" | "enemy";
  /** Benched melee — alive but not attacking until it reaches the front. */
  waiting: boolean;
  speed: number;
  finished: boolean;
  registerEl: (el: HTMLDivElement | null) => void;
}) {
  const animClass =
    unit.anim === "hurt"
      ? styles.hurt
      : unit.anim === "cast"
        ? styles.casting
        : unit.anim === "lunge"
          ? side === "player"
            ? styles.lungeUp
            : styles.lungeDown
          : "";
  const cls = [styles.unit, animClass, unit.alive ? "" : styles.fainting, waiting ? styles.unitWaiting : ""]
    .filter(Boolean)
    .join(" ");
  const showCooldown = unit.alive && !waiting && !finished && unit.intervalMs !== null;
  return (
    <div ref={registerEl} className={cls} style={{ ["--accent"]: unit.accent } as React.CSSProperties}>
      <div className={styles.floatStack}>
        {unit.floats.map((f) => (
          <span key={f.id} className={`${styles.floatText} ${f.cls}`}>
            {f.text}
          </span>
        ))}
      </div>
      {unit.shield > 0 && <div className={styles.shieldBadge}>🛡{unit.shield}</div>}
      <div className={styles.unitArt}>
        <Sigil kind={unit.sigil} size={30} />
      </div>
      <div className={styles.unitName}>
        <span className={styles.roleGlyph} title={unit.ranged ? "Ranged — attacks from anywhere, random target" : "Melee — attacks only from the front slot"}>
          {unit.ranged ? "🏹" : "⚔"}
        </span>
        {unit.name}
        {unit.level && <span className={styles.starsInline}>{"★".repeat(unit.level)}</span>}
      </div>
      <div className={styles.unitStats}>
        <span className={styles.atk}>
          <SwordIcon size={12} /> {unit.atk}
        </span>
        <span className={styles.hp}>
          <HeartIcon size={12} /> {unit.hp}
        </span>
      </div>
      <div className={styles.hpbar}>
        <div
          className={styles.hpfill}
          style={{ width: `${Math.max(0, Math.min(100, (unit.hp / unit.maxHp) * 100))}%` }}
        />
      </div>
      {showCooldown ? (
        <div className={styles.cdBar}>
          <div
            key={unit.attackTick}
            className={styles.cdFill}
            style={{ animationDuration: `${unit.intervalMs! / speed}ms` }}
          />
        </div>
      ) : waiting ? (
        <div className={styles.waitLabel}>in line</div>
      ) : (
        <div className={styles.cdSpacer} />
      )}
    </div>
  );
}
