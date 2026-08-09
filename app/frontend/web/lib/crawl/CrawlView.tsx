"use client";

/**
 * The Crawl — the whole game UI, in one component shared by the overlay panel
 * and the /crawl page. Two rules it is built around:
 *
 *  - MOUSE ONLY. The overlay panel is a WS_EX_NOACTIVATE window so it never
 *    steals focus from what you are actually working on, which also means no
 *    keyboard event ever reaches it. Everything here is a click target.
 *  - NO TIMERS. Nothing ticks, nothing expires while you watch. The run waits
 *    exactly where you left it, so closing the panel mid-fight costs nothing.
 *
 * All state comes from the server as whole snapshots; the component never
 * computes game state, only renders it.
 */
import { useCallback, useEffect, useState } from "react";
import {
  FLOORS,
  HAND_SIZE,
  ROOMS_PER_FLOOR,
  getCard,
  type CardId,
  type CrawlEvent,
} from "@slaythelist/crawl-engine";
import {
  chooseReward,
  endTurn,
  fetchCrawl,
  playCard,
  restartRun,
  type CrawlSnapshot,
} from "./data";
import styles from "./crawl.module.css";

/** Re-poll while idle so a todo finished elsewhere unlocks the run promptly. */
const POLL_MS = 20_000;

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** One line of feedback for the last action. Keeps the panel from feeling mute. */
function describeEvents(events: CrawlEvent[]): { text: string; tone: "good" | "hit" | "" } | null {
  if (events.length === 0) return null;
  const parts: string[] = [];
  let tone: "good" | "hit" | "" = "";

  for (const event of events) {
    switch (event.type) {
      case "cardPlayed":
        if (event.damage > 0) parts.push(`Hit for ${event.damage}.`);
        break;
      case "enemySlain":
        parts.push(`${event.name} falls.`);
        tone = "good";
        break;
      case "playerHit":
        parts.push(
          event.amount > 0
            ? `${event.heavy ? "Heavy blow" : "Struck"} for ${event.amount}.`
            : "Blocked it all.",
        );
        if (event.amount > 0) tone = "hit";
        break;
      case "floorCleared":
        parts.push(`Floor ${event.floor} cleared. You catch your breath.`);
        tone = "good";
        break;
      case "runWon":
        parts.push(`The dungeon is yours. +${event.goldReward} gold.`);
        tone = "good";
        break;
      case "died":
        parts.push(`You fall on floor ${event.floor}.`);
        tone = "hit";
        break;
    }
  }
  return parts.length > 0 ? { text: parts.join(" "), tone } : null;
}

export function CrawlView({ compact = false }: { compact?: boolean }) {
  const [snap, setSnap] = useState<CrawlSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ text: string; tone: "good" | "hit" | "" } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchCrawl();
      setSnap(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not reach the API");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  /** Run an action, adopt the returned snapshot, and surface what happened. */
  const act = useCallback(async (action: () => Promise<CrawlSnapshot>) => {
    setBusy(true);
    try {
      const next = await action();
      setSnap(next);
      setError(null);
      setLog(describeEvents(next.events));
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  }, []);

  if (error && !snap) {
    return <div className={styles.root}><div className={styles.error}>Crawl offline: {error}</div></div>;
  }
  if (!snap) {
    return <div className={styles.root}><div className={styles.loading}>Lighting a torch…</div></div>;
  }

  const { state, energy, lock } = snap;
  const locked = lock !== null && !lock.done;
  const roomsCleared = (state.floor - 1) * ROOMS_PER_FLOOR + state.room;

  return (
    <div className={styles.root}>
      <div className={styles.status}>
        <span className={styles.depth}>
          Floor {Math.min(state.floor, FLOORS)}/{FLOORS} · room {Math.min(state.room + 1, ROOMS_PER_FLOOR)}
        </span>
        <span className={styles.spacer} />
        {snap.momentum && <span className={styles.momentum} title="A todo finished in the last hour: +3 damage">⚡</span>}
        <span
          className={energy > 0 ? styles.energy : `${styles.energy} ${styles.energyDim}`}
          title={`Energy is the gold you earned today (${snap.goldEarnedToday}). It expires at midnight and never lowers your balance.`}
        >
          ⚡{energy}
        </span>
      </div>

      {locked && (
        <div className={`${styles.banner} ${styles.bannerLock}`}>
          <span className={styles.bannerTitle}>🔒 Locked</span>
          {lock.title}
          <div className={styles.bannerNote}>Finish it to unlock the run.</div>
        </div>
      )}

      {state.status === "dead" && (
        <div className={styles.endState}>
          <div className={styles.endGlyph}>💀</div>
          <div className={`${styles.endTitle} ${styles.endTitleLose}`}>You fell on floor {state.floor}</div>
          <div className={styles.endNote}>
            Deepest run: floor {state.meta.bestFloor}. Starting over costs nothing but the ground.
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void act(restartRun)}>
            Descend again
          </button>
        </div>
      )}

      {state.status === "victory" && (
        <div className={styles.endState}>
          <div className={styles.endGlyph}>👑</div>
          <div className={`${styles.endTitle} ${styles.endTitleWin}`}>The Hollow King has fallen</div>
          <div className={styles.endNote}>
            +10 gold, paid into your real balance. {state.meta.runsWon} run
            {state.meta.runsWon === 1 ? "" : "s"} cleared.
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void act(restartRun)}>
            Descend again
          </button>
        </div>
      )}

      {state.status === "reward" && (
        <>
          <div className={styles.rewardHead}>Take a card</div>
          <div className={styles.rewardRow}>
            {state.rewardChoices.map((id) => {
              const card = getCard(id);
              if (!card) return null;
              return (
                <button
                  key={id}
                  className={`${styles.card} ${styles.rewardCard}`}
                  disabled={busy || locked}
                  onClick={() => void act(() => chooseReward(id))}
                  title={card.text}
                >
                  <span className={styles.cardGlyph}>{card.glyph}</span>
                  <span className={styles.cardName}>{card.name}</span>
                  <span className={card.cost === 0 ? `${styles.cardCost} ${styles.cardCostFree}` : styles.cardCost}>
                    ⚡{card.cost}
                  </span>
                  <span className={styles.cardText}>{card.text}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <button className={styles.btn} disabled={busy || locked} onClick={() => void act(() => chooseReward(null))}>
              Skip — keep the deck lean
            </button>
          </div>
        </>
      )}

      {state.status === "fighting" && state.enemy && (
        <>
          <div className={`${styles.enemy} ${state.enemy.boss ? styles.enemyBoss : ""}`}>
            <div className={styles.enemyTop}>
              <span className={styles.enemyGlyph}>{state.enemy.glyph}</span>
              <span className={styles.enemyName}>{state.enemy.name}</span>
              <span className={styles.spacer} />
              <span className={styles.enemyHp}>
                {state.enemy.hp}/{state.enemy.maxHp}
              </span>
            </div>
            <div className={styles.bar}>
              <div
                className={`${styles.barFill} ${styles.enemyFill}`}
                style={{ width: `${pct(state.enemy.hp, state.enemy.maxHp)}%` }}
              />
            </div>
            <div className={state.enemy.turnsUntilHeavy <= 1 ? `${styles.intent} ${styles.intentHeavy}` : styles.intent}>
              {state.enemy.turnsUntilHeavy <= 1
                ? `⚠ Winding up: ${Math.max(1, state.enemy.attack - state.enemy.weakened) * 2} damage next turn`
                : `Attacks for ${Math.max(1, state.enemy.attack - state.enemy.weakened)} · heavy in ${state.enemy.turnsUntilHeavy - 1}`}
            </div>
          </div>

          <div className={styles.player}>
            <span className={styles.enemyHp}>
              ❤ {state.hp}/{state.maxHp}
            </span>
            <div className={`${styles.bar} ${styles.playerHp}`}>
              <div className={`${styles.barFill} ${styles.hpFill}`} style={{ width: `${pct(state.hp, state.maxHp)}%` }} />
            </div>
            {state.block > 0 && <span className={styles.blockPip}>🛡{state.block}</span>}
            {state.strength > 0 && <span className={styles.momentum}>+{state.strength}</span>}
          </div>

          <div className={styles.hand}>
            {Array.from({ length: HAND_SIZE }, (_, i) => {
              const id: CardId | undefined = state.hand[i];
              const card = id ? getCard(id) : undefined;
              if (!card) {
                return <div key={`empty-${i}`} className={`${styles.card} ${styles.cardEmpty}`} />;
              }
              const unaffordable = card.cost > energy;
              return (
                <button
                  key={`${id}-${i}`}
                  className={styles.card}
                  disabled={busy || locked || unaffordable}
                  title={
                    unaffordable
                      ? `${card.text} — needs ${card.cost} energy, you have ${energy}. Earn gold to spend it.`
                      : card.text
                  }
                  onClick={() => void act(() => playCard(i))}
                >
                  <span className={styles.cardGlyph}>{card.glyph}</span>
                  <span className={styles.cardName}>{card.name}</span>
                  <span className={card.cost === 0 ? `${styles.cardCost} ${styles.cardCostFree}` : styles.cardCost}>
                    ⚡{card.cost}
                  </span>
                </button>
              );
            })}
          </div>

          {!locked && energy === 0 && !state.hand.some((id) => (getCard(id)?.cost ?? 1) === 0) && (
            <div className={`${styles.banner} ${styles.bannerDry}`}>
              <span className={styles.bannerTitle}>Out of energy</span>
              Energy is the gold you earn today. Go do something, then come back.
              <div className={styles.bannerNote}>
                The enemy only swings after you play, so nothing happens while you are away — the
                fight waits exactly here.
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button
              className={styles.btn}
              disabled={busy || locked || !state.playedThisTurn}
              onClick={() => void act(endTurn)}
              title={
                state.playedThisTurn
                  ? "The enemy takes its turn, then you draw a card."
                  : "Play a card first. The enemy only swings in response to you, never on a clock."
              }
            >
              End turn ▸
            </button>
          </div>
        </>
      )}

      {log && (
        <div
          className={`${styles.log} ${log.tone === "hit" ? styles.logHit : log.tone === "good" ? styles.logGood : ""}`}
        >
          {log.text}
        </div>
      )}
      {error && <div className={styles.log}>⚠ {error}</div>}
      {!compact && (
        <div className={styles.log}>
          Deck {state.deck.length} · rooms cleared {roomsCleared} · best floor {state.meta.bestFloor} ·{" "}
          {state.meta.kills} kills
        </div>
      )}
    </div>
  );
}
