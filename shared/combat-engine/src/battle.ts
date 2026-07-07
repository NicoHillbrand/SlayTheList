import { makeRng } from "./rng";
import type {
  Ability,
  BattleEvent,
  BattleResult,
  Card,
  CardId,
  DeckSnapshot,
  Side,
  TargetOutcome,
  UnitRef,
  UnitState,
} from "./types";

/** Sim time cap — a fight that hasn't resolved by now goes to a health tiebreak. */
const DEFAULT_MAX_TIME_MS = 90_000;

/** Chance for any strike to crit (2x damage). Seeded — deterministic per battle. */
const CRIT_CHANCE = 0.12;

/** Global combat pace: every attack interval is stretched by this factor
 *  (1.4 ≈ 30% fewer attacks per second). One knob for "fights feel too fast". */
export const ATTACK_INTERVAL_SCALE = 1.4;

/** ms between attacks for a given attackSpeed; Infinity for 0 (never attacks). */
export function attackIntervalMs(attackSpeed: number): number {
  return attackSpeed > 0 ? Math.max(100, Math.round((1000 * ATTACK_INTERVAL_SCALE) / attackSpeed)) : Infinity;
}

interface LiveUnit {
  cardId: CardId;
  index: number;
  name: string;
  attack: number;
  attackSpeed: number;
  ranged: boolean;
  /** ms between attacks; Infinity for attackSpeed 0 (never attacks). */
  intervalMs: number;
  nextAttackAt: number;
  health: number;
  maxHealth: number;
  shield: number;
  alive: boolean;
  ability?: Ability;
}

interface BattleCtx {
  a: LiveUnit[];
  b: LiveUnit[];
  events: BattleEvent[];
  rng: () => number;
  t: number;
}

function toUnits(deck: DeckSnapshot, catalog: Record<CardId, Card>, rng: () => number): LiveUnit[] {
  const units: LiveUnit[] = [];
  for (const id of deck.cardIds) {
    const card = catalog[id];
    if (!card) continue; // unknown card id — skip rather than crash
    const intervalMs = attackIntervalMs(card.attackSpeed);
    // Stagger the opening swing to a seeded random 50–100% of the interval.
    // Without this, equal-speed units tie on timestamps every attack and the
    // tie-break hands side A a systematic first-strike advantage (a mirror-
    // match test caught side A winning ~75% of games). Staggering keeps the
    // sim deterministic per seed while making openings symmetric in
    // expectation — and it reads better visually, too.
    const nextAttackAt =
      intervalMs === Infinity ? Infinity : Math.max(100, Math.round(intervalMs * (0.5 + 0.5 * rng())));
    units.push({
      cardId: card.id,
      index: units.length,
      name: card.name,
      attack: card.attack,
      attackSpeed: card.attackSpeed,
      ranged: card.ranged ?? false,
      intervalMs,
      nextAttackAt,
      health: card.health,
      maxHealth: card.health,
      shield: 0,
      alive: true,
      ability: card.ability,
    });
  }
  return units;
}

function sideUnits(ctx: BattleCtx, side: Side): LiveUnit[] {
  return side === "a" ? ctx.a : ctx.b;
}

function front(units: LiveUnit[]): LiveUnit | undefined {
  return units.find((u) => u.alive);
}

function ref(side: Side, unit: LiveUnit): UnitRef {
  return { side, index: unit.index, unit: unit.name };
}

function outcome(side: Side, unit: LiveUnit): TargetOutcome {
  return { ...ref(side, unit), health: unit.health, shield: unit.shield, attack: unit.attack };
}

function toState(unit: LiveUnit): UnitState {
  return {
    cardId: unit.cardId,
    name: unit.name,
    attack: unit.attack,
    attackSpeed: unit.attackSpeed,
    health: Math.max(0, unit.health),
    maxHealth: unit.maxHealth,
    shield: unit.shield,
    alive: unit.alive,
  };
}

/** Apply raw damage to a unit; shield soaks first. Returns what happened. */
function applyDamage(unit: LiveUnit, amount: number): { healthLost: number; absorbed: number } {
  const absorbed = Math.min(unit.shield, amount);
  unit.shield -= absorbed;
  const healthLost = amount - absorbed;
  unit.health -= healthLost;
  return { healthLost, absorbed };
}

/** Resolve an ability's targets to live units. */
function resolveTargets(ctx: BattleCtx, side: Side, source: LiveUnit, target: Ability["target"]): LiveUnit[] {
  const allies = sideUnits(ctx, side);
  const enemies = sideUnits(ctx, side === "a" ? "b" : "a");
  switch (target) {
    case "self":
      return source.alive ? [source] : [];
    case "allyBehind": {
      const behind = allies.find((u) => u.alive && u.index > source.index);
      return behind ? [behind] : [];
    }
    case "allAllies":
      return allies.filter((u) => u.alive);
    case "frontEnemy": {
      const f = front(enemies);
      return f ? [f] : [];
    }
    case "randomEnemy": {
      const alive = enemies.filter((u) => u.alive);
      if (alive.length === 0) return [];
      return [alive[Math.floor(ctx.rng() * alive.length)]];
    }
    case "allEnemies":
      return enemies.filter((u) => u.alive);
    default:
      return [];
  }
}

/**
 * Fire a unit's ability (if its trigger matches). Any deaths caused are
 * faint-processed too, so on-faint chains (bombs setting off bombs) resolve.
 */
function fireAbility(ctx: BattleCtx, side: Side, source: LiveUnit, trigger: Ability["trigger"]): void {
  const ability = source.ability;
  if (!ability || ability.trigger !== trigger) return;
  const targets = resolveTargets(ctx, side, source, ability.target);
  if (targets.length === 0) return;

  const enemySide: Side = side === "a" ? "b" : "a";
  const targetSide =
    ability.target === "frontEnemy" || ability.target === "randomEnemy" || ability.target === "allEnemies"
      ? enemySide
      : side;

  const outcomes: TargetOutcome[] = [];
  const killed: LiveUnit[] = [];

  for (const t of targets) {
    switch (ability.effect) {
      case "buffAttack":
        t.attack += ability.amount;
        break;
      case "buffHealth":
        t.health += ability.amount;
        t.maxHealth += ability.amount;
        break;
      case "shield":
        t.shield += ability.amount;
        break;
      case "heal":
        t.health = Math.min(t.maxHealth, t.health + ability.amount);
        break;
      case "damage": {
        applyDamage(t, ability.amount);
        if (t.health <= 0 && t.alive) {
          t.alive = false;
          killed.push(t);
        }
        break;
      }
    }
    outcomes.push(outcome(targetSide, t));
  }

  ctx.events.push({
    t: ctx.t,
    type: "ability",
    trigger,
    effect: ability.effect,
    amount: ability.amount,
    source: ref(side, source),
    targets: outcomes,
  });

  for (const dead of killed) {
    ctx.events.push({ t: ctx.t, type: "faint", side: targetSide, index: dead.index, unit: dead.name });
    fireAbility(ctx, targetSide, dead, "onFaint");
    promoteFront(ctx, targetSide);
  }
}

/** When a front unit falls, the next melee unit "steps up": its cooldown
 *  restarts from now (it wasn't swinging from the bench). Ranged units were
 *  already attacking, so their timers are left alone. */
function promoteFront(ctx: BattleCtx, side: Side): void {
  const f = front(sideUnits(ctx, side));
  if (f && !f.ranged && f.intervalMs !== Infinity && f.nextAttackAt < ctx.t + f.intervalMs) {
    f.nextAttackAt = ctx.t + f.intervalMs;
  }
}

export interface BattleOptions {
  /** Sim time cap in ms (default 90s). */
  maxTimeMs?: number;
}

/**
 * Resolve a battle between two decks on a continuous timeline: every unit
 * attacks the enemy front on its own attack-speed cooldown (The Bazaar /
 * Backpack Battles model), rather than in alternating rounds.
 *
 * Fully deterministic: the same decks, catalog, and seed always produce the
 * same result, so this can run identically in the browser (to animate) and on
 * a server (to verify async PvP outcomes). All randomness (crits, random
 * targets) flows through the seeded RNG — protect that invariant.
 *
 * Timeouts resolve by comparing remaining health+shield, then draw.
 */
export function resolveBattle(
  deckA: DeckSnapshot,
  deckB: DeckSnapshot,
  catalog: Record<CardId, Card>,
  seed = 1,
  options: BattleOptions = {},
): BattleResult {
  const maxTime = options.maxTimeMs ?? DEFAULT_MAX_TIME_MS;
  const rng = makeRng(seed);
  const ctx: BattleCtx = {
    a: toUnits(deckA, catalog, rng),
    b: toUnits(deckB, catalog, rng),
    events: [],
    rng,
    t: 0,
  };
  ctx.events.push({ t: 0, type: "start", a: ctx.a.map((u) => u.name), b: ctx.b.map((u) => u.name) });

  // Battle-start abilities at t=0, alternating sides front-to-back so neither
  // deck's openers all resolve first. Units killed before their turn don't fire.
  const maxLen = Math.max(ctx.a.length, ctx.b.length);
  for (let i = 0; i < maxLen; i += 1) {
    const ua = ctx.a[i];
    if (ua?.alive) fireAbility(ctx, "a", ua, "battleStart");
    const ub = ctx.b[i];
    if (ub?.alive) fireAbility(ctx, "b", ub, "battleStart");
  }

  // Timeline loop: next attacker = lowest nextAttackAt among ELIGIBLE units —
  // ranged units attack from anywhere; melee units only while holding the
  // front slot. We scan side a's units (in index order) before side b's and
  // replace only on strict `<`, so ties deterministically go to side a, then
  // to the lower index.
  while (front(ctx.a) && front(ctx.b)) {
    let next: { side: Side; unit: LiveUnit } | null = null;
    for (const side of ["a", "b"] as const) {
      const units = sideUnits(ctx, side);
      const frontUnit = front(units);
      for (const u of units) {
        if (!u.alive || u.intervalMs === Infinity) continue;
        if (!u.ranged && u !== frontUnit) continue; // benched melee waits
        if (!next || u.nextAttackAt < next.unit.nextAttackAt) next = { side, unit: u };
      }
    }
    if (!next || next.unit.nextAttackAt > maxTime) break;

    const { side, unit: attacker } = next;
    ctx.t = attacker.nextAttackAt;
    attacker.nextAttackAt += attacker.intervalMs;

    const enemySide: Side = side === "a" ? "b" : "a";
    const enemies = sideUnits(ctx, enemySide);
    // Melee strikes the enemy front; ranged picks a random living target.
    let defender: LiveUnit | undefined;
    if (attacker.ranged) {
      const alive = enemies.filter((u) => u.alive);
      defender = alive.length > 0 ? alive[Math.floor(ctx.rng() * alive.length)] : undefined;
    } else {
      defender = front(enemies);
    }
    if (!defender) break;

    const crit = ctx.rng() < CRIT_CHANCE;
    const damage = attacker.attack * (crit ? 2 : 1);
    const hit = applyDamage(defender, damage);

    ctx.events.push({
      t: ctx.t,
      type: "attack",
      side,
      attacker: ref(side, attacker),
      defender: ref(enemySide, defender),
      damage,
      absorbed: hit.absorbed,
      crit,
      defenderHealth: Math.max(0, defender.health),
      defenderShield: defender.shield,
    });

    const died = defender.health <= 0;
    if (!died && hit.healthLost > 0) fireAbility(ctx, enemySide, defender, "onHurt");
    if (died && defender.alive) {
      defender.alive = false;
      ctx.events.push({ t: ctx.t, type: "faint", side: enemySide, index: defender.index, unit: defender.name });
      fireAbility(ctx, enemySide, defender, "onFaint");
      promoteFront(ctx, enemySide);
    }
  }

  const aAlive = Boolean(front(ctx.a));
  const bAlive = Boolean(front(ctx.b));
  let winner: Side | "draw";
  if (aAlive && !bAlive) winner = "a";
  else if (bAlive && !aAlive) winner = "b";
  else if (!aAlive && !bAlive) winner = "draw";
  else {
    // Timeout: compare remaining health+shield of living units.
    const total = (units: LiveUnit[]) =>
      units.filter((u) => u.alive).reduce((sum, u) => sum + Math.max(0, u.health) + u.shield, 0);
    const ta = total(ctx.a);
    const tb = total(ctx.b);
    winner = ta > tb ? "a" : tb > ta ? "b" : "draw";
    ctx.t = maxTime;
  }
  ctx.events.push({ t: ctx.t, type: "end", winner });

  return {
    winner,
    events: ctx.events,
    duration: ctx.t,
    finalA: ctx.a.map(toState),
    finalB: ctx.b.map(toState),
    seed,
  };
}

/** The unkillable target for DPS checks. Register it in any catalog you pass. */
export const TRAINING_DUMMY: Card = {
  id: "__dummy",
  name: "Training Dummy",
  cost: 0,
  attack: 0,
  attackSpeed: 0,
  health: 1_000_000,
};

export interface DamageTestResult {
  /** Total damage dealt to the dummy within the window. */
  damage: number;
  /** Damage per second over the window. */
  dps: number;
  result: BattleResult;
}

/** Oaken-style damage test: hit an unkillable dummy for `durationMs`. */
export function resolveDamageTest(
  deck: DeckSnapshot,
  catalog: Record<CardId, Card>,
  durationMs = 30_000,
  seed = 1,
): DamageTestResult {
  const withDummy = { ...catalog, [TRAINING_DUMMY.id]: TRAINING_DUMMY };
  const result = resolveBattle(deck, { cardIds: [TRAINING_DUMMY.id] }, withDummy, seed, {
    maxTimeMs: durationMs,
  });
  const dummy = result.finalB[0];
  const damage = dummy ? TRAINING_DUMMY.health - dummy.health : 0;
  return { damage, dps: damage / (durationMs / 1000), result };
}
