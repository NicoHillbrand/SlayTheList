/**
 * Pacing and balance guards.
 *
 * The unit tests in `engine.test.ts` check that rules do what they say. These
 * check that the resulting GAME is the one we meant to build:
 *
 *  - a full run is beatable by a competent player, not just a perfect one;
 *  - it costs days of real work, not minutes, because energy is earned gold;
 *  - the late floors are hard, not arithmetically impossible.
 *
 * A reference policy stands in for that competent player: spend what the day
 * bought, brace when low, and let the clock run when there is nothing to play.
 * It is deliberately simple — if the run needs cleverer play than this to be
 * winnable, the run is too hard.
 */
import { describe, expect, it } from "vitest";
import {
  ENEMY_SWING_INTERVAL_MS,
  FLOORS,
  HAND_SIZE,
  MAX_PENDING_SWINGS,
  MICRO_TENTHS_PER_DRAW,
  ROOMS_PER_FLOOR,
  START_HP,
  TOTAL_ROOMS,
  WARD_AMOUNT,
  getCard,
} from "./content.js";
import {
  blockedReason,
  chooseReward,
  createCrawlState,
  descend,
  playCard,
  refillFromCredits,
  setWard,
  tickClock,
} from "./engine.js";
import type { CardId, CrawlContext, CrawlState } from "./types.js";

const TODAY = "2026-08-09";
const NOW = 1_770_000_000_000;

/** Reward preference: a reasonable player takes the strong cards on offer. */
const REWARD_RANK: CardId[] = [
  "ember",
  "cleave",
  "bulwark",
  "hex",
  "whetstone",
  "siphon",
  "rally",
  "ward",
  "scout",
];

/** Energy the reference player banks before opening an exchange. Roughly a hand. */
const BURST_TARGET = 6;

function ctx(goldEarnedToday: number, nowMs = NOW, microTenthsToday = 0): CrawlContext {
  return { goldEarnedToday, microTenthsToday, today: TODAY, momentum: false, wardCleared: true, nowMs };
}

interface RunOutcome {
  state: CrawlState;
  /** Energy spent, i.e. gold that had to be earned to finish. */
  energySpent: number;
  /** Enemy swings taken across the whole run. */
  swings: number;
}

/**
 * Play a whole run with the reference policy against a fixed daily budget.
 * `goldPerDay` is topped back up whenever the policy runs dry, and each top-up
 * counts as one day, so `energySpent` doubles as "days of work x goldPerDay".
 *
 * Time only moves when the player has nothing left to do — the clock is the
 * thing that hands back cards, so waiting is the reference player's version of
 * "end turn". Crucially it advances by ONE interval at a time, never by the
 * hours a real absence would take: this measures the cost of a run in work, and
 * bleed damage is a cost in inattention.
 */
function playReferenceRun(seed: number, goldPerDay: number): RunOutcome {
  let state = createCrawlState(seed, NOW, TODAY);
  let budget = goldPerDay;
  let nowMs = NOW;
  let swings = 0;
  let spent = 0;

  const wait = () => {
    nowMs += ENEMY_SWING_INTERVAL_MS;
    const ticked = tickClock(state, ctx(budget, nowMs));
    swings += ticked.events.filter((e) => e.type === "playerHit").length;
    state = ticked.state;
  };

  for (let step = 0; step < 20_000; step += 1) {
    if (state.status === "dead" || state.status === "victory") break;

    if (state.status === "floorCleared") {
      state = descend(state, ctx(budget, nowMs)).state;
      continue;
    }

    if (state.status === "reward") {
      const pick = REWARD_RANK.find((id) => state.rewardChoices.includes(id)) ?? null;
      state = chooseReward(state, pick, ctx(budget, nowMs)).state;
      continue;
    }

    const enemy = state.enemy!;
    const incoming = Math.max(1, enemy.attack - enemy.weakened);
    // Brace when the coming hit would take a real bite out of the pool.
    const brace = incoming - state.block >= Math.min(state.hp, state.hp * 0.5);

    const available = budget - state.energyUsed;
    const affordable = state.hand
      .map((id, i) => ({ i, card: getCard(id)! }))
      .filter(({ card }) => card.cost <= available);

    // Bank before opening an exchange. One enemy swing costs the same whether
    // you answered it with one card or three, so dribbling the last of the pool
    // into a fight is strictly the worst line — a competent player comes back
    // after a chunk of real work and empties the hand between two swings.
    const handCost = state.hand.reduce((sum, id) => sum + getCard(id)!.cost, 0);
    if (available < Math.min(handCost, BURST_TARGET)) {
      budget += goldPerDay;
      continue;
    }

    if (affordable.length === 0) {
      // Nothing playable: let the clock hand back a hand, and take the hit.
      wait();
      continue;
    }

    const best = affordable.reduce((a, b) => {
      const score = (c: (typeof affordable)[number]) => {
        const dmg = c.card.effect.damage ?? 0;
        const blk = c.card.effect.block ?? 0;
        return brace ? blk * 4 + dmg : dmg * 3 + blk;
      };
      return score(b) > score(a) ? b : a;
    });

    const before = state.energyUsed;
    const played = playCard(state, best.i, ctx(budget, nowMs));
    if (played.state === state) break; // policy stuck; let the assertions report it
    spent += played.state.energyUsed - before;
    state = played.state;

    // Spend the hand down, then let the clock refill it.
    const stillAffordable = state.hand.some((id) => getCard(id)!.cost <= budget - state.energyUsed);
    if (state.status === "fighting" && !stillAffordable) wait();
  }

  return { state, energySpent: spent, swings };
}

describe("a full run is winnable", () => {
  // Several seeds: the reward roll varies, and the run must not hinge on it.
  const seeds = [1, 7, 42, 1234, 99991];

  it("the reference player clears all five floors on every seed", () => {
    for (const seed of seeds) {
      const { state } = playReferenceRun(seed, 25);
      expect(
        { seed, status: state.status, floor: state.floor, room: state.room },
        `seed ${seed} failed to clear`,
      ).toMatchObject({ status: "victory" });
    }
  });

  it("clearing the boss reaches the last room of the last floor", () => {
    const { state } = playReferenceRun(42, 25);
    expect(state.meta.runsWon).toBe(1);
    expect(state.meta.bestFloor).toBe(FLOORS);
    expect(state.meta.kills).toBe(TOTAL_ROOMS);
    expect(TOTAL_ROOMS).toBe(FLOORS * ROOMS_PER_FLOOR);
  });
});

describe("a run costs days of real work", () => {
  it("spends far more energy than a single good day provides", () => {
    const { energySpent } = playReferenceRun(42, 25);
    // A good day is ~25 gold. A run must not be affordable in one sitting,
    // or the game stops being paid for by real work.
    expect(energySpent).toBeGreaterThan(60);
    // Nor should it be a grind measured in months.
    expect(energySpent).toBeLessThan(400);
  });

  it("costs about the same energy however fast the gold arrives", () => {
    // Energy buys cards, not time, so a productive week should finish the run
    // SOONER, not CHEAPER. Both budgets should land in the same ballpark.
    const lean = playReferenceRun(42, 10).energySpent;
    const rich = playReferenceRun(42, 60).energySpent;
    expect(Math.abs(rich - lean) / Math.max(lean, 1)).toBeLessThan(0.6);
  });
});

describe("the clock pressures, it does not decide", () => {
  it("a run left completely alone dies without the player ever acting", () => {
    // The point of dropping turns: time is now a real cost. An untouched fight
    // is losing, slowly.
    let state = createCrawlState(42, NOW, TODAY);
    const day = (24 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    state = tickClock(state, ctx(0, NOW + day * ENEMY_SWING_INTERVAL_MS)).state;
    expect(state.status).toBe("dead");
  });

  it("but an afternoon away is a wound, not a death, on every floor", () => {
    // The soft cap earning its keep. Without it the run would be decided by the
    // player's calendar rather than their work: every meeting over half an hour
    // would be another full hit, and a day of them would be fatal from full HP.
    const sixHours = (6 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    for (let floor = 1; floor <= FLOORS; floor += 1) {
      for (let room = 0; room < ROOMS_PER_FLOOR; room += 1) {
        const base = createCrawlState(42, NOW, TODAY);
        // Drop the player into that room's fight at full HP, as they always are.
        let state: CrawlState = { ...base, floor, room };
        state = chooseReward(
          { ...state, status: "reward", rewardChoices: [], enemy: null, room: Math.max(0, room - 1) },
          null,
          ctx(0),
        ).state;
        if (state.status === "floorCleared") state = descend(state, ctx(0)).state;
        const after = tickClock(state, ctx(0, NOW + sixHours * ENEMY_SWING_INTERVAL_MS)).state;
        expect(after.status, `floor ${after.floor} room ${after.room}`).toBe("fighting");
        expect(after.hp, `floor ${after.floor} room ${after.room}`).toBeGreaterThan(0);
      }
    }
  });

  it("caps the damage an absence can do, however long it runs", () => {
    // Two hits, then the trickle. Ten minutes away and ten hours away differ by
    // bleed, not by a hail of swings.
    const state = createCrawlState(42, NOW, TODAY);
    const week = (7 * 24 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    const events = tickClock(state, ctx(0, NOW + week * ENEMY_SWING_INTERVAL_MS)).events;
    expect(events.filter((e) => e.type === "playerHit")).toHaveLength(MAX_PENDING_SWINGS);
  });
});

describe("micro-gold buys options, not power", () => {
  it("a day of nothing but micro-actions cannot advance the run at all", () => {
    // The failure this guards against: micro-gold quietly becoming a second
    // energy source, so a session of small ticks substitutes for finishing
    // something. No gold earned today means no card can be played, however many
    // credits are banked.
    const state = createCrawlState(42, NOW, TODAY);
    const rich = ctx(0, NOW, MICRO_TENTHS_PER_DRAW * 20);
    const refilled = refillFromCredits(state, rich).state;
    // A full hand, and nothing to do with it: every card in the deck costs
    // energy except the free ones, which are rewards not yet offered.
    expect(refilled.hand).toHaveLength(HAND_SIZE);
    for (let i = 0; i < refilled.hand.length; i += 1) {
      expect(playCard(refilled, i, rich).events).toHaveLength(0);
    }
    expect(refilled.room).toBe(0);
    expect(refilled.floor).toBe(1);
  });

  it("only ever buys back time the clock would have given away", () => {
    // The ceiling on what a credit is worth: a hand refilled by micro-gold and a
    // hand refilled by the enemy's swing are the same hand. The credit's whole
    // value is arriving sooner — and not taking the hit that came with it.
    const played = { ...createCrawlState(42, NOW, TODAY), hand: ["strike"] };
    const byCredit = refillFromCredits(played, ctx(0, NOW, MICRO_TENTHS_PER_DRAW * 2)).state;
    const byClock = tickClock(played, ctx(0, NOW + ENEMY_SWING_INTERVAL_MS)).state;
    expect(byCredit.hand).toHaveLength(HAND_SIZE);
    expect(byClock.hand).toHaveLength(HAND_SIZE);
    expect(byCredit.hp).toBe(START_HP);
    expect(byClock.hp).toBeLessThan(START_HP);
  });

  it("costs a finished todo's worth of micro to match one todo's energy", () => {
    // Ten tenths make a gold, so a 5-gold todo is 50 micro-actions. Micro should
    // stay the faster loop, not the cheaper one: at 3 tenths a refill, those same
    // 50 tenths hand out 16 cards long before they add 5 energy.
    const todoWorthInTenths = 50;
    const refills = Math.floor(todoWorthInTenths / MICRO_TENTHS_PER_DRAW);
    expect(refills).toBeGreaterThan(HAND_SIZE * 2);
    expect(MICRO_TENTHS_PER_DRAW).toBeLessThan(10);
  });
});

describe("a pinned todo is a reward, not a wall", () => {
  const warded = () => setWard(createCrawlState(42, NOW, TODAY), "todo-1", "Send the email");
  const outstanding = (nowMs = NOW): CrawlContext => ({ ...ctx(25, nowMs), wardCleared: false });

  it("never stops the player acting, whatever is pinned", () => {
    // This is the property the hard freeze got wrong. Finishing the pinned todo
    // has to EARN a good hit; if the run is frozen, it merely removes a wall,
    // and there is no reward left to feel.
    let state = warded();
    let nowMs = NOW;
    let played = 0;
    for (let i = 0; i < 6 && state.status === "fighting"; i += 1) {
      const next = playCard(state, 0, outstanding(nowMs));
      if (next.state !== state) played += 1;
      state = next.state;
      nowMs += ENEMY_SWING_INTERVAL_MS;
      state = tickClock(state, outstanding(nowMs)).state;
    }
    expect(played).toBeGreaterThan(0);
    expect(blockedReason(state, outstanding(nowMs))).toBeNull();
  });

  it("makes the fight cost more, so finishing the todo visibly pays", () => {
    // Same seed, same cards, same energy — the only difference is whether the
    // pinned work is done. The gap between them IS the reward.
    const damageOver = (wardCleared: boolean) => {
      let state = warded();
      let nowMs = NOW;
      for (let i = 0; i < 6 && state.status === "fighting"; i += 1) {
        const c = { ...ctx(25, nowMs), wardCleared };
        const next = playCard(state, 0, c);
        state = next.state === state ? state : next.state;
        nowMs += ENEMY_SWING_INTERVAL_MS;
        state = tickClock(state, { ...ctx(25, nowMs), wardCleared }).state;
      }
      return state.enemy === null ? Infinity : state.enemy.maxHp - state.enemy.hp;
    };
    const withWork = damageOver(true);
    const withoutWork = damageOver(false);
    expect(withoutWork).toBeLessThan(withWork);
    // But not to zero: a warded fight still progresses, it is just expensive.
    expect(withoutWork).toBeGreaterThan(0);
  });

  it("cannot be outlasted — the shield returns on every swing", () => {
    let state = warded();
    let nowMs = NOW;
    for (let i = 0; i < 4; i += 1) {
      state = playCard(state, 0, outstanding(nowMs)).state;
      nowMs += ENEMY_SWING_INTERVAL_MS;
      state = tickClock(state, outstanding(nowMs)).state;
    }
    expect(state.enemy!.ward).toBe(WARD_AMOUNT);
  });
});

describe("the run is hard, not impossible", () => {
  it("the boss actually threatens: a player who never blocks dies", () => {
    let state = createCrawlState(42, NOW, TODAY);
    let nowMs = NOW;
    // Drop the reference player straight onto the boss with a full pool.
    state = {
      ...state,
      floor: FLOORS,
      room: ROOMS_PER_FLOOR - 1,
      enemy: {
        name: "The Hollow King",
        glyph: "👑",
        hp: 120,
        maxHp: 120,
        attack: 11,
        weakened: 0,
        ward: 0,
        boss: true,
      },
      hand: ["strike", "strike", "strike"],
      drawPile: Array<CardId>(40).fill("strike"),
      discard: [],
    };

    // Strikes only, never a block: 120 HP at 6 damage a card is far too slow
    // against a swing every half hour.
    for (let i = 0; i < 200 && state.status === "fighting"; i += 1) {
      const played = playCard(state, 0, ctx(500, nowMs));
      state = played.state;
      if (state.hand.length === 0 || played.state === state) {
        nowMs += ENEMY_SWING_INTERVAL_MS;
        state = tickClock(state, ctx(500, nowMs)).state;
      }
    }
    expect(state.status).toBe("dead");
  });

  it("a fresh player starts with a survivable first fight", () => {
    const state = createCrawlState(42, NOW, TODAY);
    // Room one must be beatable inside the opening HP pool with the opening
    // deck, or the game rejects newcomers on the first screen.
    expect(state.enemy!.hp).toBeLessThan(START_HP);
    expect(state.enemy!.attack * MAX_PENDING_SWINGS).toBeLessThan(START_HP / 2);
  });
});
