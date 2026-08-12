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
 * A reference policy stands in for that competent player: brace when a heavy
 * blow is telegraphed, otherwise hit as hard as the energy allows. It is
 * deliberately simple — if the run needs cleverer play than this to be
 * winnable, the run is too hard.
 */
import { describe, expect, it } from "vitest";
import {
  FLOORS,
  HAND_SIZE,
  MICRO_TENTHS_PER_DRAW,
  ROOMS_PER_FLOOR,
  START_HP,
  TOTAL_ROOMS,
  WARD_AMOUNT,
  getCard,
} from "./content.js";
import {
  blockedReason,
  canEndTurn,
  chooseReward,
  createCrawlState,
  drawExtraCard,
  endTurn,
  playCard,
  setWard,
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

/** Energy the reference player banks before opening a turn. Roughly a hand. */
const BURST_TARGET = 6;

function ctx(goldEarnedToday: number, microTenthsToday = 0): CrawlContext {
  return { goldEarnedToday, microTenthsToday, today: TODAY, momentum: false, wardCleared: true, nowMs: NOW };
}

interface RunOutcome {
  state: CrawlState;
  /** Energy spent, i.e. gold that had to be earned to finish. */
  energySpent: number;
  /** Enemy swings taken across the whole run. */
  enemyTurns: number;
}

/**
 * Play a whole run with the reference policy against a fixed daily budget.
 * `goldPerDay` is topped back up whenever the policy runs dry, and each top-up
 * counts as one day, so `energySpent` doubles as "days of work x goldPerDay".
 */
function playReferenceRun(seed: number, goldPerDay: number): RunOutcome {
  let state = createCrawlState(seed, NOW, TODAY);
  let budget = goldPerDay;
  let enemyTurns = 0;
  let spent = 0;

  for (let step = 0; step < 20_000; step += 1) {
    if (state.status === "dead" || state.status === "victory") break;

    if (state.status === "reward") {
      const pick = REWARD_RANK.find((id) => state.rewardChoices.includes(id)) ?? null;
      state = chooseReward(state, pick, ctx(budget)).state;
      continue;
    }

    const enemy = state.enemy!;
    const swing = Math.max(1, enemy.attack - enemy.weakened);
    const heavyNext = enemy.turnsUntilHeavy <= 1;
    const incoming = swing * (heavyNext ? 2 : 1);
    // Brace when the coming hit would take a real bite out of the pool.
    const brace = incoming - state.block >= Math.min(state.hp, state.hp * 0.5);

    const available = budget - state.energyUsed;
    const affordable = state.hand
      .map((id, i) => ({ i, card: getCard(id)! }))
      .filter(({ card }) => card.cost <= available);

    // Bank before opening a turn. One enemy swing costs the same whether you
    // answered it with one card or four, so dribbling the last of the pool into
    // a fight is strictly the worst line — a competent player comes back after
    // a chunk of real work and empties the hand in one exchange.
    const handCost = state.hand.reduce((sum, id) => sum + getCard(id)!.cost, 0);
    if (!state.playedThisTurn && available < Math.min(handCost, BURST_TARGET)) {
      budget += goldPerDay;
      continue;
    }

    if (affordable.length === 0) {
      if (canEndTurn(state)) {
        enemyTurns += 1;
        state = endTurn(state, ctx(budget)).state;
        continue;
      }
      // Out of energy with nothing free to play: another day of work.
      budget += goldPerDay;
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
    const played = playCard(state, best.i, ctx(budget));
    if (played.state === state) break; // policy stuck; let the assertions report it
    spent += played.state.energyUsed - before;
    state = played.state;

    // Spend the hand down, then let the enemy answer.
    const stillAffordable = state.hand.some((id) => getCard(id)!.cost <= budget - state.energyUsed);
    if (state.status === "fighting" && !stillAffordable && canEndTurn(state)) {
      enemyTurns += 1;
      state = endTurn(state, ctx(budget)).state;
    }
  }

  return { state, energySpent: spent, enemyTurns };
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

describe("micro-gold buys options, not power", () => {
  it("a day of nothing but micro-actions cannot advance the run at all", () => {
    // The failure this guards against: micro-gold quietly becoming a second
    // energy source, so a session of small ticks substitutes for finishing
    // something. No gold earned today means no card can be played, however many
    // draw credits are banked.
    let state = createCrawlState(42, NOW, TODAY);
    const rich = ctx(0, MICRO_TENTHS_PER_DRAW * 20);
    for (let i = 0; i < 20; i += 1) {
      const drawn = drawExtraCard(state, rich);
      if (drawn.state === state) break;
      state = drawn.state;
    }
    // A big hand, and nothing to do with it: every card in the deck costs energy
    // except the free ones, which are rewards the player has not been offered yet.
    expect(state.hand.length).toBeGreaterThan(HAND_SIZE);
    for (let i = 0; i < state.hand.length; i += 1) {
      expect(playCard(state, i, rich).events).toHaveLength(0);
    }
    expect(state.room).toBe(0);
    expect(state.floor).toBe(1);
  });

  it("costs a finished todo's worth of micro to match one todo's energy", () => {
    // Ten tenths make a gold, so a 5-gold todo is 50 micro-actions. Micro should
    // stay the faster loop, not the cheaper one: at 3 tenths a draw, those same
    // 50 tenths hand out 16 draws long before they add 5 energy.
    const todoWorthInTenths = 50;
    const draws = Math.floor(todoWorthInTenths / MICRO_TENTHS_PER_DRAW);
    expect(draws).toBeGreaterThan(HAND_SIZE * 2);
    expect(MICRO_TENTHS_PER_DRAW).toBeLessThan(10);
  });
});

describe("a pinned todo is a reward, not a wall", () => {
  const warded = () => setWard(createCrawlState(42, NOW, TODAY), "todo-1", "Send the email");
  const outstanding = { ...ctx(25), wardCleared: false };

  it("never stops the player acting, whatever is pinned", () => {
    // This is the property the hard freeze got wrong. Finishing the pinned todo
    // has to EARN a good turn; if the run is frozen, it merely removes a wall,
    // and there is no reward left to feel.
    let state = warded();
    let played = 0;
    for (let i = 0; i < 6 && state.status === "fighting"; i += 1) {
      const next = playCard(state, 0, outstanding);
      if (next.state !== state) played += 1;
      state = next.state;
      if (canEndTurn(state)) state = endTurn(state, outstanding).state;
    }
    expect(played).toBeGreaterThan(0);
    expect(blockedReason(state, outstanding)).toBeNull();
  });

  it("makes the fight cost more, so finishing the todo visibly pays", () => {
    // Same seed, same cards, same energy — the only difference is whether the
    // pinned work is done. The gap between them IS the reward.
    const damageOver = (c: CrawlContext) => {
      let state = warded();
      for (let i = 0; i < 6 && state.status === "fighting"; i += 1) {
        const next = playCard(state, 0, c);
        state = next.state === state ? state : next.state;
        if (canEndTurn(state)) state = endTurn(state, c).state;
      }
      return state.enemy === null ? Infinity : state.enemy.maxHp - state.enemy.hp;
    };
    const withWork = damageOver(ctx(25));
    const withoutWork = damageOver(outstanding);
    expect(withoutWork).toBeLessThan(withWork);
    // But not to zero: a warded fight still progresses, it is just expensive.
    expect(withoutWork).toBeGreaterThan(0);
  });

  it("cannot be outlasted — the shield returns every turn", () => {
    let state = warded();
    for (let i = 0; i < 4; i += 1) {
      state = playCard(state, 0, outstanding).state;
      if (canEndTurn(state)) state = endTurn(state, outstanding).state;
    }
    expect(state.enemy!.ward).toBe(WARD_AMOUNT);
  });
});

describe("the run is hard, not impossible", () => {
  it("the boss actually threatens: a player who never blocks dies", () => {
    let state = createCrawlState(42, NOW, TODAY);
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
        turnsUntilHeavy: 3,
        boss: true,
      },
      hand: ["strike", "strike", "strike", "strike"],
      drawPile: Array<CardId>(40).fill("strike"),
      discard: [],
    };

    // Strikes only, never a block: 120 HP at 6 damage a card is far too slow.
    for (let i = 0; i < 200 && state.status === "fighting"; i += 1) {
      const played = playCard(state, 0, ctx(500));
      state = played.state === state ? endTurn(state, ctx(500)).state : played.state;
      if (canEndTurn(state) && state.hand.length === 0) state = endTurn(state, ctx(500)).state;
    }
    expect(state.status).toBe("dead");
  });

  it("a fresh player starts with a survivable first fight", () => {
    const state = createCrawlState(42, NOW, TODAY);
    // Room one must be beatable inside the opening HP pool with the opening
    // deck, or the game rejects newcomers on the first screen.
    expect(state.enemy!.hp).toBeLessThan(START_HP);
    expect(state.enemy!.attack * 2).toBeLessThan(START_HP / 2);
  });
});
