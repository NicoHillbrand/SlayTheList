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
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FLOORS,
  HAND_SIZE,
  MOMENTUM_DAMAGE,
  ROOMS_PER_FLOOR,
  getCard,
  type CardId,
} from "@slaythelist/crawl-engine";
import {
  EVENTS_URL,
  chooseReward,
  endTurn,
  fetchCrawl,
  playCard,
  restartRun,
  type CrawlSnapshot,
} from "./data";
import styles from "./crawl.module.css";

/**
 * Backstop poll only. Energy arriving the moment you earn gold is what makes
 * the panel feel alive, and that comes over the event socket — this just covers
 * a dropped connection or an API that was down when the panel opened.
 */
const POLL_MS = 60_000;
/** Backoff before retrying a dropped event socket. */
const RECONNECT_MS = 3_000;

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function CrawlView({ compact = false }: { compact?: boolean }) {
  const [snap, setSnap] = useState<CrawlSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A refresh landing mid-action would clobber the action's own result with a
  // snapshot taken before it, so refreshes stand down while one is in flight.
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const next = await fetchCrawl();
      if (busyRef.current) return;
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

  // Live updates: the API broadcasts on every gold and todo mutation, so energy
  // appears the moment you earn it and a lock clears the moment you tick it off.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        socket = new WebSocket(EVENTS_URL);
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { type?: string };
            // Every gold/todo mutation republishes the overlay state. Rather
            // than read it, treat it purely as "something changed" and ask the
            // API for the run — it is the only thing that knows the whole shape.
            if (message?.type === "overlay_state") void load();
          } catch {
            // Not JSON we recognise — ignore it.
          }
        };
        socket.onclose = () => {
          if (!disposed) retry = setTimeout(connect, RECONNECT_MS);
        };
        socket.onerror = () => socket?.close();
      } catch {
        retry = setTimeout(connect, RECONNECT_MS);
      }
    }

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      // Drop the reconnect handler first, or closing here schedules a retry.
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [load]);

  /** Run an action, adopt the returned snapshot, and surface what happened. */
  const act = useCallback(async (action: () => Promise<CrawlSnapshot>) => {
    setBusy(true);
    busyRef.current = true;
    try {
      const next = await action();
      setSnap(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
      busyRef.current = false;
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
        {/* Not a second ⚡: momentum is a damage bonus, energy is the spendable
            pool. They read as the same thing if they share a glyph. */}
        {snap.momentum && (
          <span className={styles.momentum} title={`Todo finished in the last hour: +${MOMENTUM_DAMAGE} damage`}>
            ⚔+{MOMENTUM_DAMAGE}
          </span>
        )}
        <span
          className={energy > 0 ? styles.energy : `${styles.energy} ${styles.energyDim}`}
          title={`Energy is the gold you earned today (${snap.goldEarnedToday}). It expires at midnight and never lowers your balance.`}
        >
          ⚡{energy}
        </span>
      </div>

      {locked && (
        <div className={`${styles.banner} ${styles.bannerLock}`}>
          🔒 {lock.title}
        </div>
      )}

      {state.status === "dead" && (
        <div className={styles.endState}>
          <div className={styles.endGlyph}>💀</div>
          <div className={`${styles.endTitle} ${styles.endTitleLose}`}>Fell on floor {state.floor}</div>
          <div className={styles.endNote}>Best: floor {state.meta.bestFloor}</div>
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
            +10 gold · {state.meta.runsWon} run{state.meta.runsWon === 1 ? "" : "s"} cleared
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
              Skip
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
              Out of energy — earn gold to keep going.
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
