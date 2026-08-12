/**
 * The Crawl — pure turn engine.
 *
 * Every exported mutator takes `(state, ..., ctx)` and returns a brand new
 * state plus the events that happened. Nothing here reads the clock beyond
 * `ctx.nowMs`, touches gold, or knows what a todo is: the caller resolves all
 * of that and hands down `goldEarnedToday`, `momentum`, and `unlocked`.
 *
 * Two deliberate departures from Slay the Spire, both forced by the fact that
 * this is an overlay you glance at rather than a game you sit down to:
 *
 *  1. THE HAND PERSISTS. StS discards your hand every turn and redraws. Here
 *     energy is real-world scarce, and you may end a turn on Tuesday and take
 *     the next one on Thursday — throwing the hand away would burn work you
 *     already did. You draw one card per turn instead, up to the cap.
 *  2. ENERGY IS NOT PER-TURN. It is a shared daily pool (today's earned gold),
 *     so a turn is only as big as the work behind it, and a productive day
 *     buys a long push rather than a fixed three actions.
 *
 * A third, smaller pool sits alongside energy: DRAW CREDITS, minted by
 * micro-actions in tenths of gold. They buy cards rather than plays, so the fast
 * trickle of small wins widens what you can choose from without ever standing in
 * for the finished work that pays to actually swing.
 */
import {
  BOSS_GOLD_REWARD,
  DRAW_PER_TURN,
  FLOORS,
  HAND_SIZE,
  HEAVY_EVERY,
  HEAVY_MULTIPLIER,
  MICRO_TENTHS_PER_DRAW,
  MOMENTUM_DAMAGE,
  REWARD_CHOICES,
  REWARD_POOL,
  ROOM_ENTRY_HEAL_FRACTION,
  ROOMS_PER_FLOOR,
  START_HP,
  STARTING_DECK,
  enemyTemplate,
  getCard,
  isBossRoom,
} from "./content.js";
import { makeRng, shuffle } from "./rng.js";
import type {
  CardId,
  CrawlContext,
  CrawlEvent,
  CrawlMeta,
  CrawlResult,
  CrawlState,
  EnemyState,
} from "./types.js";

export function emptyCrawlMeta(): CrawlMeta {
  return { bestFloor: 1, runsWon: 0, runsLost: 0, kills: 0 };
}

function spawnEnemy(floor: number, room: number): EnemyState {
  const template = enemyTemplate(floor, room);
  return {
    name: template.name,
    glyph: template.glyph,
    hp: template.hp,
    maxHp: template.hp,
    attack: template.attack,
    weakened: 0,
    turnsUntilHeavy: HEAVY_EVERY,
    boss: isBossRoom(floor, room),
  };
}

/** Fresh run. `meta` carries over from a previous run when there was one. */
export function createCrawlState(
  seed: number,
  nowMs: number,
  today: string,
  meta: CrawlMeta = emptyCrawlMeta(),
): CrawlState {
  const rng = makeRng(seed);
  const drawPile = shuffle(STARTING_DECK, rng);
  const hand = drawPile.splice(0, HAND_SIZE);
  return {
    version: 1,
    seed,
    runStartedMs: nowMs,
    floor: 1,
    room: 0,
    status: "fighting",
    hp: START_HP,
    maxHp: START_HP,
    block: 0,
    strength: 0,
    playedThisTurn: false,
    deck: [...STARTING_DECK],
    hand,
    drawPile,
    discard: [],
    enemy: spawnEnemy(1, 0),
    rewardChoices: [],
    energyDay: today,
    energyUsed: 0,
    drawsUsed: 0,
    lockTodoId: null,
    lockTodoTitle: null,
    rolls: 1,
    meta,
  };
}

/**
 * Apply the midnight reset. Today's pools expire rather than banking, so
 * crossing into a new local day zeroes what this run has spent from both.
 */
export function normalizeDay(state: CrawlState, today: string): CrawlState {
  if (state.energyDay === today) return state;
  return { ...state, energyDay: today, energyUsed: 0, drawsUsed: 0 };
}

/** Energy still spendable today: what you earned, minus what this run used. */
export function energyAvailable(state: CrawlState, ctx: CrawlContext): number {
  const day = normalizeDay(state, ctx.today);
  return Math.max(0, Math.floor(ctx.goldEarnedToday) - day.energyUsed);
}

/**
 * Extra card draws still available today: what today's micro-actions bought,
 * minus what this run already pulled. Mirrors `energyAvailable` exactly, against
 * the other pool.
 */
export function drawCreditsAvailable(state: CrawlState, ctx: CrawlContext): number {
  const day = normalizeDay(state, ctx.today);
  // Coerced rather than trusted: a caller that omits the field should read as
  // "no credits", not poison every later comparison with NaN.
  const tenths = Number.isFinite(ctx.microTenthsToday) ? Math.max(0, ctx.microTenthsToday) : 0;
  const earned = Math.floor(tenths / MICRO_TENTHS_PER_DRAW);
  return Math.max(0, earned - day.drawsUsed);
}

/** Why the player cannot act right now, or null when they can. */
export function blockedReason(state: CrawlState, ctx: CrawlContext): string | null {
  if (state.lockTodoId && !ctx.unlocked) {
    return `Locked: ${state.lockTodoTitle ?? "finish the pinned todo"}`;
  }
  if (state.status === "dead") return "Your run ended. Start a new one.";
  if (state.status === "victory") return "Run cleared. Start a new one.";
  return null;
}

/**
 * Move `count` cards from the draw pile into the hand, reshuffling the discard
 * when the pile runs dry. Stops at HAND_SIZE unless `overflow` is set, which is
 * how a micro-gold draw pushes the hand past its normal cap.
 */
function drawCards(state: CrawlState, count: number, overflow = false): CrawlState {
  let { hand, drawPile, discard, rolls } = state;
  hand = [...hand];
  drawPile = [...drawPile];
  discard = [...discard];

  for (let i = 0; i < count; i += 1) {
    if (!overflow && hand.length >= HAND_SIZE) break;
    if (drawPile.length === 0) {
      if (discard.length === 0) break;
      rolls += 1;
      drawPile = shuffle(discard, makeRng(state.seed + rolls));
      discard = [];
    }
    const next = drawPile.shift();
    if (next === undefined) break;
    hand.push(next);
  }
  return { ...state, hand, drawPile, discard, rolls };
}

function rollRewards(state: CrawlState): { choices: CardId[]; rolls: number } {
  const rolls = state.rolls + 1;
  const picked = shuffle(REWARD_POOL, makeRng(state.seed + rolls * 7919)).slice(0, REWARD_CHOICES);
  return { choices: picked, rolls };
}

/** Damage a card deals after strength and momentum, for a given base value. */
function outgoingDamage(base: number, state: CrawlState, ctx: CrawlContext): number {
  if (base <= 0) return 0;
  return base + state.strength + (ctx.momentum ? MOMENTUM_DAMAGE : 0);
}

/**
 * Play the card at `handIndex`. Costs energy from today's pool. Rejects (state
 * unchanged, no events) when the run is locked, it is not a fight, or the
 * energy is not there — the UI disables those cases, this is the backstop.
 */
export function playCard(state: CrawlState, handIndex: number, ctx: CrawlContext): CrawlResult {
  const base = normalizeDay(state, ctx.today);
  if (blockedReason(base, ctx) !== null) return { state: base, events: [] };
  if (base.status !== "fighting" || !base.enemy) return { state: base, events: [] };

  const cardId = base.hand[handIndex];
  const card = cardId ? getCard(cardId) : undefined;
  if (!card) return { state: base, events: [] };
  if (card.cost > energyAvailable(base, ctx)) return { state: base, events: [] };

  const events: CrawlEvent[] = [];
  let next: CrawlState = {
    ...base,
    hand: base.hand.filter((_, i) => i !== handIndex),
    discard: [...base.discard, card.id],
    energyUsed: base.energyUsed + card.cost,
    playedThisTurn: true,
  };

  const effect = card.effect;
  const damage = outgoingDamage(effect.damage ?? 0, next, ctx);
  const enemy: EnemyState = { ...next.enemy! };

  if (damage > 0) enemy.hp = Math.max(0, enemy.hp - damage);
  if (effect.weaken) enemy.weakened += effect.weaken;
  if (effect.block) next.block += effect.block;
  if (effect.heal) next.hp = Math.min(next.maxHp, next.hp + effect.heal);
  if (effect.strength) next.strength += effect.strength;

  next.enemy = enemy;
  events.push({ type: "cardPlayed", cardId: card.id, damage });

  if (effect.draw) next = drawCards(next, effect.draw);

  if (enemy.hp <= 0) return resolveEnemyDeath(next, events);
  return { state: next, events };
}

/**
 * Spend one micro-gold draw credit to pull a single extra card.
 *
 * Deliberately allowed to push the hand past HAND_SIZE — that overflow IS the
 * effect, the "extend your turn" the credits are for. A run whose energy is
 * spent gains nothing from this, which is the intended shape: micro-actions
 * widen the choice, finished work is still the only thing that pays to act.
 *
 * Does not touch `playedThisTurn`, so drawing never provokes the enemy: a credit
 * spent is not a move made.
 */
export function drawExtraCard(state: CrawlState, ctx: CrawlContext): CrawlResult {
  const base = normalizeDay(state, ctx.today);
  if (blockedReason(base, ctx) !== null) return { state: base, events: [] };
  if (base.status !== "fighting") return { state: base, events: [] };
  if (drawCreditsAvailable(base, ctx) < 1) return { state: base, events: [] };
  // Nothing left anywhere to draw: refuse rather than burn the credit on a no-op.
  if (base.drawPile.length === 0 && base.discard.length === 0) return { state: base, events: [] };

  const drawn = drawCards(base, 1, true);
  const cardId = drawn.hand[drawn.hand.length - 1];
  if (drawn.hand.length === base.hand.length || cardId === undefined) {
    return { state: base, events: [] };
  }
  return {
    state: { ...drawn, drawsUsed: base.drawsUsed + 1 },
    events: [{ type: "cardDrawn", cardId }],
  };
}

/** Enemy at 0 HP: hand the player their reward, or end the run on the boss. */
function resolveEnemyDeath(state: CrawlState, events: CrawlEvent[]): CrawlResult {
  const enemy = state.enemy!;
  const meta: CrawlMeta = { ...state.meta, kills: state.meta.kills + 1 };
  events.push({ type: "enemySlain", name: enemy.name, boss: enemy.boss });

  if (enemy.boss) {
    events.push({ type: "runWon", goldReward: BOSS_GOLD_REWARD });
    return {
      state: {
        ...state,
        enemy: null,
        status: "victory",
        rewardChoices: [],
        meta: { ...meta, runsWon: meta.runsWon + 1, bestFloor: Math.max(meta.bestFloor, FLOORS) },
      },
      events,
    };
  }

  const { choices, rolls } = rollRewards(state);
  return {
    state: { ...state, enemy: null, status: "reward", rewardChoices: choices, rolls, meta },
    events,
  };
}

/**
 * True when the enemy is allowed to swing: the player has spent something this
 * turn. The UI disables the button on false; the engine refuses on false too.
 */
export function canEndTurn(state: CrawlState): boolean {
  return state.status === "fighting" && state.enemy !== null && state.playedThisTurn;
}

/**
 * End the turn: the enemy swings, block absorbs it and is then spent, and the
 * player draws back up. A heavy attack is telegraphed by `turnsUntilHeavy`.
 *
 * Does nothing at all until a card has been played. The enemy responds to the
 * player rather than to a clock, so a run with no energy behind it simply sits
 * there — it never grinds the player down for being away.
 */
export function endTurn(state: CrawlState, ctx: CrawlContext): CrawlResult {
  const base = normalizeDay(state, ctx.today);
  if (blockedReason(base, ctx) !== null) return { state: base, events: [] };
  if (!canEndTurn(base)) return { state: base, events: [] };
  if (base.status !== "fighting" || !base.enemy) return { state: base, events: [] };

  const events: CrawlEvent[] = [];
  const enemy: EnemyState = { ...base.enemy };
  const heavy = enemy.turnsUntilHeavy <= 1;
  const swing = Math.max(1, enemy.attack - enemy.weakened) * (heavy ? HEAVY_MULTIPLIER : 1);
  enemy.turnsUntilHeavy = heavy ? HEAVY_EVERY : enemy.turnsUntilHeavy - 1;

  const absorbed = Math.min(base.block, swing);
  const through = swing - absorbed;
  events.push({ type: "playerHit", amount: through, heavy });

  let next: CrawlState = {
    ...base,
    enemy,
    block: 0,
    hp: base.hp - through,
    playedThisTurn: false,
  };

  if (next.hp <= 0) {
    events.push({ type: "died", floor: next.floor });
    return {
      state: {
        ...next,
        hp: 0,
        status: "dead",
        meta: { ...next.meta, runsLost: next.meta.runsLost + 1 },
      },
      events,
    };
  }

  next = drawCards(next, DRAW_PER_TURN);
  return { state: next, events };
}

/**
 * Take a reward card and step into the next room. `cardId` may be null to skip
 * the card — keeping the deck lean is a real choice, and skipping is one click
 * rather than a menu. Requires the run to be unlocked.
 */
export function chooseReward(
  state: CrawlState,
  cardId: CardId | null,
  ctx: CrawlContext,
): CrawlResult {
  const base = normalizeDay(state, ctx.today);
  if (blockedReason(base, ctx) !== null) return { state: base, events: [] };
  if (base.status !== "reward") return { state: base, events: [] };
  if (cardId !== null && !base.rewardChoices.includes(cardId)) return { state: base, events: [] };

  const events: CrawlEvent[] = [];
  const deck = cardId ? [...base.deck, cardId] : base.deck;
  const discard = cardId ? [...base.discard, cardId] : base.discard;

  let floor = base.floor;
  let room = base.room + 1;
  if (room >= ROOMS_PER_FLOOR) {
    room = 0;
    floor += 1;
    events.push({ type: "floorCleared", floor: base.floor });
  }
  // You always walk into a room whole — HP is a per-fight resource, not a
  // run-long one. See ROOM_ENTRY_HEAL_FRACTION for why.
  const hp = Math.min(base.maxHp, Math.round(base.maxHp * ROOM_ENTRY_HEAL_FRACTION));

  const next: CrawlState = {
    ...base,
    deck,
    discard,
    floor,
    room,
    hp,
    block: 0,
    // Strength is a per-fight buff; a new room means a fresh enemy.
    strength: 0,
    playedThisTurn: false,
    status: "fighting",
    rewardChoices: [],
    enemy: spawnEnemy(floor, room),
    // The lock is consumed once the player has actually moved on.
    lockTodoId: null,
    lockTodoTitle: null,
    meta: { ...base.meta, bestFloor: Math.max(base.meta.bestFloor, floor) },
  };
  return { state: drawCards(next, HAND_SIZE), events };
}

/** Start a fresh run, carrying meta forward. Free: death costs progress, not gold. */
export function restartRun(state: CrawlState, seed: number, nowMs: number, today: string): CrawlResult {
  // Carry today's spend across the restart so dying refunds neither pool.
  const day = normalizeDay(state, today);
  const fresh = createCrawlState(seed, nowMs, today, day.meta);
  return {
    state: { ...fresh, energyUsed: day.energyUsed, drawsUsed: day.drawsUsed },
    events: [],
  };
}

/** Pin a todo to the run. Blocks all actions until that todo is done. */
export function setLock(state: CrawlState, todoId: string | null, title: string | null): CrawlState {
  return { ...state, lockTodoId: todoId, lockTodoTitle: todoId ? title : null };
}
