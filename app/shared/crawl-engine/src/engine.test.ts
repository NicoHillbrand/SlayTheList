import { describe, expect, it } from "vitest";
import {
  FLOORS,
  HAND_SIZE,
  HEAVY_EVERY,
  HEAVY_MULTIPLIER,
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
  canEndTurn,
  chooseReward,
  createCrawlState,
  drawCreditsAvailable,
  drawExtraCard,
  endTurn,
  energyAvailable,
  playCard,
  restartRun,
  setWard,
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

/** Pretend a card was already played, so the enemy is allowed to swing. */
function armed(state: CrawlState): CrawlState {
  return { ...state, playedThisTurn: true };
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

  it("is deterministic for a given seed", () => {
    expect(createCrawlState(99, NOW, TODAY).hand).toEqual(createCrawlState(99, NOW, TODAY).hand);
  });
});

describe("energy", () => {
  it("is today's earned gold minus what the run already spent", () => {
    const state = withHand(fresh(), ["strike", "strike", "guard", "guard"]);
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

describe("micro-gold draw credits", () => {
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

  it("draws a card and spends exactly one credit", () => {
    const state = withHand(fresh(), ["strike"]);
    const { state: next, events } = drawExtraCard(state, ctx({ microTenthsToday: TENTHS }));
    expect(next.hand).toHaveLength(2);
    expect(next.drawsUsed).toBe(1);
    expect(events[0]).toMatchObject({ type: "cardDrawn", cardId: next.hand[1] });
    expect(drawCreditsAvailable(next, ctx({ microTenthsToday: TENTHS }))).toBe(0);
  });

  it("overflows past the hand cap — that is the whole effect", () => {
    const full = fresh();
    expect(full.hand).toHaveLength(HAND_SIZE);
    const { state: next } = drawExtraCard(full, ctx({ microTenthsToday: TENTHS }));
    expect(next.hand).toHaveLength(HAND_SIZE + 1);
  });

  it("costs no energy and does not provoke the enemy", () => {
    const state = fresh();
    const { state: next } = drawExtraCard(state, ctx({ microTenthsToday: TENTHS }));
    expect(next.energyUsed).toBe(state.energyUsed);
    expect(next.playedThisTurn).toBe(false);
    expect(canEndTurn(next)).toBe(false);
  });

  it("refuses without a full credit", () => {
    const state = fresh();
    const result = drawExtraCard(state, ctx({ microTenthsToday: TENTHS - 1 }));
    expect(result.state).toEqual(state);
    expect(result.events).toHaveLength(0);
  });

  it("still draws while a todo is pinned — a ward shields the enemy, it does not stop you", () => {
    const warded = setWard(fresh(), "todo-1", "Finish the thing");
    const result = drawExtraCard(warded, ctx({ microTenthsToday: TENTHS * 5, wardCleared: false }));
    expect(result.state.drawsUsed).toBe(1);
    expect(result.events).toContainEqual({ type: "cardDrawn", cardId: result.state.hand.at(-1) });
  });

  it("does not burn the credit when there is nothing left to draw", () => {
    const empty = { ...fresh(), drawPile: [], discard: [] };
    const result = drawExtraCard(empty, ctx({ microTenthsToday: TENTHS }));
    expect(result.state.drawsUsed).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it("reshuffles the discard when the draw pile is dry", () => {
    const state = { ...fresh(), drawPile: [], discard: ["ember", "hex"] };
    const { state: next } = drawExtraCard(state, ctx({ microTenthsToday: TENTHS }));
    expect(next.hand).toHaveLength(state.hand.length + 1);
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
      ...withHand(fresh(), ["scout", "strike", "guard", "lunge"]),
      drawPile: ["strike", "strike", "strike"],
    };
    const next = playCard(state, 0, ctx()).state;
    expect(next.hand.length).toBeLessThanOrEqual(HAND_SIZE);
  });
});

describe("enemy turns", () => {
  it("spends block before HP", () => {
    let state = withHand(fresh(), ["guard"]); // 5 block
    state = playCard(state, 0, ctx()).state;
    const attack = state.enemy!.attack;
    const next = endTurn(state, ctx()).state;
    expect(next.block).toBe(0);
    expect(next.hp).toBe(START_HP - Math.max(0, attack - 5));
  });

  it("telegraphs a heavy hit and doubles it", () => {
    let state = armed(fresh());
    const attack = state.enemy!.attack;
    expect(state.enemy!.turnsUntilHeavy).toBe(HEAVY_EVERY);
    for (let i = 1; i < HEAVY_EVERY; i += 1) state = armed(endTurn(state, ctx()).state);
    expect(state.enemy!.turnsUntilHeavy).toBe(1);
    const before = state.hp;
    const { state: hit, events } = endTurn(armed(state), ctx());
    expect(before - hit.hp).toBe(attack * HEAVY_MULTIPLIER);
    expect(events.some((e) => e.type === "playerHit" && e.heavy)).toBe(true);
    expect(hit.enemy!.turnsUntilHeavy).toBe(HEAVY_EVERY);
  });

  it("weaken softens the swing but never below 1", () => {
    const state = armed({ ...fresh(), enemy: { ...fresh().enemy!, attack: 2, weakened: 10 } });
    const next = endTurn(state, ctx()).state;
    expect(START_HP - next.hp).toBe(1);
  });

  it("ends the run at zero HP and counts the loss", () => {
    const state = armed({ ...fresh(), hp: 1 });
    const { state: dead, events } = endTurn(state, ctx());
    expect(dead.status).toBe("dead");
    expect(dead.hp).toBe(0);
    expect(dead.meta.runsLost).toBe(1);
    expect(events.some((e) => e.type === "died")).toBe(true);
  });

  it("never forces a turn: an energy-less player just stops, they do not lose", () => {
    // With no energy and no free cards, the fight simply pauses. Nothing in the
    // engine advances it, so an unproductive week cannot kill a run.
    const state = withHand(fresh(), ["strike", "strike", "lunge", "guard"]);
    const result = playCard(state, 0, ctx({ goldEarnedToday: 0 }));
    expect(result.state).toEqual(state);
  });

  it("refuses to swing until the player has played something", () => {
    // The death spiral this closes: drawing needs a turn, a turn costs HP, so a
    // player with no energy could otherwise be ground down doing nothing.
    const idle = fresh();
    expect(canEndTurn(idle)).toBe(false);
    const result = endTurn(idle, ctx());
    expect(result.state).toEqual(idle);
    expect(result.events).toHaveLength(0);
  });

  it("arms the enemy the moment a card is played, and disarms it after the swing", () => {
    const played = playCard(withHand(fresh(), ["strike"]), 0, ctx()).state;
    expect(canEndTurn(played)).toBe(true);
    const after = endTurn(played, ctx()).state;
    expect(after.playedThisTurn).toBe(false);
    expect(canEndTurn(after)).toBe(false);
  });

  it("cannot be ground down by repeated end-turn spam", () => {
    let state = playCard(withHand(fresh(), ["strike"]), 0, ctx()).state;
    const afterOne = endTurn(state, ctx()).state;
    state = afterOne;
    for (let i = 0; i < 20; i += 1) state = endTurn(state, ctx()).state;
    expect(state.hp).toBe(afterOne.hp);
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

  it("banks the floor when the last room of a floor falls", () => {
    let state = fresh();
    for (let i = 0; i < ROOMS_PER_FLOOR - 1; i += 1) {
      state = chooseReward(killEnemy(state), null, ctx()).state;
    }
    const hurt = { ...killEnemy({ ...state, hp: 10 }) };
    const { state: next, events } = chooseReward(hurt, null, ctx());
    expect(next.floor).toBe(2);
    expect(next.room).toBe(0);
    expect(next.hp).toBe(next.maxHp);
    expect(events.some((e) => e.type === "floorCleared")).toBe(true);
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
    expect(endTurn(armed(warded), outstanding).state).not.toEqual(armed(warded));
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

  it("regenerates the shield on the enemy's turn — progress cannot be banked", () => {
    const broken = playCard(pinned(), 0, outstanding).state;
    expect(broken.enemy!.ward).toBe(0);
    expect(endTurn(broken, outstanding).state.enemy!.ward).toBe(WARD_AMOUNT);
  });

  it("shatters the shield the moment the todo is done", () => {
    const warded = pinned();
    const { state: next, events } = playCard(warded, 0, ctx()); // ctx() = wardCleared
    expect(events).toContainEqual({ type: "wardShattered" });
    // Full damage lands: nothing absorbed it.
    expect(next.enemy!.maxHp - next.enemy!.hp).toBe(getCard("strike")!.effect.damage);
  });

  it("stops regenerating once the todo is done", () => {
    const warded = armed(pinned());
    expect(endTurn(warded, ctx()).state.enemy!.ward).toBe(0);
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

  it("starts the new day clean when the restart crosses midnight", () => {
    const dead = { ...fresh(), status: "dead" as const, energyUsed: 12 };
    const next = restartRun(dead, 555, NOW, "2026-08-10").state;
    expect(next.energyUsed).toBe(0);
  });
});

describe("draw pile", () => {
  it("reshuffles the discard when the draw pile runs dry", () => {
    const state = armed({
      ...fresh(),
      hand: [],
      drawPile: [],
      discard: ["strike", "guard", "lunge"],
    });
    const next = endTurn(state, ctx()).state;
    // The hand refills, so all three come back out of the reshuffled discard.
    expect(next.hand).toHaveLength(3);
    expect(next.drawPile.length + next.discard.length).toBe(0);
  });

  it("refills the hand rather than topping it up by one", () => {
    const state = armed({
      ...fresh(),
      hand: ["strike"],
      drawPile: ["guard", "lunge", "ward", "hex"],
      discard: [],
    });
    const next = endTurn(state, ctx()).state;
    expect(next.hand).toHaveLength(HAND_SIZE);
    // The card that was already in hand is still there — nothing is discarded.
    expect(next.hand[0]).toBe("strike");
  });

  it("does not hang when there is nothing left to draw", () => {
    const state = armed({ ...fresh(), hand: [], drawPile: [], discard: [] });
    expect(endTurn(state, ctx()).state.hand).toEqual([]);
  });
});
