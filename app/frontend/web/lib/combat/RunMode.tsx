"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { CardId, Side } from "@slaythelist/combat-engine";
import { resolveDamageTest } from "@slaythelist/combat-engine";
import { BattleView } from "./BattleView";
import { CardView } from "./CardView";
import { CARD_CATALOG, FACTION_COLOR, getCard, type GameCard } from "./cards";
import { Sigil } from "./icons";
import { getBadge } from "./badges";
import type { Expedition } from "./opponents";
import {
  BENCH_SIZE,
  REROLL_COST,
  TEAM_MAX,
  UNIT_PRICE,
  XP_BUY_COST,
  afterBattle,
  benchCount,
  benchToTeam,
  benchUnit,
  buyUnit,
  buyXp,
  fieldUnit,
  hasBenchSpace,
  hasTeamSpace,
  moveBench,
  moveTeam,
  newRun,
  opponentForStage,
  reroll,
  runRewards,
  sellUnit,
  sellValue,
  slotsFor,
  stageIncome,
  teamCount,
  teamDeck,
  teamToBench,
  xpToNext,
  type RunRewards,
  type RunState,
} from "./run";
import styles from "../../app/combat/combat.module.css";

const RUN_KEY = "slaythelist.combat.run.v2";

function loadRun(): RunState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(RUN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunState;
    // Normalize both zones to fixed-length slot arrays (older saves were
    // compact lists).
    const bench = Array.from({ length: BENCH_SIZE }, (_, i) => parsed.bench?.[i] ?? null);
    const team = Array.from({ length: TEAM_MAX }, (_, i) => parsed.team?.[i] ?? null);
    return { ...parsed, team, bench };
  } catch {
    return null;
  }
}

function persistRun(run: RunState | null) {
  if (typeof window === "undefined") return;
  if (run) window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
  else window.localStorage.removeItem(RUN_KEY);
}

/** Which expedition has a paused run (for the map's "resume" tag). */
export function getActiveRunExpeditionId(): string | null {
  const run = loadRun();
  return run && !run.over ? run.expeditionId : null;
}

interface RunModeProps {
  expedition: Expedition;
  /** Card pool unlocked for shops (the player's owned cards). */
  pool: CardId[];
  /** Badges already owned — used to show only NEW ones at run end. */
  ownedBadges: string[];
  /** True when this expedition was already cleared before this run. */
  alreadyCleared: boolean;
  onExit: () => void;
  /** Fired once when the run ends. Rewards: emeralds + badges. Never gold. */
  onRunEnd: (victory: boolean, rewards: RunRewards) => Promise<void>;
}

export function RunMode({ expedition, pool, ownedBadges, alreadyCleared, onExit, onRunEnd }: RunModeProps) {
  // Resume a saved run only if it belongs to THIS expedition; otherwise a
  // fresh run starts (entering a different node abandons the old run).
  const [run, setRun] = useState<RunState>(() => {
    const saved = loadRun();
    if (saved && !saved.over && saved.expeditionId === expedition.id) return saved;
    return newRun(expedition, pool, Math.floor(Math.random() * 1_000_000_000));
  });
  const [view, setView] = useState<"plan" | "battle">("plan");
  const [battleKey, setBattleKey] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const rewardPaidRef = useRef(false);
  // Small activation distance keeps the buttons inside cards clickable.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => persistRun(run.over ? null : run), [run]);

  const opponent = useMemo(
    () => (!run.over ? opponentForStage(expedition, run) : null),
    [expedition, run],
  );

  function update(next: RunState) {
    setRun(next);
  }

  async function handleComplete(winner: Side | "draw") {
    const won = winner === "a";
    const income = stageIncome(run, won);
    const next = afterBattle(run, won, pool);
    setView("plan");
    setBanner(
      won
        ? `Stage ${run.stage} won — +${income} ◈`
        : `Stage ${run.stage} lost — ${next.lives} ${next.lives === 1 ? "life" : "lives"} left`,
    );
    setRun(next);
    if (next.over && !rewardPaidRef.current) {
      rewardPaidRef.current = true;
      const rewards = runRewards(next, !alreadyCleared);
      setNewBadges(rewards.badgeIds.filter((id) => !ownedBadges.includes(id)));
      await onRunEnd(next.victory, rewards);
    }
  }

  // ---- run over: summary -------------------------------------------------
  if (run.over) {
    const rewards = runRewards(run, !alreadyCleared);
    return (
      <div className={styles.resultOverlay}>
        <div className={styles.resultCard}>
          {run.victory ? (
            <div className={styles.resultWin}>{expedition.name.toUpperCase()} FALLS</div>
          ) : (
            <div className={styles.resultLose}>EXPEDITION LOST</div>
          )}
          <div className={styles.rewardLine}>
            {run.wins}/{run.stagesTotal} stages won
            {rewards.emeralds > 0 && (
              <>
                {" · "}
                <span className={styles.coinPop}>
                  +<span className={styles.emeraldText}>{rewards.emeralds} ◆</span>
                </span>
              </>
            )}
          </div>
          {newBadges.length > 0 && (
            <div className={styles.badgeEarnedRow}>
              {newBadges.map((id) => {
                const badge = getBadge(id);
                if (!badge) return null;
                return (
                  <span key={id} className={styles.badgeEarned} title={badge.desc}>
                    {badge.glyph} {badge.name}
                  </span>
                );
              })}
            </div>
          )}
          <div className={styles.resultActions}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => {
                rewardPaidRef.current = false;
                setNewBadges([]);
                setBanner(null);
                setRun(newRun(expedition, pool, Math.floor(Math.random() * 1_000_000_000)));
              }}
            >
              Retry expedition
            </button>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onExit}>
              To the map
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- battle ------------------------------------------------------------
  if (view === "battle" && opponent) {
    return (
      <BattleView
        key={battleKey}
        playerDeck={teamDeck(run)}
        enemyDeck={opponent.deck}
        playerName="You"
        enemyName={opponent.name}
        seed={run.seed + run.stage * 1013 + battleKey}
        onComplete={handleComplete}
      />
    );
  }

  // ---- plan screen: header / enemy / team / shop ---------------------------
  const slots = slotsFor(run.level);
  const toNext = xpToNext(run);

  function handleDragEnd(event: DragEndEvent) {
    const src = String(event.active.id);
    const dst = event.over ? String(event.over.id) : null;
    if (!dst || src === dst) return;
    const [srcZone, srcIdxRaw] = src.split(":");
    const [dstZone, dstIdxRaw] = dst.split(":");
    const from = Number(srcIdxRaw);
    const to = Number(dstIdxRaw);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (srcZone === "team" && dstZone === "team") update(moveTeam(run, from, to));
    else if (srcZone === "bench" && dstZone === "bench") update(moveBench(run, from, to));
    else if (srcZone === "bench" && dstZone === "team") update(benchToTeam(run, from, to));
    else if (srcZone === "team" && dstZone === "bench") update(teamToBench(run, from, to));
  }

  return (
    <div className={styles.runLayout}>
      {/* HUD — everything you own, always visible */}
      <div className={styles.runHud}>
        <span className={styles.chip} style={{ ["--accent"]: FACTION_COLOR[expedition.faction] } as React.CSSProperties}>
          <Sigil kind={expedition.sigil} size={14} /> {expedition.title}
        </span>
        <span className={styles.chip}>
          Stage <b>{run.stage}</b>/{run.stagesTotal}
        </span>
        <span className={styles.chip}>
          {"❤".repeat(run.lives)}
          <span className={styles.chipDim}>{"♡".repeat(Math.max(0, 3 - run.lives))}</span>
        </span>
        <span className={styles.chip}>
          Lv <b>{run.level}</b>
          {toNext !== null && <span className={styles.chipDim}> · {toNext} xp</span>}
        </span>
        <div className={styles.spacer} />
        {banner && <span className={styles.outcomeBanner}>{banner}</span>}
        <div className={styles.spacer} />
        <span className={styles.shardBig} title="Shards — this run's currency">
          ◈ {run.shards}
        </span>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onExit}>
          Pause
        </button>
      </div>

      {/* Enemy strip + the Fight button */}
      {opponent && (
        <div
          className={styles.enemyStrip}
          style={{ ["--accent"]: FACTION_COLOR[opponent.faction] } as React.CSSProperties}
        >
          <div className={styles.portrait}>
            <Sigil kind={opponent.sigil} size={30} />
          </div>
          <div className={styles.nodeBody}>
            <div className={styles.nodeName}>
              {opponent.name}
              {opponent.keeper && <span className={styles.bossBadge}>KEEPER</span>}
            </div>
            <div className={styles.nodeTitle}>{opponent.title}</div>
          </div>
          <div className={styles.enemyUnits}>
            {opponent.deck.map((id, i) => {
              const card = getCard(id);
              if (!card) return null;
              return <MiniUnit key={`${id}-${i}`} card={card} />;
            })}
          </div>
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.fightBtn}`}
            disabled={teamCount(run) === 0}
            onClick={() => {
              setBattleKey((k) => k + 1);
              setView("battle");
            }}
          >
            ⚔ Fight
          </button>
        </div>
      )}

      {/* Team + bench — center stage, drag to arrange */}
      <DndContext sensors={dndSensors} collisionDetection={slotCollision} onDragEnd={handleDragEnd}>
        <div className={styles.teamZone}>
          <div className={styles.zoneLabel}>
            Your team · {teamCount(run)}/{slots} — leftmost fights first
          </div>
          <div className={styles.teamRow}>
            {run.team.slice(0, slots).map((id, i) => {
              const card = id ? getCard(id) : null;
              if (!id || !card) {
                return (
                  <DragSlot key={`team-slot-${i}`} zone="team" index={i} filled={false}>
                    <div className={styles.slotEmpty} />
                  </DragSlot>
                );
              }
              return (
                <DragSlot key={`team-slot-${i}`} zone="team" index={i} filled>
                  <CardView
                    card={card}
                    size="sm"
                    hideCost
                    footer={
                      <div className={styles.unitBtnRow}>
                        <button
                          className={styles.moveBtn}
                          title="Move to bench"
                          disabled={!hasBenchSpace(run)}
                          onClick={(e) => {
                            e.stopPropagation();
                            update(benchUnit(run, i));
                          }}
                        >
                          ⬇
                        </button>
                        <button
                          className={styles.sellBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            update(sellUnit(run, "team", i));
                          }}
                        >
                          Sell +{sellValue(id)}◈
                        </button>
                      </div>
                    }
                  />
                </DragSlot>
              );
            })}
          </div>

          <div className={styles.zoneLabel}>
            Bench · {benchCount(run)}/{BENCH_SIZE} — 3 copies merge into ★2, two ★2 into ★3
          </div>
          <div className={styles.teamRow}>
            {run.bench.map((id, i) => {
              const card = id ? getCard(id) : null;
              if (!id || !card) {
                return (
                  <DragSlot key={`bench-slot-${i}`} zone="bench" index={i} filled={false}>
                    <div className={`${styles.slotEmpty} ${styles.slotEmptySm}`} />
                  </DragSlot>
                );
              }
              return (
                <DragSlot key={`bench-slot-${i}`} zone="bench" index={i} filled>
                  <CardView
                    card={card}
                    size="sm"
                    hideCost
                    footer={
                      <div className={styles.unitBtnRow}>
                        <button
                          className={styles.moveBtn}
                          title="Field this unit"
                          disabled={!hasTeamSpace(run)}
                          onClick={(e) => {
                            e.stopPropagation();
                            update(fieldUnit(run, i));
                          }}
                        >
                          ⬆
                        </button>
                        <button
                          className={styles.sellBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            update(sellUnit(run, "bench", i));
                          }}
                        >
                          Sell +{sellValue(id)}◈
                        </button>
                      </div>
                    }
                  />
                </DragSlot>
              );
            })}
          </div>
        </div>
      </DndContext>

      {/* Shop dock — pinned to the bottom, shard prices only */}
      <div className={styles.shopDock}>
        <div className={styles.dockSide}>
          <div className={styles.zoneLabel}>Shop</div>
          <button className={styles.btn} disabled={run.shards < XP_BUY_COST || toNext === null} onClick={() => update(buyXp(run))}>
            +4 XP · {XP_BUY_COST}◈
          </button>
          <button className={styles.btn} disabled={run.shards < REROLL_COST} onClick={() => update(reroll(run, pool))}>
            ↻ Reroll · {REROLL_COST}◈
          </button>
        </div>
        <div className={styles.dockCards}>
          {run.shop.length === 0 && <div className={styles.deckEmpty}>Sold out — reroll for fresh offers.</div>}
          {run.shop.map((id, i) => {
            const card = getCard(id);
            if (!card) return null;
            const price = UNIT_PRICE[card.rarity];
            const benchFull = !hasBenchSpace(run);
            const canBuy = run.shards >= price && !benchFull;
            return (
              <CardView
                key={`${id}-${i}-${run.rolls}`}
                card={card}
                shardCost={price}
                footer={
                  <button
                    className={styles.buyBtn}
                    disabled={!canBuy}
                    onClick={() => {
                      const { state: next, merges } = buyUnit(run, i);
                      if (merges.length > 0) setBanner(merges.join(" · "));
                      update(next);
                    }}
                  >
                    {benchFull ? "Bench full" : `Buy · ${price}◈`}
                  </button>
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Slot under the cursor when there is one; otherwise the slot NEAREST the
 *  pointer (within a sane radius) — releases in the gutters between cards
 *  still land where you meant, without teleporting on wild misses. */
const NEAR_MISS_RADIUS = 140;
const slotCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) return within;
  const { droppableContainers, droppableRects, pointerCoordinates } = args;
  if (!pointerCoordinates) return closestCenter(args);
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const dx = rect.left + rect.width / 2 - pointerCoordinates.x;
    const dy = rect.top + rect.height / 2 - pointerCoordinates.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = String(container.id);
    }
  }
  return bestId !== null && bestDist <= NEAR_MISS_RADIUS ? [{ id: bestId }] : [];
};

/** A team/bench slot: droppable always, draggable when it holds a unit. */
function DragSlot({
  zone,
  index,
  filled,
  children,
}: {
  zone: "team" | "bench";
  index: number;
  filled: boolean;
  children: ReactNode;
}) {
  const id = `${zone}:${index}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const { setNodeRef: setDragRef, listeners, attributes, transform, isDragging } = useDraggable({
    id,
    disabled: !filled,
  });
  return (
    <div
      ref={(el) => {
        setDropRef(el);
        setDragRef(el);
      }}
      {...(filled ? { ...listeners, ...attributes } : {})}
      className={[styles.dragSlot, filled ? styles.dragGrab : "", isOver ? styles.slotOver : "", isDragging ? styles.dragging : ""]
        .filter(Boolean)
        .join(" ")}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
    >
      {children}
    </div>
  );
}

/** Tiny enemy-unit readout (name + stats, no full card). */
function MiniUnit({ card }: { card: GameCard }) {
  return (
    <div className={styles.miniUnit} style={{ ["--accent"]: FACTION_COLOR[card.faction] } as React.CSSProperties}>
      <Sigil kind={card.sigil} size={22} />
      <div className={styles.miniName}>
        {card.name}
        {card.level && <span className={styles.starsInline}>{"★".repeat(card.level)}</span>}
      </div>
      <div className={styles.miniStats}>
        ⚔{card.attack} ⚡{card.attackSpeed} ♥{card.health}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Training dummy mode — Oaken-style DPS check.
// ---------------------------------------------------------------------------

const DUMMY_BEST_KEY = "slaythelist.combat.dummyBest.v1";
const DUMMY_WINDOW_MS = 30_000;

interface TrainingModeProps {
  deck: CardId[];
  onExit: () => void;
  /** Fired when a training feat earns a badge (e.g. heavy-hitter). */
  onBadge?: (badgeId: string) => void;
}

export function TrainingMode({ deck, onExit, onBadge }: TrainingModeProps) {
  const [running, setRunning] = useState(false);
  const [seed, setSeed] = useState(1);
  const [done, setDone] = useState(false);

  const test = useMemo(
    () => (running || done ? resolveDamageTest({ cardIds: deck }, CARD_CATALOG, DUMMY_WINDOW_MS, seed) : null),
    [running, done, deck, seed],
  );

  const best = typeof window === "undefined" ? 0 : Number(window.localStorage.getItem(DUMMY_BEST_KEY) ?? 0);

  useEffect(() => {
    if (!done || !test) return;
    if (test.damage > best && typeof window !== "undefined") {
      window.localStorage.setItem(DUMMY_BEST_KEY, String(test.damage));
    }
    if (test.damage >= 450) onBadge?.("heavy-hitter");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (!running) {
    return (
      <div className={styles.scroll}>
        <div className={styles.shell}>
          <div className={styles.mapIntro}>
            <h1>Training Grounds</h1>
          </div>
          <div className={styles.runStart}>
            <p className={styles.runStartText}>
              30 seconds against the dummy. It doesn&apos;t hit back — how hard do you?
              {best > 0 && (
                <>
                  {" "}
                  Best: <b>{best.toLocaleString()}</b>
                </>
              )}
            </p>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={deck.length === 0}
              onClick={() => {
                setSeed(Math.floor(Math.random() * 1_000_000));
                setDone(false);
                setRunning(true);
              }}
            >
              {deck.length === 0 ? "Assemble a squad in the Collection first" : "Start test"}
            </button>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onExit} style={{ marginLeft: 10 }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <BattleView
        key={seed}
        playerDeck={deck}
        enemyDeck={["__dummy"]}
        playerName="You"
        enemyName="Training Dummy"
        seed={seed}
        maxTimeMs={DUMMY_WINDOW_MS}
        onComplete={() => setDone(true)}
      />
      {done && test && (
        <div className={styles.resultOverlay}>
          <div className={styles.resultCard}>
            <div className={styles.resultWin}>{test.damage.toLocaleString()}</div>
            <div className={styles.rewardLine}>
              damage in 30s · <b>{Math.round(test.dps).toLocaleString()} DPS</b>
              {test.damage > best && best > 0 && <> · new best!</>}
            </div>
            <div className={styles.resultActions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => {
                  setSeed(Math.floor(Math.random() * 1_000_000));
                  setDone(false);
                }}
              >
                Again
              </button>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => {
                  setRunning(false);
                  setDone(false);
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
