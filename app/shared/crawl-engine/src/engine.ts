/**
 * The Crawl — pure engine.
 *
 * Every exported mutator takes `(state, ..., ctx)` and returns a brand new
 * state plus the events that happened. Nothing here touches gold or knows what
 * a todo is: the caller resolves all of that and hands down `goldEarnedToday`,
 * `momentum`, and `wardCleared`. The one thing the engine does read is
 * `ctx.nowMs`, and only through `tickClock`.
 *
 * Three deliberate departures from Slay the Spire, all forced by the fact that
 * this is an overlay you glance at rather than a game you sit down to:
 *
 *  1. THERE ARE NO TURNS. The enemy swings on a wall clock every
 *     ENEMY_SWING_INTERVAL_MS; the player acts whenever they like in between.
 *     "End turn" was a button whose only job was to ask the player to admit
 *     they were finished, and in a panel that is open for eight seconds at a
 *     time that is a chore, not a decision.
 *  2. THE HAND PERSISTS. StS discards your hand every turn and redraws. Here
 *     energy is real-world scarce and you may play one card on Tuesday and the
 *     next on Thursday — throwing the hand away would burn work you already did.
 *  3. ENERGY IS NOT PER-TURN. It is a shared daily pool (today's earned gold),
 *     so a productive day buys a long push rather than a fixed three actions.
 *
 * A smaller pool sits alongside energy: DRAW CREDITS, minted by micro-actions in
 * tenths of gold. They refill an empty hand slot immediately instead of waiting
 * for the next swing — the fast trickle of small wins keeps your options open
 * without ever standing in for the finished work that pays to actually swing.
 */
import {
  BLEED_DAMAGE,
  BOSS_GOLD_REWARD,
  ENEMY_SWING_INTERVAL_MS,
  FLOORS,
  HAND_SIZE,
  MAX_PENDING_SWINGS,
  MICRO_TENTHS_PER_DRAW,
  MOMENTUM_DAMAGE,
  REWARD_CHOICES,
  REWARD_POOL,
  ROOM_ENTRY_HEAL_FRACTION,
  ROOMS_PER_FLOOR,
  START_HP,
  STARTING_DECK,
  WARD_AMOUNT,
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

function spawnEnemy(floor: number, room: number, warded = false): EnemyState {
  const template = enemyTemplate(floor, room);
  return {
    name: template.name,
    glyph: template.glyph,
    hp: template.hp,
    maxHp: template.hp,
    attack: template.attack,
    weakened: 0,
    ward: warded ? WARD_AMOUNT : 0,
    boss: isBossRoom(floor, room),
  };
}

/** True while a todo is pinned and not yet finished. */
function isWarded(state: CrawlState, ctx: CrawlContext): boolean {
  return state.wardTodoId !== null && !ctx.wardCleared;
}

/**
 * Reconcile the enemy's shield with the pinned todo before anything else runs.
 *
 * Finishing the todo shatters the ward immediately rather than on the next
 * swing, because that instant is the reason the mechanic exists — the reward for
 * the real work is your next card suddenly landing in full.
 */
function syncWard(state: CrawlState, ctx: CrawlContext): CrawlResult {
  if (!state.enemy) return { state, events: [] };
  if (isWarded(state, ctx) || state.enemy.ward === 0) return { state, events: [] };
  return {
    state: { ...state, enemy: { ...state.enemy, ward: 0 } },
    events: [{ type: "wardShattered" }],
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
    lastSwingMs: nowMs,
    deck: [...STARTING_DECK],
    hand,
    drawPile,
    discard: [],
    enemy: spawnEnemy(1, 0),
    rewardChoices: [],
    energyDay: today,
    energyUsed: 0,
    drawsUsed: 0,
    wardTodoId: null,
    wardTodoTitle: null,
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
 * Slot refills still available today: what today's micro-actions bought, minus
 * what this run already pulled. Mirrors `energyAvailable` exactly, against the
 * other pool.
 */
export function drawCreditsAvailable(state: CrawlState, ctx: CrawlContext): number {
  const day = normalizeDay(state, ctx.today);
  // Coerced rather than trusted: a caller that omits the field should read as
  // "no credits", not poison every later comparison with NaN.
  const tenths = Number.isFinite(ctx.microTenthsToday) ? Math.max(0, ctx.microTenthsToday) : 0;
  const earned = Math.floor(tenths / MICRO_TENTHS_PER_DRAW);
  return Math.max(0, earned - day.drawsUsed);
}

/**
 * Why the player cannot act right now, or null when they can.
 *
 * A pinned todo is deliberately NOT a reason. It used to be — a pin froze the
 * whole run — and that got the incentive backwards: with the run frozen,
 * finishing the todo only removes a wall, where it should be what earns the
 * turn. The pin now wards the enemy instead, so the answer here is "yes, play"
 * and the pinned work decides how much your cards are worth.
 *
 * The only real blocks left are the two that are simply true: the run is over.
 */
export function blockedReason(state: CrawlState, _ctx: CrawlContext): string | null {
  if (state.status === "dead") return "Your run ended. Start a new one.";
  if (state.status === "victory") return "Run cleared. Start a new one.";
  return null;
}

/**
 * Move `count` cards from the draw pile into the hand, reshuffling the discard
 * when the pile runs dry. Never grows the hand past HAND_SIZE — there is no
 * second, higher ceiling any more, so a slot is either a card or an opening.
 */
function drawCards(state: CrawlState, count: number): CrawlState {
  let { hand, drawPile, discard, rolls } = state;
  hand = [...hand];
  drawPile = [...drawPile];
  discard = [...discard];

  for (let i = 0; i < count; i += 1) {
    if (hand.length >= HAND_SIZE) break;
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

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * How many swing intervals have elapsed but not yet been resolved. Zero unless
 * an enemy is actually alive in front of the player — the clock does not run on
 * the reward screen, the floor-cleared screen, or after the run is over.
 */
export function intervalsElapsed(state: CrawlState, ctx: CrawlContext): number {
  if (state.status !== "fighting" || !state.enemy) return 0;
  const elapsed = ctx.nowMs - state.lastSwingMs;
  if (!Number.isFinite(elapsed) || elapsed < ENEMY_SWING_INTERVAL_MS) return 0;
  return Math.floor(elapsed / ENEMY_SWING_INTERVAL_MS);
}

/** Ms until the next swing lands. Null when no enemy is on the clock. */
export function msUntilNextSwing(state: CrawlState, ctx: CrawlContext): number | null {
  if (state.status !== "fighting" || !state.enemy) return null;
  const since = (ctx.nowMs - state.lastSwingMs) % ENEMY_SWING_INTERVAL_MS;
  return Math.max(0, ENEMY_SWING_INTERVAL_MS - since);
}

/** One full-strength swing. Block absorbs it and is then spent. */
function resolveSwing(state: CrawlState, ctx: CrawlContext): CrawlResult {
  const enemy: EnemyState = { ...state.enemy! };
  // The shield comes back with the enemy's swing while the todo is outstanding.
  // That is what makes a warded fight a grind rather than a one-swing detour:
  // you can break through between swings, but you cannot bank the progress.
  if (isWarded(state, ctx)) enemy.ward = WARD_AMOUNT;

  const swing = Math.max(1, enemy.attack - enemy.weakened);
  const absorbed = Math.min(state.block, swing);
  const through = swing - absorbed;

  // Refills the hand rather than topping it up by one. Cards you did not play
  // persist; this only fills the openings, so ENERGY stays the only thing
  // limiting how hard you hit.
  const next = drawCards(
    { ...state, enemy, block: 0, hp: state.hp - through },
    HAND_SIZE,
  );
  return { state: next, events: [{ type: "playerHit", amount: through }] };
}

/** One bleed tick: the run was left past its swing budget. Ignores block. */
function resolveBleed(state: CrawlState): CrawlResult {
  return {
    state: { ...state, hp: state.hp - BLEED_DAMAGE },
    events: [{ type: "bled", amount: BLEED_DAMAGE }],
  };
}

/**
 * Resolve everything the wall clock owes since the last read.
 *
 * The first MAX_PENDING_SWINGS unresolved intervals are real swings; every
 * interval past that is a bleed tick. That soft cap is the whole reason this is
 * playable: uncapped, an afternoon in meetings would end a run before the player
 * touched a card, and the run would be decided by their calendar rather than
 * their work. Capped hard, an abandoned run would be perfectly safe forever,
 * which is not a fight. Two swings then a trickle is the shape in between.
 *
 * `lastSwingMs` advances by whole intervals, never to `now`, so swings stay on
 * their original cadence instead of resetting every time the panel is opened.
 */
export function tickClock(state: CrawlState, ctx: CrawlContext): CrawlResult {
  const intervals = intervalsElapsed(state, ctx);
  if (intervals <= 0) return { state, events: [] };

  const events: CrawlEvent[] = [];
  let next: CrawlState = { ...state, lastSwingMs: state.lastSwingMs + intervals * ENEMY_SWING_INTERVAL_MS };

  for (let i = 0; i < intervals; i += 1) {
    const result = i < MAX_PENDING_SWINGS ? resolveSwing(next, ctx) : resolveBleed(next);
    next = result.state;
    events.push(...result.events);
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
  }

  return { state: next, events };
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

/**
 * Play the card at `handIndex`. Costs energy from today's pool. Rejects (state
 * unchanged, no events) when the run is over, it is not a fight, or the energy
 * is not there — the UI dims those cases, this is the backstop. A pinned todo
 * is NOT one of them: it shields the enemy, it does not stop the card.
 */
export function playCard(state: CrawlState, handIndex: number, ctx: CrawlContext): CrawlResult {
  const dayNormalized = normalizeDay(state, ctx.today);
  const synced = syncWard(dayNormalized, ctx);
  const base = synced.state;
  if (blockedReason(base, ctx) !== null) return { state: base, events: synced.events };
  if (base.status !== "fighting" || !base.enemy) return { state: base, events: synced.events };

  const cardId = base.hand[handIndex];
  const card = cardId ? getCard(cardId) : undefined;
  if (!card) return { state: base, events: synced.events };
  if (card.cost > energyAvailable(base, ctx)) return { state: base, events: synced.events };

  const events: CrawlEvent[] = [...synced.events];
  let next: CrawlState = {
    ...base,
    hand: base.hand.filter((_, i) => i !== handIndex),
    discard: [...base.discard, card.id],
    energyUsed: base.energyUsed + card.cost,
  };

  const effect = card.effect;
  const damage = outgoingDamage(effect.damage ?? 0, next, ctx);
  const enemy: EnemyState = { ...next.enemy! };

  // The ward eats damage before HP does, so a warded fight still progresses —
  // just at a fraction of the rate, and only for what spills past the shield.
  if (damage > 0) {
    const absorbed = Math.min(enemy.ward, damage);
    enemy.ward -= absorbed;
    enemy.hp = Math.max(0, enemy.hp - (damage - absorbed));
  }
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
 * Spend micro-gold credits to refill the hand's empty slots, one credit each.
 *
 * This replaced the "Draw" button. The button was asking the player to notice a
 * counter, decide, and click — three steps to get back a card the swing clock
 * would have handed over for free anyway. The credit's real value is only ever
 * IMMEDIACY, so the honest form is automatic: play a card, and the slot fills
 * behind it while you still have credits.
 *
 * Costs no energy and never touches the clock: a credit spent is not a move
 * made. A run whose energy is spent gains nothing from this, which is the
 * intended shape — micro-actions keep your options open, finished work is still
 * the only thing that pays to act.
 */
export function refillFromCredits(state: CrawlState, ctx: CrawlContext): CrawlResult {
  if (blockedReason(state, ctx) !== null) return { state, events: [] };
  if (state.status !== "fighting") return { state, events: [] };

  const events: CrawlEvent[] = [];
  let next = state;
  let credits = drawCreditsAvailable(state, ctx);

  while (credits > 0 && next.hand.length < HAND_SIZE) {
    // Nothing left anywhere to draw: stop rather than burn a credit on a no-op.
    if (next.drawPile.length === 0 && next.discard.length === 0) break;
    const drawn = drawCards(next, 1);
    if (drawn.hand.length === next.hand.length) break;
    next = { ...drawn, drawsUsed: next.drawsUsed + 1 };
    credits -= 1;
    events.push({ type: "cardDrawn", cardId: next.hand[next.hand.length - 1] });
  }

  return { state: next, events };
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

/** Everything a fresh room resets, shared by `chooseReward` and `descend`. */
function enterRoom(state: CrawlState, floor: number, room: number, nowMs: number): CrawlState {
  // You always walk into a room whole — HP is a per-fight resource, not a
  // run-long one. See ROOM_ENTRY_HEAL_FRACTION for why.
  const hp = Math.min(state.maxHp, Math.round(state.maxHp * ROOM_ENTRY_HEAL_FRACTION));
  const next: CrawlState = {
    ...state,
    floor,
    room,
    hp,
    block: 0,
    // Strength is a per-fight buff; a new room means a fresh enemy.
    strength: 0,
    status: "fighting",
    rewardChoices: [],
    // A ward covers the fight it was pinned during, so walking into the next
    // room retires the pin — a todo left undone cannot silently hobble the run.
    enemy: spawnEnemy(floor, room, false),
    wardTodoId: null,
    wardTodoTitle: null,
    // The new enemy starts its clock now, not whenever the last one died.
    lastSwingMs: nowMs,
    meta: { ...state.meta, bestFloor: Math.max(state.meta.bestFloor, floor) },
  };
  return drawCards(next, HAND_SIZE);
}

/**
 * Take a reward card and step out of the room. `cardId` may be null to skip the
 * card — keeping the deck lean is a real choice, and skipping is one click
 * rather than a menu.
 *
 * Clearing the last room of a floor lands on the floor-cleared screen instead of
 * the next fight. That screen is the ONLY place the run's depth is announced,
 * which is the trade that let the panel drop its permanent floor/room strip: a
 * number that is true all day earns nothing, the moment it changes earns a
 * whole screen.
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
  const withCard: CrawlState = {
    ...base,
    deck: cardId ? [...base.deck, cardId] : base.deck,
    discard: cardId ? [...base.discard, cardId] : base.discard,
  };

  if (base.room + 1 < ROOMS_PER_FLOOR) {
    return { state: enterRoom(withCard, base.floor, base.room + 1, ctx.nowMs), events };
  }

  events.push({ type: "floorCleared", floor: base.floor });
  const floor = base.floor + 1;
  return {
    state: {
      ...withCard,
      floor,
      room: 0,
      status: "floorCleared",
      enemy: null,
      rewardChoices: [],
      wardTodoId: null,
      wardTodoTitle: null,
      meta: { ...withCard.meta, bestFloor: Math.max(withCard.meta.bestFloor, floor) },
    },
    events,
  };
}

/**
 * Walk down from the floor-cleared screen into the first room of the next floor.
 * The floor number was already banked by `chooseReward`; this only opens the door.
 */
export function descend(state: CrawlState, ctx: CrawlContext): CrawlResult {
  if (state.status !== "floorCleared") return { state, events: [] };
  return { state: enterRoom(state, state.floor, 0, ctx.nowMs), events: [] };
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

/**
 * Pin a todo to the run, warding the current enemy until it is done. Nothing is
 * blocked — see `EnemyState.ward`. Passing null clears the pin and the shield.
 */
export function setWard(state: CrawlState, todoId: string | null, title: string | null): CrawlState {
  const next: CrawlState = {
    ...state,
    wardTodoId: todoId,
    wardTodoTitle: todoId ? title : null,
  };
  if (!state.enemy) return next;
  // Raise the shield the moment the pin lands, rather than waiting for the
  // enemy's next swing — otherwise pinning does nothing for half an hour.
  return { ...next, enemy: { ...state.enemy, ward: todoId ? WARD_AMOUNT : 0 } };
}
