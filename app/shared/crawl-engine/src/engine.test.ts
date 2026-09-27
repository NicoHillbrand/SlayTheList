import { describe, expect, it } from "vitest";
import {
  BLEED_DAMAGE,
  ENEMY_SWING_INTERVAL_MS,
  FLOORS,
  HAND_SIZE,
  MAX_PENDING_SWINGS,
  MICRO_TENTHS_PER_DRAW,
  MOMENTUM_DAMAGE,
  ROOMS_PER_FLOOR,
  START_HP,
  STARTING_DECK,
  WARD_AMOUNT,
  getCard,
} from "./content.js";
import {
  blockedReason,
  chooseReward,
  createCrawlState,
  descend,
  drawCreditsAvailable,
  energyAvailable,
  intervalsElapsed,
  msUntilNextSwing,
  playCard,
  refillFromCredits,
  restartRun,
  setWard,
  tickClock,
} from "./engine.js";
import type { CrawlContext, CrawlState } from "./types.js";

const TODAY = "2026-08-09";
const NOW = 1_770_000_000_000;

function ctx(over: Partial<CrawlContext> = {}): CrawlContext {
  return {
    goldEarnedToday: 25,
    microTenthsToday: 0,
    today: TODAY,
    momentum: false,
    wardCleared: true,
    nowMs: NOW,
    ...over,
  };
}

function fresh(): CrawlState {
  return createCrawlState(1234, NOW, TODAY);
}

/** Force a known card into the hand so a test does not depend on the shuffle. */
function withHand(state: CrawlState, hand: string[]): CrawlState {
  return { ...state, hand };
}

/** Let `intervals` swing intervals elapse and resolve whatever the clock owes. */
function after(state: CrawlState, intervals: number, over: Partial<CrawlContext> = {}) {
  return tickClock(state, ctx({ nowMs: NOW + intervals * ENEMY_SWING_INTERVAL_MS, ...over }));
}

describe("createCrawlState", () => {
  it("opens mid-fight with a full hand and no ceremony", () => {
    const state = fresh();
    expect(state.status).toBe("fighting");
    expect(state.enemy).not.toBeNull();
    expect(state.hand).toHaveLength(HAND_SIZE);
    expect(state.deck).toHaveLength(STARTING_DECK.length);
    expect(state.hp).toBe(START_HP);
  });

  it("starts the swing clock at the moment the run begins", () => {
    expect(fresh().lastSwingMs).toBe(NOW);
    expect(intervalsElapsed(fresh(), ctx())).toBe(0);
  });

  it("is deterministic for a given seed", () => {
    expect(createCrawlState(99, NOW, TODAY).hand).toEqual(createCrawlState(99, NOW, TODAY).hand);
  });
});

describe("energy", () => {
  it("is today's earned gold minus what the run already spent", () => {
    const state = withHand(fresh(), ["strike", "strike", "guard"]);
    expect(energyAvailable(state, ctx())).toBe(25);
    const played = playCard(state, 0, ctx()).state;
    expect(played.energyUsed).toBe(getCard("strike")!.cost);
    expect(energyAvailable(played, ctx())).toBe(25 - getCard("strike")!.cost);
  });

  it("expires at midnight instead of banking", () => {
    const spent = { ...fresh(), energyUsed: 9 };
    // Same day: the spend still counts.
    expect(energyAvailable(spent, ctx({ goldEarnedToday: 20 }))).toBe(11);
    // New day: the pool is whatever was earned today, with no carry-over debt.
    expect(energyAvailable(spent, ctx({ today: "2026-08-10", goldEarnedToday: 4 }))).toBe(4);
  });

  it("refuses a card the player cannot afford", () => {
    const state = withHand(fresh(), ["ember"]); // cost 3
    const result = playCard(state, 0, ctx({ goldEarnedToday: 2 }));
    expect(result.state).toEqual(state);
    expect(result.events).toHaveLength(0);
  });

  it("lets a zero-cost card through on a day with no gold at all", () => {
    const state = withHand(fresh(), ["ward"]);
    const result = playCard(state, 0, ctx({ goldEarnedToday: 0 }));
    expect(result.state.block).toBe(getCard("ward")!.effect.block);
  });
});

describe("micro-gold slot refills", () => {
  const TENTHS = MICRO_TENTHS_PER_DRAW;

  it("is today's tenths over the ratio, minus what the run already drew", () => {
    const state = fresh();
    expect(drawCreditsAvailable(state, ctx({ microTenthsToday: TENTHS * 2 }))).toBe(2);
    expect(drawCreditsAvailable({ ...state, drawsUsed: 1 }, ctx({ microTenthsToday: TENTHS * 2 }))).toBe(1);
  });

  it("rounds down: a partial credit buys nothing", () => {
    expect(drawCreditsAvailable(fresh(), ctx({ microTenthsToday: TENTHS - 1 }))).toBe(0);
  });

  it("expires at midnight instead of banking", () => {
    const drawn = { ...fresh(), drawsUsed: 2 };
    expect(drawCreditsAvailable(drawn, ctx({ microTenthsToday: TENTHS * 3 }))).toBe(1);
    // New day: the pool is what today's micro bought, with no carry-over debt.
    expect(
      drawCreditsAvailable(drawn, ctx({ today: "2026-08-10", microTenthsToday: TENTHS })),
    ).toBe(1);
  });

  it("fills an empty slot and spends exactly one credit", () => {
    const state = withHand(fresh(), ["strike", "guard"]);
    const { state: next, events } = refillFromCredits(state, ctx({ microTenthsToday: TENTHS }));
    expect(next.hand).toHaveLength(HAND_SIZE);
    expect(next.drawsUsed).toBe(1);
    expect(events[0]).toMatchObject({ type: "cardDrawn", cardId: next.hand[HAND_SIZE - 1] });
    expect(drawCreditsAvailable(next, ctx({ microTenthsToday: TENTHS }))).toBe(0);
  });

  it("fills every empty slot it can afford, in one go", () => {
    const state = withHand(fresh(), []);
    const { state: next } = refillFromCredits(state, ctx({ microTenthsToday: TENTHS * 2 }));
    expect(next.hand).toHaveLength(2);
    expect(next.drawsUsed).toBe(2);
  });

  it("never grows the hand past HAND_SIZE, and banks the unspent credits", () => {
    // Three cards is the hand, full stop: there is no overflow ceiling above it
    // any more, so a pile of micro-actions cannot make the panel taller.
    const rich = ctx({ microTenthsToday: TENTHS * 6 });
    const { state: next } = refillFromCredits(fresh(), rich);
    expect(next.hand).toHaveLength(HAND_SIZE);
    expect(next.drawsUsed).toBe(0);
    expect(drawCreditsAvailable(next, rich)).toBe(6);
  });

  it("costs no energy and does not move the swing clock", () => {
    const state = withHand(fresh(), ["strike"]);
    const { state: next } = refillFromCredits(state, ctx({ microTenthsToday: TENTHS * 2 }));
    expect(next.energyUsed).toBe(state.energyUsed);
    expect(next.lastSwingMs).toBe(state.lastSwingMs);
  });

  it("does nothing without a full credit", () => {
    const state = withHand(fresh(), ["strike"]);
    const result = refillFromCredits(state, ctx({ microTenthsToday: TENTHS - 1 }));
    expect(result.state).toEqual(state);
    expect(result.events).toHaveLength(0);
  });

  it("still refills while a todo is pinned — a ward shields the enemy, it does not stop you", () => {
    const warded = setWard(withHand(fresh(), ["strike"]), "todo-1", "Finish the thing");
    const result = refillFromCredits(warded, ctx({ microTenthsToday: TENTHS * 5, wardCleared: false }));
    expect(result.state.drawsUsed).toBe(2);
    expect(result.state.hand).toHaveLength(HAND_SIZE);
  });

  it("does not burn a credit when there is nothing left to draw", () => {
    const empty = { ...fresh(), hand: ["strike"], drawPile: [], discard: [] };
    const result = refillFromCredits(empty, ctx({ microTenthsToday: TENTHS }));
    expect(result.state.drawsUsed).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it("reshuffles the discard when the draw pile is dry", () => {
    const state = { ...fresh(), hand: ["strike"], drawPile: [], discard: ["ember", "hex"] };
    const { state: next } = refillFromCredits(state, ctx({ microTenthsToday: TENTHS }));
    expect(next.hand).toHaveLength(2);
    expect(next.discard).toHaveLength(0);
  });

  it("survives a restart: dying is not a draw refund", () => {
    const used = { ...fresh(), drawsUsed: 2 };
    const { state: next } = restartRun(used, 77, NOW, TODAY);
    expect(next.drawsUsed).toBe(2);
  });
});

describe("playCard", () => {
  it("deals damage, discards the card, and leaves the hand", () => {
    const state = withHand(fresh(), ["strike", "guard"]);
    const { state: next, events } = playCard(state, 0, ctx());
    expect(next.enemy!.hp).toBe(state.enemy!.maxHp - 6);
    expect(next.hand).toEqual(["guard"]);
    expect(next.discard).toEqual(["strike"]);
    expect(events[0]).toMatchObject({ type: "cardPlayed", damage: 6 });
  });

  it("leaves the empty slot alone — refilling is the caller's next step", () => {
    // The engine keeps the two apart so the API can decide whether a credit is
    // available. Nothing here silently conjures a card.
    const state = withHand(fresh(), ["strike", "guard", "lunge"]);
    expect(playCard(state, 0, ctx()).state.hand).toHaveLength(HAND_SIZE - 1);
  });

  it("does not move the swing clock: playing is not a turn", () => {
    const state = withHand(fresh(), ["strike"]);
    expect(playCard(state, 0, ctx()).state.lastSwingMs).toBe(state.lastSwingMs);
  });

  it("adds momentum damage when a todo was just completed", () => {
    const state = withHand(fresh(), ["strike"]);
    const plain = playCard(state, 0, ctx()).state.enemy!.hp;
    const boosted = playCard(state, 0, ctx({ momentum: true })).state.enemy!.hp;
    expect(plain - boosted).toBe(MOMENTUM_DAMAGE);
  });

  it("applies strength to every later attack but not to block", () => {
    let state = withHand(fresh(), ["whetstone", "strike", "guard"]);
    state = playCard(state, 0, ctx()).state; // +3 strength
    expect(state.strength).toBe(3);
    const struck = playCard(state, 0, ctx()).state;
    expect(state.enemy!.hp - struck.enemy!.hp).toBe(6 + 3);
    const guarded = playCard(state, 1, ctx()).state;
    expect(guarded.block).toBe(5);
  });

  it("draws immediately for cards that say so", () => {
    const state = { ...withHand(fresh(), ["scout"]), drawPile: ["strike", "guard", "lunge"] };
    const next = playCard(state, 0, ctx()).state;
    expect(next.hand).toEqual(["strike", "guard"]);
  });

  it("never draws past the hand cap", () => {
    const state = {
      ...withHand(fresh(), ["scout", "strike", "guard"]),
      drawPile: ["strike", "strike", "strike"],
    };
    const next = playCard(state, 0, ctx()).state;
    expect(next.hand.length).toBeLessThanOrEqual(HAND_SIZE);
  });
});

describe("the swing clock", () => {
  it("does nothing until a full interval has passed", () => {
    const state = fresh();
    const early = tickClock(state, ctx({ nowMs: NOW + ENEMY_SWING_INTERVAL_MS - 1 }));
    expect(early.state).toEqual(state);
    expect(early.events).toHaveLength(0);
  });

  it("swings once per interval and spends block before HP", () => {
    let state = withHand(fresh(), ["guard"]); // 5 block
    state = playCard(state, 0, ctx()).state;
    const attack = state.enemy!.attack;
    const next = after(state, 1).state;
    expect(next.block).toBe(0);
    expect(next.hp).toBe(START_HP - Math.max(0, attack - 5));
  });

  it("refills the hand on the swing, for free", () => {
    const state = { ...fresh(), hand: [], drawPile: ["strike", "guard", "lunge", "ward"] };
    const next = after(state, 1).state;
    expect(next.hand).toHaveLength(HAND_SIZE);
    expect(next.drawsUsed).toBe(0);
  });

  it("advances the clock by whole intervals, so swings keep their cadence", () => {
    // Not to `now`: opening the panel at 0:45 must not buy a fresh 30 minutes.
    const state = fresh();
    const next = tickClock(state, ctx({ nowMs: NOW + ENEMY_SWING_INTERVAL_MS * 1.5 })).state;
    expect(next.lastSwingMs).toBe(NOW + ENEMY_SWING_INTERVAL_MS);
    expect(msUntilNextSwing(next, ctx({ nowMs: NOW + ENEMY_SWING_INTERVAL_MS * 1.5 }))).toBe(
      ENEMY_SWING_INTERVAL_MS / 2,
    );
  });

  it("weaken softens the swing but never below 1", () => {
    const state = { ...fresh(), enemy: { ...fresh().enemy!, attack: 2, weakened: 10 } };
    expect(START_HP - after(state, 1).state.hp).toBe(1);
  });

  it("ends the run at zero HP and counts the loss", () => {
    const { state: dead, events } = after({ ...fresh(), hp: 1 }, 1);
    expect(dead.status).toBe("dead");
    expect(dead.hp).toBe(0);
    expect(dead.meta.runsLost).toBe(1);
    expect(events.some((e) => e.type === "died")).toBe(true);
  });

  it("caps full-strength swings at MAX_PENDING_SWINGS, then bleeds", () => {
    // The soft cap is the reason a calendar cannot end a run. An afternoon out
    // costs two real hits and then a trickle, not one hit every half hour.
    const state = fresh();
    const attack = state.enemy!.attack;
    const intervals = MAX_PENDING_SWINGS + 6;
    const { state: next, events } = after(state, intervals);
    const swings = events.filter((e) => e.type === "playerHit").length;
    const bleeds = events.filter((e) => e.type === "bled").length;
    expect(swings).toBe(MAX_PENDING_SWINGS);
    expect(bleeds).toBe(6);
    expect(START_HP - next.hp).toBe(attack * MAX_PENDING_SWINGS + BLEED_DAMAGE * 6);
  });

  it("bleeds slowly enough that a six-hour absence is survivable on any floor", () => {
    // The guard behind the cap's tuning: the boss hits hardest, so if the boss
    // fight survives half a day away, every fight does.
    const boss = { ...fresh(), enemy: { ...fresh().enemy!, attack: 11, boss: true } };
    const sixHours = (6 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    const next = after(boss, sixHours).state;
    expect(next.status).toBe("fighting");
    expect(next.hp).toBeGreaterThan(0);
  });

  it("a full night alone ends a deep run, but spares the opening fight", () => {
    // The other half of the tuning: an abandoned fight is not a safe one. The
    // curve falls out of the swing cap rather than being written anywhere —
    // two hits off a boss is most of the pool, two off a rat is nothing — and
    // that is the right shape. A newcomer's first fight forgives a night away;
    // floor five does not.
    const twelveHours = (12 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    const boss = { ...fresh(), enemy: { ...fresh().enemy!, attack: 11, boss: true } };
    expect(after(boss, twelveHours).state.status).toBe("dead");
    expect(after(fresh(), twelveHours).state.status).toBe("fighting");
  });

  it("is frozen on every screen that is not a fight", () => {
    // A player who leaves the panel on the reward screen owes nothing when they
    // come back — the clock belongs to the enemy in front of them.
    const week = (7 * 24 * 60 * 60 * 1000) / ENEMY_SWING_INTERVAL_MS;
    for (const status of ["reward", "floorCleared", "dead", "victory"] as const) {
      const parked = { ...fresh(), status, enemy: status === "reward" ? fresh().enemy : null };
      expect(after(parked, week).state, status).toEqual(parked);
    }
  });

  it("starts the next fight's clock fresh, not from the last one", () => {
    const won = { ...fresh(), status: "reward" as const, rewardChoices: ["ward"], enemy: null };
    const later = NOW + 5 * ENEMY_SWING_INTERVAL_MS;
    const next = chooseReward(won, null, ctx({ nowMs: later })).state;
    expect(next.lastSwingMs).toBe(later);
    expect(intervalsElapsed(next, ctx({ nowMs: later }))).toBe(0);
  });
});

describe("rewards and progression", () => {
  function killEnemy(state: CrawlState): CrawlState {
    return playCard({ ...state, enemy: { ...state.enemy!, hp: 1 }, hand: ["strike"] }, 0, ctx())
      .state;
  }

  it("offers three cards on a kill and none of them are starters", () => {
    const won = killEnemy(fresh());
    expect(won.status).toBe("reward");
    expect(won.rewardChoices).toHaveLength(3);
    expect(new Set(won.rewardChoices).size).toBe(3);
    for (const id of won.rewardChoices) expect(getCard(id)!.rarity).not.toBe("starter");
  });

  it("adds the chosen card to the deck and steps into the next room", () => {
    const won = killEnemy(fresh());
    const pick = won.rewardChoices[0];
    const next = chooseReward(won, pick, ctx()).state;
    expect(next.deck).toContain(pick);
    expect(next.deck).toHaveLength(STARTING_DECK.length + 1);
    expect(next.room).toBe(1);
    expect(next.status).toBe("fighting");
    expect(next.enemy!.hp).toBeGreaterThan(0);
    expect(next.hand).toHaveLength(HAND_SIZE);
  });

  it("lets the player skip the card to keep the deck lean", () => {
    const won = killEnemy(fresh());
    const next = chooseReward(won, null, ctx()).state;
    expect(next.deck).toHaveLength(STARTING_DECK.length);
    expect(next.room).toBe(1);
  });

  it("rejects a card that was not on offer", () => {
    const won = killEnemy(fresh());
    const notOffered = ["ward", "scout", "rally", "siphon", "whetstone", "cleave", "hex", "bulwark", "ember"]
      .find((id) => !won.rewardChoices.includes(id))!;
    expect(chooseReward(won, notOffered, ctx()).state).toEqual(won);
  });

  it("stops on the floor-cleared screen instead of walking straight into the next floor", () => {
    // The panel has no permanent depth readout any more, so this screen is the
    // one moment the run tells the player how deep they are. It has to be a
    // stop, not a flash.
    let state = fresh();
    for (let i = 0; i < ROOMS_PER_FLOOR - 1; i += 1) {
      state = chooseReward(killEnemy(state), null, ctx()).state;
    }
    const { state: cleared, events } = chooseReward(killEnemy(state), null, ctx());
    expect(cleared.status).toBe("floorCleared");
    expect(cleared.enemy).toBeNull();
    expect(cleared.floor).toBe(2);
    expect(cleared.room).toBe(0);
    expect(cleared.meta.bestFloor).toBe(2);
    expect(events.some((e) => e.type === "floorCleared")).toBe(true);
  });

  it("descend opens the first room of the banked floor at full HP", () => {
    let state = fresh();
    for (let i = 0; i < ROOMS_PER_FLOOR - 1; i += 1) {
      state = chooseReward(killEnemy(state), null, ctx()).state;
    }
    const cleared = chooseReward(killEnemy({ ...state, hp: 4 }), null, ctx()).state;
    const later = NOW + 9 * ENEMY_SWING_INTERVAL_MS;
    const next = descend(cleared, ctx({ nowMs: later })).state;
    expect(next.status).toBe("fighting");
    expect(next.floor).toBe(2);
    expect(next.room).toBe(0);
    expect(next.hp).toBe(next.maxHp);
    expect(next.hand).toHaveLength(HAND_SIZE);
    expect(next.lastSwingMs).toBe(later);
  });

  it("descend does nothing from anywhere else", () => {
    const state = fresh();
    expect(descend(state, ctx()).state).toEqual(state);
  });

  it("restores full HP on entering any room, so HP is a per-fight resource", () => {
    const won = killEnemy({ ...fresh(), hp: 3 });
    const next = chooseReward(won, null, ctx()).state;
    expect(next.room).toBe(1);
    expect(next.hp).toBe(next.maxHp);
  });

  it("clears strength between rooms", () => {
    const won = { ...killEnemy(fresh()), strength: 9 };
    expect(chooseReward(won, null, ctx()).state.strength).toBe(0);
  });

  it("wins the run on the boss and asks the caller to pay the gold", () => {
    const atBoss: CrawlState = {
      ...fresh(),
      floor: FLOORS,
      room: ROOMS_PER_FLOOR - 1,
      enemy: { ...fresh().enemy!, hp: 1, boss: true },
    };
    const { state: won, events } = playCard({ ...atBoss, hand: ["strike"] }, 0, ctx());
    expect(won.status).toBe("victory");
    expect(won.meta.runsWon).toBe(1);
    const reward = events.find((e) => e.type === "runWon");
    expect(reward).toMatchObject({ type: "runWon", goldReward: 10 });
  });
});

describe("todo wards", () => {
  const pinned = () => setWard(withHand(fresh(), ["strike", "lunge"]), "todo-1", "Write the migration");
  const outstanding = ctx({ wardCleared: false });

  it("shields the enemy instead of freezing the run", () => {
    const warded = pinned();
    expect(warded.enemy!.ward).toBe(WARD_AMOUNT);
    // The whole point of the change: a pin is never a reason you cannot act.
    expect(blockedReason(warded, outstanding)).toBeNull();
  });

  it("still lets every action through while the todo is outstanding", () => {
    const warded = pinned();
    expect(playCard(warded, 0, outstanding).state).not.toEqual(warded);
    const atReward = { ...warded, status: "reward" as const, rewardChoices: ["ward"] };
    expect(chooseReward(atReward, null, outstanding).state.room).not.toBe(warded.room);
  });

  it("eats damage before HP, so a hit lands but barely counts", () => {
    const warded = pinned();
    const strike = getCard("strike")!.effect.damage!; // 6 vs a ward of 5
    const after = playCard(warded, 0, outstanding).state;
    expect(after.enemy!.ward).toBe(0);
    expect(after.enemy!.maxHp - after.enemy!.hp).toBe(strike - WARD_AMOUNT);
  });

  it("regenerates the shield on the enemy's swing — progress cannot be banked", () => {
    const broken = playCard(pinned(), 0, outstanding).state;
    expect(broken.enemy!.ward).toBe(0);
    expect(after(broken, 1, { wardCleared: false }).state.enemy!.ward).toBe(WARD_AMOUNT);
  });

  it("shatters the shield the moment the todo is done", () => {
    const warded = pinned();
    const { state: next, events } = playCard(warded, 0, ctx()); // ctx() = wardCleared
    expect(events).toContainEqual({ type: "wardShattered" });
    // Full damage lands: nothing absorbed it.
    expect(next.enemy!.maxHp - next.enemy!.hp).toBe(getCard("strike")!.effect.damage);
  });

  it("stops regenerating once the todo is done", () => {
    expect(after(pinned(), 1).state.enemy!.ward).toBe(WARD_AMOUNT);
    // syncWard runs on the player's next action, which is what actually clears it.
    expect(playCard(pinned(), 0, ctx()).state.enemy!.ward).toBe(0);
  });

  it("retires the ward when the player moves to the next room", () => {
    const won = setWard({ ...fresh(), status: "reward", rewardChoices: ["ward"] }, "t", "Ship it");
    const next = chooseReward(won, "ward", outstanding).state;
    expect(next.wardTodoId).toBeNull();
    expect(next.wardTodoTitle).toBeNull();
    // And the fresh enemy is unshielded, so an unfinished pin cannot follow the
    // player through the whole run.
    expect(next.enemy!.ward).toBe(0);
  });

  it("clears the shield when the pin is removed", () => {
    expect(setWard(pinned(), null, null).enemy!.ward).toBe(0);
  });
});

describe("restartRun", () => {
  it("keeps meta and does not refund the day's energy", () => {
    const dead: CrawlState = {
      ...fresh(),
      status: "dead",
      energyUsed: 12,
      meta: { bestFloor: 3, runsWon: 1, runsLost: 2, kills: 17 },
    };
    const next = restartRun(dead, 555, NOW, TODAY).state;
    expect(next.status).toBe("fighting");
    expect(next.floor).toBe(1);
    expect(next.hp).toBe(START_HP);
    expect(next.energyUsed).toBe(12);
    expect(next.meta).toEqual(dead.meta);
  });

  it("starts the swing clock fresh, so a restart is not instantly hit", () => {
    const dead = { ...fresh(), status: "dead" as const, lastSwingMs: NOW - 99 * ENEMY_SWING_INTERVAL_MS };
    const later = NOW + 4 * ENEMY_SWING_INTERVAL_MS;
    const next = restartRun(dead, 555, later, TODAY).state;
    expect(next.lastSwingMs).toBe(later);
    expect(intervalsElapsed(next, ctx({ nowMs: later }))).toBe(0);
  });

  it("starts the new day clean when the restart crosses midnight", () => {
    const dead = { ...fresh(), status: "dead" as const, energyUsed: 12 };
    const next = restartRun(dead, 555, NOW, "2026-08-10").state;
    expect(next.energyUsed).toBe(0);
  });
});

describe("draw pile", () => {
  it("reshuffles the discard when the draw pile runs dry", () => {
    const state = { ...fresh(), hand: [], drawPile: [], discard: ["strike", "guard", "lunge"] };
    const next = after(state, 1).state;
    // The swing refills the hand, so all three come back out of the reshuffle.
    expect(next.hand).toHaveLength(3);
    expect(next.drawPile.length + next.discard.length).toBe(0);
  });

  it("refills the hand rather than topping it up by one", () => {
    const state = { ...fresh(), hand: ["strike"], drawPile: ["guard", "lunge", "ward"], discard: [] };
    const next = after(state, 1).state;
    expect(next.hand).toHaveLength(HAND_SIZE);
    // The card that was already in hand is still there — nothing is discarded.
    expect(next.hand[0]).toBe("strike");
  });

  it("does not hang when there is nothing left to draw", () => {
    const state = { ...fresh(), hand: [], drawPile: [], discard: [] };
    expect(after(state, 1).state.hand).toEqual([]);
  });
});
