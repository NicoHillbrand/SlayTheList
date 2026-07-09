/**
 * The run layer — entering an expedition starts a run: `stages` fights with a
 * shard economy (rerollable shop, XP levels that grow team slots and improve
 * rarity odds) and a lives system. The final stage is the expedition's keeper.
 *
 * Currencies are strictly separated:
 *  - SHARDS (◈) — in-run only, earned from fights, spent on units/rerolls/XP.
 *  - Gold — real SlayTheList gold, minted by productivity only; it unlocks
 *    cards into the shop pool (the Collection) but is never earned in-game.
 *  - Emeralds (◆) — cosmetic currency, paid on first clears.
 *
 * All state transitions are pure functions over `RunState`.
 */
import { makeRng, type CardId } from "@slaythelist/combat-engine";
import { CARD_CATALOG, CARD_LIST, baseCardId, leveledId, unitLevel, type Faction, type Rarity } from "./cards";
import type { SigilKind } from "./icons";
import { type Expedition } from "./opponents";

export const START_LIVES = 3;
export const REROLL_COST = 2;
export const XP_BUY_COST = 4;
export const XP_BUY_AMOUNT = 4;
export const SHOP_SIZE = 4;
export const BENCH_SIZE = 5;

/** How many base copies a unit of each level is worth (for sell refunds). */
export const COPIES_BY_LEVEL: Record<1 | 2 | 3, number> = { 1: 1, 2: 3, 3: 6 };

/** Team slots by level (index = level, 1-based). */
export const SLOTS_BY_LEVEL = [0, 3, 4, 5, 6, 7];
export const MAX_LEVEL = SLOTS_BY_LEVEL.length - 1;
export const TEAM_MAX = SLOTS_BY_LEVEL[MAX_LEVEL];

/** Cumulative XP needed to REACH each level. */
export const XP_TO_REACH = [0, 0, 4, 10, 20, 36];

/** Shard prices by rarity. */
export const UNIT_PRICE: Record<Rarity, number> = { common: 3, rare: 5, epic: 8, legendary: 12 };

/** Shop rarity odds per level (percent, rows sum to 100). */
const RARITY_ODDS: Record<number, [number, number, number, number]> = {
  1: [85, 15, 0, 0],
  2: [65, 30, 5, 0],
  3: [50, 35, 15, 0],
  4: [40, 35, 20, 5],
  5: [28, 35, 27, 10],
};

export interface RunState {
  seed: number;
  /** Which expedition this run belongs to. */
  expeditionId: string;
  /** Total stages including the keeper finale. */
  stagesTotal: number;
  /** Trail difficulty of the expedition (0-based). */
  difficulty: number;
  /** Emeralds on first clear (copied from the expedition). */
  reward: number;
  /** Upcoming stage, 1-based. */
  stage: number;
  lives: number;
  shards: number;
  xp: number;
  level: number;
  /** Team SLOTS (fixed length TEAM_MAX; only the first `slotsFor(level)` are
   *  usable) — null = empty. Fight order = slot order, gaps skipped. Units
   *  stay exactly where you drop them. */
  team: Array<CardId | null>;
  /** Bench SLOTS (fixed length BENCH_SIZE) — null = empty. */
  bench: Array<CardId | null>;
  shop: CardId[];
  wins: number;
  /** Monotone counter so every shop roll draws fresh randomness. */
  rolls: number;
  over: boolean;
  victory: boolean;
}

export interface StageOpponent {
  name: string;
  title: string;
  sigil: SigilKind;
  faction: Faction;
  deck: CardId[];
  pve: boolean;
  keeper: boolean;
}

function rarityFor(level: number, roll: number): Rarity {
  const odds = RARITY_ODDS[Math.min(MAX_LEVEL, Math.max(1, level))];
  const order: Rarity[] = ["common", "rare", "epic", "legendary"];
  let acc = 0;
  for (let i = 0; i < order.length; i += 1) {
    acc += odds[i];
    if (roll * 100 < acc) return order[i];
  }
  return "common";
}

/** Roll a shop from the player's unlocked pool. Falls back down the rarity
 *  ladder when the pool has no cards of the rolled rarity. */
export function rollShop(state: RunState, pool: CardId[]): CardId[] {
  const rng = makeRng(state.seed + state.rolls * 7919 + state.stage * 104729);
  const byRarity = new Map<Rarity, CardId[]>();
  for (const id of pool) {
    const card = CARD_CATALOG[id];
    if (!card) continue;
    const list = byRarity.get(card.rarity) ?? [];
    list.push(id);
    byRarity.set(card.rarity, list);
  }
  const ladder: Rarity[] = ["legendary", "epic", "rare", "common"];
  const offers: CardId[] = [];
  for (let i = 0; i < SHOP_SIZE; i += 1) {
    let rarity = rarityFor(state.level, rng());
    let candidates = byRarity.get(rarity) ?? [];
    let li = ladder.indexOf(rarity);
    while (candidates.length === 0 && li < ladder.length - 1) {
      li += 1;
      rarity = ladder[li];
      candidates = byRarity.get(rarity) ?? [];
    }
    if (candidates.length === 0) continue;
    offers.push(candidates[Math.floor(rng() * candidates.length)]);
  }
  return offers;
}

export function newRun(expedition: Expedition, pool: CardId[], seed: number): RunState {
  const state: RunState = {
    seed,
    expeditionId: expedition.id,
    stagesTotal: expedition.stages,
    difficulty: expedition.difficulty,
    reward: expedition.reward,
    stage: 1,
    lives: START_LIVES,
    shards: 12,
    xp: 0,
    level: 1,
    team: Array<CardId | null>(TEAM_MAX).fill(null),
    bench: Array<CardId | null>(BENCH_SIZE).fill(null),
    shop: [],
    wins: 0,
    rolls: 0,
    over: false,
    victory: false,
  };
  return { ...state, shop: rollShop(state, pool), rolls: 1 };
}

export function slotsFor(level: number): number {
  return SLOTS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(1, level))];
}

export function xpToNext(state: RunState): number | null {
  if (state.level >= MAX_LEVEL) return null;
  return XP_TO_REACH[state.level + 1] - state.xp;
}

function applyLevelUps(state: RunState): RunState {
  let level = state.level;
  while (level < MAX_LEVEL && state.xp >= XP_TO_REACH[level + 1]) level += 1;
  return level === state.level ? state : { ...state, level };
}

export function reroll(state: RunState, pool: CardId[]): RunState {
  if (state.shards < REROLL_COST) return state;
  const next = { ...state, shards: state.shards - REROLL_COST, rolls: state.rolls + 1 };
  return { ...next, shop: rollShop(next, pool) };
}

export function buyXp(state: RunState): RunState {
  if (state.shards < XP_BUY_COST || state.level >= MAX_LEVEL) return state;
  return applyLevelUps({ ...state, shards: state.shards - XP_BUY_COST, xp: state.xp + XP_BUY_AMOUNT });
}

/** Sell refund: base price × copies the unit is worth at its level. */
export function sellValue(id: CardId): number {
  const card = CARD_CATALOG[baseCardId(id)];
  if (!card) return 0;
  return UNIT_PRICE[card.rarity] * COPIES_BY_LEVEL[unitLevel(id)];
}

export interface CombineResult {
  state: RunState;
  /** Human-readable merge messages, e.g. "3× Wild Cub → ★2". */
  merges: string[];
}

/** Number of units on the bench (non-empty slots). */
export function benchCount(state: RunState): number {
  return state.bench.filter((s) => s !== null).length;
}

export function hasBenchSpace(state: RunState): boolean {
  return state.bench.some((s) => s === null);
}

function firstFreeBenchSlot(bench: Array<CardId | null>): number {
  return bench.findIndex((s) => s === null);
}

/** Number of fielded units (non-empty team slots). */
export function teamCount(state: RunState): number {
  return state.team.filter((s) => s !== null).length;
}

/** First free team slot within the level's usable range; -1 if none. */
function firstFreeTeamSlot(state: RunState): number {
  const usable = slotsFor(state.level);
  for (let i = 0; i < usable; i += 1) if (!state.team[i]) return i;
  return -1;
}

export function hasTeamSpace(state: RunState): boolean {
  return firstFreeTeamSlot(state) !== -1;
}

/** The lineup that actually fights: slot order, gaps skipped. */
export function teamDeck(state: RunState): CardId[] {
  return state.team.filter((id): id is CardId => id !== null);
}

/**
 * Auto-combine, TFT-style: 3 identical base units → one ★2; two identical ★2
 * → one ★3. Runs to a fixed point. The upgraded unit takes the earliest TEAM
 * slot among the merged copies (so a fielded unit upgrades in place); merges
 * of bench-only copies land in the first merged copy's bench slot.
 */
export function autoCombine(state: RunState): CombineResult {
  const team = [...state.team];
  const bench = [...state.bench];
  const merges: string[] = [];

  const rules: Array<{ level: 1 | 2; needed: number; to: 2 | 3 }> = [
    { level: 1, needed: 3, to: 2 },
    { level: 2, needed: 2, to: 3 },
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      // Count copies of each base id at this level across team + bench.
      const counts = new Map<CardId, number>();
      for (const id of [...team, ...bench]) {
        if (!id || unitLevel(id) !== rule.level) continue;
        const base = baseCardId(id);
        counts.set(base, (counts.get(base) ?? 0) + 1);
      }
      for (const [base, count] of counts) {
        if (count < rule.needed) continue;
        const matchId = leveledId(base, rule.level);
        const upgraded = leveledId(base, rule.to);
        // Remove `needed` copies — bench copies first so fielded units stay.
        let toRemove = rule.needed;
        let benchSlot = -1;
        for (let i = 0; i < bench.length && toRemove > 0; i += 1) {
          if (bench[i] === matchId) {
            bench[i] = null;
            if (benchSlot === -1) benchSlot = i;
            toRemove -= 1;
          }
        }
        let teamSlot = -1;
        for (let i = 0; i < team.length && toRemove > 0; i += 1) {
          if (team[i] === matchId) {
            team[i] = null;
            if (teamSlot === -1) teamSlot = i;
            toRemove -= 1;
          }
        }
        // Place the upgrade: fielded slot if one was consumed, else the first
        // consumed bench slot.
        if (teamSlot !== -1) team[teamSlot] = upgraded;
        else if (benchSlot !== -1) bench[benchSlot] = upgraded;
        else bench[Math.max(0, firstFreeBenchSlot(bench))] = upgraded;
        const cardName = CARD_CATALOG[base]?.name ?? base;
        merges.push(`${rule.needed}× ${cardName}${rule.level === 2 ? " ★2" : ""} → ★${rule.to}`);
        changed = true;
      }
    }
  }

  if (merges.length === 0) return { state, merges };
  return { state: { ...state, team, bench }, merges };
}

/** Buy from the shop → first free bench slot. */
export function buyUnit(state: RunState, shopIndex: number): CombineResult {
  const id = state.shop[shopIndex];
  if (!id) return { state, merges: [] };
  const card = CARD_CATALOG[id];
  if (!card) return { state, merges: [] };
  const price = UNIT_PRICE[card.rarity];
  if (state.shards < price) return { state, merges: [] };
  const slot = firstFreeBenchSlot(state.bench);
  if (slot === -1) return { state, merges: [] };
  const shop = [...state.shop];
  shop.splice(shopIndex, 1);
  const bench = [...state.bench];
  bench[slot] = id;
  return autoCombine({ ...state, shards: state.shards - price, bench, shop });
}

export function sellUnit(state: RunState, zone: "team" | "bench", index: number): RunState {
  const list = zone === "team" ? state.team : state.bench;
  const id = list[index];
  if (!id) return state;
  const next = [...list];
  next[index] = null;
  return {
    ...state,
    shards: state.shards + sellValue(id),
    team: zone === "team" ? next : state.team,
    bench: zone === "bench" ? next : state.bench,
  };
}

/** Bench → first free team slot. */
export function fieldUnit(state: RunState, benchIndex: number): RunState {
  const id = state.bench[benchIndex];
  const slot = firstFreeTeamSlot(state);
  if (!id || slot === -1) return state;
  const team = [...state.team];
  const bench = [...state.bench];
  team[slot] = id;
  bench[benchIndex] = null;
  return { ...state, team, bench };
}

/** Field → first free bench slot. */
export function benchUnit(state: RunState, teamIndex: number): RunState {
  const id = state.team[teamIndex];
  if (!id) return state;
  const slot = firstFreeBenchSlot(state.bench);
  if (slot === -1) return state;
  const team = [...state.team];
  const bench = [...state.bench];
  team[teamIndex] = null;
  bench[slot] = id;
  return { ...state, team, bench };
}

// ---------------------------------------------------------------------------
// Drag-and-drop moves. Both zones are slotted: drops land in the EXACT slot
// you release on; occupied targets swap.
// ---------------------------------------------------------------------------

function usableTeamSlot(state: RunState, index: number): boolean {
  return index >= 0 && index < slotsFor(state.level);
}

/** Move within the team: exact-slot placement; occupied targets swap. */
export function moveTeam(state: RunState, from: number, to: number): RunState {
  if (from === to || !usableTeamSlot(state, from) || !usableTeamSlot(state, to)) return state;
  const team = [...state.team];
  if (!team[from]) return state;
  [team[from], team[to]] = [team[to], team[from]];
  return { ...state, team };
}

/** Move within the bench: exact-slot placement; occupied targets swap. */
export function moveBench(state: RunState, from: number, to: number): RunState {
  if (from === to || from < 0 || from >= BENCH_SIZE || to < 0 || to >= BENCH_SIZE) return state;
  const bench = [...state.bench];
  if (!bench[from]) return state;
  [bench[from], bench[to]] = [bench[to], bench[from]];
  return { ...state, bench };
}

/** Drag a bench unit onto a team slot — lands exactly there; swaps if occupied. */
export function benchToTeam(state: RunState, benchIndex: number, teamIndex: number): RunState {
  const id = state.bench[benchIndex];
  if (!id || !usableTeamSlot(state, teamIndex)) return state;
  const team = [...state.team];
  const bench = [...state.bench];
  bench[benchIndex] = team[teamIndex]; // occupant (or null) takes the bench slot
  team[teamIndex] = id;
  return { ...state, team, bench };
}

/** Drag a fielded unit onto a bench slot — lands exactly there; swaps if occupied. */
export function teamToBench(state: RunState, teamIndex: number, benchIndex: number): RunState {
  const id = state.team[teamIndex];
  if (!id || benchIndex < 0 || benchIndex >= BENCH_SIZE) return state;
  const team = [...state.team];
  const bench = [...state.bench];
  team[teamIndex] = bench[benchIndex]; // occupant (or null) takes the team slot
  bench[benchIndex] = id;
  return { ...state, team, bench };
}

/** Shard income for winning/attempting a stage. */
export function stageIncome(state: RunState, won: boolean): number {
  return 5 + Math.floor(state.stage / 2) + (won ? 2 : 0);
}

/** Income + XP + shop refresh + stage advance after a fight. */
export function afterBattle(state: RunState, won: boolean, pool: CardId[]): RunState {
  let next: RunState = applyLevelUps({
    ...state,
    shards: state.shards + stageIncome(state, won),
    xp: state.xp + 2,
    wins: won ? state.wins + 1 : state.wins,
    lives: won ? state.lives : state.lives - 1,
    stage: state.stage + 1,
    rolls: state.rolls + 1,
  });
  if (!won && next.lives <= 0) {
    next = { ...next, over: true, victory: false };
  } else if (state.stage >= state.stagesTotal && won) {
    next = { ...next, over: true, victory: true };
  } else if (state.stage >= state.stagesTotal) {
    // Lost the finale but has lives left — retry the keeper.
    next = { ...next, stage: state.stage };
  }
  return { ...next, shop: next.over ? next.shop : rollShop(next, pool) };
}

export interface RunRewards {
  /** Premium cosmetic currency (spent in the base-builder shop). Runs never
   *  mint gold — gold flows one way, from finished todos into the game. */
  emeralds: number;
  /** Badge ids earned by this run (dedup against already-owned elsewhere). */
  badgeIds: string[];
}

/** Rewards when the run ends: emeralds for a first-clear-worthy victory,
 *  badges for feats. (First-clear dedup happens at the caller, which knows
 *  which expeditions are already cleared.) */
export function runRewards(state: RunState, firstClear: boolean): RunRewards {
  let emeralds = 0;
  if (state.victory && firstClear) {
    emeralds += state.reward;
    if (state.lives === START_LIVES) emeralds += 1;
  }

  const badgeIds: string[] = [];
  if (state.victory) badgeIds.push("first-victory");
  if (state.victory && state.lives === START_LIVES) badgeIds.push("flawless");
  if (state.wins >= 5) badgeIds.push("survivor");
  if (state.level >= MAX_LEVEL) badgeIds.push("maxed");

  return { emeralds, badgeIds };
}

// ---------------------------------------------------------------------------
// Stage opponents — budget-generated challengers, a PvE creature stage midway
// through longer expeditions, and the keeper as the finale.
// ---------------------------------------------------------------------------

const CHALLENGER_NAMES: Array<{ name: string; title: string; sigil: SigilKind; faction: Faction }> = [
  { name: "Vagrant Duelist", title: "The Crossroads", sigil: "fang", faction: "beast" },
  { name: "Gravebound Knight", title: "Barrow Fields", sigil: "shield", faction: "stone" },
  { name: "Mistwood Warden", title: "The Pale Thicket", sigil: "leaf", faction: "forest" },
  { name: "Saltmarsh Augur", title: "The Brine Court", sigil: "drop", faction: "tide" },
  { name: "Zephyr Blade", title: "The High Passes", sigil: "feather", faction: "sky" },
  { name: "Umbral Scholar", title: "The Silent Stacks", sigil: "eye", faction: "arcane" },
  { name: "Ashen Reaver", title: "Cinder Flats", sigil: "flame", faction: "beast" },
  { name: "Hollow Acolyte", title: "The Waning Chapel", sigil: "moon", faction: "arcane" },
];

const PVE_PACKS: Array<Omit<StageOpponent, "keeper">> = [
  { name: "Wolf Pack", title: "Creatures of the road", sigil: "fang", faction: "beast", deck: ["cub", "cub", "direwolf", "cub"], pve: true },
  { name: "Stone Circle", title: "Creatures of the road", sigil: "stone", faction: "stone", deck: ["pebble", "golem", "pebble", "runestone", "pebble"], pve: true },
];

export function opponentForStage(expedition: Expedition, state: RunState): StageOpponent {
  const { stage } = state;

  // Finale: the keeper.
  if (stage >= expedition.stages) {
    return {
      name: expedition.name,
      title: expedition.title,
      sigil: expedition.sigil,
      faction: expedition.faction,
      deck: expedition.keeperDeck,
      pve: false,
      keeper: true,
    };
  }

  // Midway PvE creature stage for longer expeditions.
  if (expedition.stages >= 5 && stage === Math.ceil(expedition.stages / 2)) {
    return { ...PVE_PACKS[expedition.difficulty % PVE_PACKS.length], keeper: false };
  }

  // Budget-built challenger: difficulty ramps along the trail AND within the run.
  const rng = makeRng(state.seed * 31 + stage * 6151);
  const persona = CHALLENGER_NAMES[Math.floor(rng() * CHALLENGER_NAMES.length)];
  let budget = 10 + (expedition.difficulty * 3 + stage) * 7;
  const maxUnits = Math.min(7, 2 + Math.ceil((expedition.difficulty + stage) / 2));
  const picks: CardId[] = [];

  const preferred = CARD_LIST.filter((c) => c.faction === persona.faction);
  while (picks.length < maxUnits && budget > 0) {
    const source = rng() < 0.55 && preferred.length > 0 ? preferred : CARD_LIST;
    const affordable = source.filter((c) => c.cost <= budget);
    if (affordable.length === 0) break;
    const card = affordable[Math.floor(rng() * affordable.length)];
    budget -= card.cost;
    // Deeper trail: challengers sometimes field ★2 units (costs 2 extra copies).
    if (expedition.difficulty >= 2 && budget >= card.cost * 2 && rng() < 0.25) {
      budget -= card.cost * 2;
      picks.push(leveledId(card.id, 2));
    } else {
      picks.push(card.id);
    }
  }
  if (picks.length === 0) picks.push("cub");
  picks.sort((x, y) => (CARD_CATALOG[y]?.health ?? 0) - (CARD_CATALOG[x]?.health ?? 0));

  return { ...persona, deck: picks, pve: false, keeper: false };
}
