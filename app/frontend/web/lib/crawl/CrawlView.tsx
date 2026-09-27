"use client";

/**
 * The Crawl — the whole game UI, in one component shared by the overlay panel
 * and the /crawl page. Three rules it is built around:
 *
 *  - MOUSE ONLY. The overlay panel is a WS_EX_NOACTIVATE window so it never
 *    steals focus from what you are actually working on, which also means no
 *    keyboard event ever reaches it. Everything here is a click target.
 *  - NO TIMERS IN THE CLIENT. The enemy is on a wall clock, but nothing here
 *    counts it down. The server resolves swings whenever the run is read, and
 *    the event socket's heartbeat means "read" happens on its own — so the panel
 *    still has no interval of its own driving the game, and a closed panel and
 *    an open one see exactly the same run.
 *  - THE COMPACT PANEL SHOWS LESS. `compact` is the overlay, and it is parked on
 *    top of real work where height is the most expensive thing it can spend. It
 *    drops the depth strip, the energy counter, the banked-refill count and the
 *    run log; the /crawl page keeps all four, because there they cost nothing.
 *
 * All state comes from the server as whole snapshots; the component never
 * computes game state, only renders it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FLOORS,
  HAND_SIZE,
  MICRO_TENTHS_PER_DRAW,
  MOMENTUM_DAMAGE,
  ROOMS_PER_FLOOR,
  getCard,
  type CardId,
} from "@slaythelist/crawl-engine";
import {
  EVENTS_URL,
  chooseReward,
  descend,
  fetchCrawl,
  playCard,
  restartRun,
  type CrawlSnapshot,
} from "./data";
import styles from "./crawl.module.css";

/**
 * Backstop poll only. Energy arriving the moment you earn gold — and a swing
 * landing the moment it is owed — both come over the event socket; this just
 * covers a dropped connection or an API that was down when the panel opened.
 */
const POLL_MS = 60_000;
/** Backoff before retrying a dropped event socket. */
const RECONNECT_MS = 3_000;

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** "in 24 min" / "in 1 h 12 min", for the /crawl page's run line. */
function untilLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
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
  // appears the moment you earn it and a ward shatters the moment you tick the
  // pinned todo off — which is the reward, so it must not wait for a poll.
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

  const { state, energy, ward, drawCredits } = snap;
  // Warded, not locked: this only tells the player why the enemy is shielded.
  // Nothing in the panel is disabled because of it.
  const warded = ward !== null && !ward.done;
  const roomsCleared = (state.floor - 1) * ROOMS_PER_FLOOR + state.room;

  return (
    <div className={styles.root}>
      {/* The strip carries only what CHANGES, which in the panel is momentum and
          nothing else — so it is usually not there at all. Everything that used
          to sit here is said better by something already on screen: the floor
          number is true all day, the energy total is spelled out by which cards
          are lit and which are dimmed, and a banked refill announces itself by
          becoming a card. */}
      {(snap.momentum || !compact) && (
        <div className={styles.status}>
          {!compact && (
            <span className={styles.depth}>
              Floor {Math.min(state.floor, FLOORS)}/{FLOORS} · room{" "}
              {Math.min(state.room + 1, ROOMS_PER_FLOOR)}
            </span>
          )}
          <span className={styles.spacer} />
          {/* Not a sword: ⚔ now means "damage per swing" on the enemy plate, and
              two glyphs that both mean damage but point in opposite directions
              is the one confusion this strip can least afford. */}
          {snap.momentum && (
            <span className={styles.momentum} title={`Todo finished in the last hour: +${MOMENTUM_DAMAGE} damage`}>
              🔥+{MOMENTUM_DAMAGE}
            </span>
          )}
          {/* Refills in the bank — on the full page only. In the panel a credit
              has no counter at all: it is spent the instant a slot opens, so
              the card arriving IS the notification, and a number that is zero
              almost all the time is a permanent reminder of a resource the
              player never has to think about. */}
          {!compact && drawCredits > 0 && (
            <span
              className={styles.drawCredits}
              title={`${drawCredits} card refill${drawCredits === 1 ? "" : "s"} banked from today's micro-actions (${snap.microTenthsToday} tenths, ${MICRO_TENTHS_PER_DRAW} per refill). They fill empty slots the moment one opens; energy is what plays from them.`}
            >
              🃏{drawCredits}
            </span>
          )}
          {!compact && (
            <span
              className={energy > 0 ? styles.energy : `${styles.energy} ${styles.energyDim}`}
              title={`Energy is the gold you earned today (${snap.goldEarnedToday}). It expires at midnight and never lowers your balance.`}
            >
              ⚡{energy}
            </span>
          )}
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

      {/* The one place the run announces its depth. This screen is what bought
          the panel the right to drop the permanent floor/room strip: the number
          is worth a whole card at the moment it changes and worth nothing for
          the hours in between. It also parks the clock — no enemy, no swings —
          so it is a safe place to leave the run. */}
      {state.status === "floorCleared" && (
        <div className={styles.endState}>
          <div className={styles.endGlyph}>🪜</div>
          <div className={`${styles.endTitle} ${styles.endTitleWin}`}>Floor {state.floor - 1} cleared</div>
          <div className={styles.endNote}>
            Floor {Math.min(state.floor, FLOORS)} of {FLOORS} below.
          </div>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy}
            onClick={() => void act(descend)}
            title="Nothing swings at you until you open this door."
          >
            Go to floor {Math.min(state.floor, FLOORS)} ▾
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
                  disabled={busy}
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
            <button className={styles.btn} disabled={busy} onClick={() => void act(() => chooseReward(null))}>
              Skip
            </button>
          </div>
        </>
      )}

      {state.status === "fighting" && state.enemy && (
        <>
          <div className={`${styles.enemy} ${state.enemy.boss ? styles.enemyBoss : ""}`}>
            <span className={styles.enemyGlyph}>{state.enemy.glyph}</span>
            <div className={styles.enemyMain}>
              <div className={styles.enemyTop}>
                <span className={styles.enemyName}>{state.enemy.name}</span>
                <span className={styles.spacer} />
                {/* Same 🛡 idiom as the player's own block, because it is the
                    same thing pointed the other way. The pinned todo lives in
                    this tooltip rather than in a banner of its own: the shield
                    is the part you need at a glance, the reason is the part you
                    ask for. */}
                {state.enemy.ward > 0 && (
                  <span
                    className={styles.enemyWard}
                    title={
                      warded
                        ? `Warded by: ${ward.title}\n\nAbsorbs ${state.enemy.ward} more damage, and comes back on every swing until that todo is done.`
                        : `Absorbs ${state.enemy.ward} more damage.`
                    }
                  >
                    🛡{state.enemy.ward}
                  </span>
                )}
                {/* What the enemy hits for, folded into the numbers instead of a
                    row of prose below the bar. Every swing is this size — there
                    is no telegraphed heavy any more, so one number is the whole
                    truth and it fits beside the HP it is racing. */}
                <span
                  className={styles.enemyAttack}
                  title={`Hits for ${Math.max(1, state.enemy.attack - state.enemy.weakened)} every half hour, whether or not you are watching. Leave it long enough and the swings stop but a slow bleed starts.`}
                >
                  ⚔{Math.max(1, state.enemy.attack - state.enemy.weakened)}
                </span>
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
            </div>
          </div>

          <div className={styles.player}>
            <span className={styles.playerHpText}>
              ❤ {state.hp}/{state.maxHp}
            </span>
            <div className={`${styles.bar} ${styles.playerHp}`}>
              <div className={`${styles.barFill} ${styles.hpFill}`} style={{ width: `${pct(state.hp, state.maxHp)}%` }} />
            </div>
            {state.block > 0 && <span className={styles.blockPip}>🛡{state.block}</span>}
            {state.strength > 0 && <span className={styles.momentum}>+{state.strength}</span>}
          </div>

          {/* HAND_SIZE fixed slots. The row keeps one width and never reflows,
              and an empty slot is an honest signal — it is what a banked refill
              is waiting for, and what the next swing will fill for free. */}
          <div className={styles.hand}>
            {Array.from({ length: HAND_SIZE }, (_, i) => {
              const id: CardId | undefined = state.hand[i];
              const card = id ? getCard(id) : undefined;
              if (!card) {
                return (
                  <div
                    key={`empty-${i}`}
                    className={`${styles.card} ${styles.cardEmpty}`}
                    title="Fills on the enemy's next swing, or sooner off a micro-action."
                  />
                );
              }
              const unaffordable = card.cost > energy;
              return (
                <button
                  key={`${id}-${i}`}
                  className={styles.card}
                  disabled={busy || unaffordable}
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

          {/* No buttons at all during a fight. "End turn" is gone because there
              are no turns, and "Draw" is gone because a credit now fills the
              slot itself — which leaves the hand as the entire interface, and
              the panel two rows shorter. */}
        </>
      )}

      {error && <div className={styles.log}>⚠ {error}</div>}
      {!compact && (
        <div className={styles.log}>
          Deck {state.deck.length} · rooms cleared {roomsCleared} · best floor {state.meta.bestFloor} ·{" "}
          {state.meta.kills} kills
          {snap.msUntilSwing !== null && <> · next swing in {untilLabel(snap.msUntilSwing)}</>}
        </div>
      )}
    </div>
  );
}
