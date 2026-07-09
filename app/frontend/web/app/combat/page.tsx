"use client";

import { useCallback, useEffect, useState } from "react";
import { CardView } from "../../lib/combat/CardView";
import { RunMode, TrainingMode, getActiveRunExpeditionId } from "../../lib/combat/RunMode";
import { BADGES } from "../../lib/combat/badges";
import { CARD_LIST, FACTION_COLOR, deckPower, getCard, type GameCard } from "../../lib/combat/cards";
import { CoinIcon, Sigil } from "../../lib/combat/icons";
import { EXPEDITIONS, getExpedition } from "../../lib/combat/opponents";
import {
  awardEmeralds,
  getGold,
  isPracticeMode,
  loadProgress,
  resetProgress,
  saveProgress,
  spendGold,
  type CombatProgress,
} from "../../lib/combat/data";
import styles from "./combat.module.css";

const SQUAD_MAX = 6;

type Phase = "map" | "run" | "training" | "collection";

export default function CombatPage() {
  const [phase, setPhase] = useState<Phase>("map");
  const [gold, setGold] = useState(0);
  const [practice, setPractice] = useState(false);
  const [progress, setProgressState] = useState<CombatProgress | null>(null);
  const [expeditionId, setExpeditionId] = useState<string | null>(null);

  const refreshGold = useCallback(async () => {
    setGold(await getGold());
    setPractice(isPracticeMode());
  }, []);

  useEffect(() => {
    setProgressState(loadProgress());
    void refreshGold();
  }, [refreshGold]);

  function persist(next: CombatProgress) {
    setProgressState(next);
    saveProgress(next);
  }

  if (!progress) {
    return (
      <div className={styles.root}>
        <div className={styles.content}>
          <div className={styles.scroll}>
            <div className={styles.shell}>Loading the Arena…</div>
          </div>
        </div>
      </div>
    );
  }

  const owned = new Set(progress.ownedCardIds);
  const squad = progress.deckCardIds;
  const cleared = new Set(progress.defeatedOpponentIds);
  const expedition = expeditionId ? getExpedition(expeditionId) : null;

  function isUnlocked(index: number): boolean {
    if (index === 0) return true;
    return cleared.has(EXPEDITIONS[index - 1].id);
  }

  function grantBadges(current: CombatProgress, badgeIds: string[]): CombatProgress {
    const merged = [...new Set([...current.badges, ...badgeIds])];
    return merged.length === current.badges.length ? current : { ...current, badges: merged };
  }

  async function buy(card: GameCard) {
    if (gold < card.cost || owned.has(card.id)) return;
    const newGold = await spendGold(card.cost);
    setGold(newGold);
    setPractice(isPracticeMode());
    persist({ ...progress!, ownedCardIds: [...progress!.ownedCardIds, card.id] });
  }

  function toggleSquad(card: GameCard) {
    if (!owned.has(card.id)) return;
    if (squad.includes(card.id)) {
      persist({ ...progress!, deckCardIds: squad.filter((id) => id !== card.id) });
    } else if (squad.length < SQUAD_MAX) {
      persist({ ...progress!, deckCardIds: [...squad, card.id] });
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.brandBox}>
          <span className={styles.brand}>Arena</span>
        </div>
        <div className={styles.spacer} />
        {practice && <span className={styles.practiceTag}>practice wallet · API offline</span>}
        <div className={styles.wallet}>
          <span className={styles.walletSvg}>
            <CoinIcon size={17} />
          </span>
          {gold}
        </div>
        {phase === "map" ? (
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => (window.location.href = "/")}>
            ← App
          </button>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => {
              setPhase("map");
              void refreshGold();
            }}
          >
            ← Map
          </button>
        )}
      </div>

      <div className={styles.content}>
        {phase === "map" && (
          <div className={styles.scroll}>
            <div className={styles.shell}>
              <div className={styles.mapActions}>
                <button className={styles.btn} onClick={() => setPhase("collection")}>
                  🃏 Collection
                </button>
                <button className={styles.btn} onClick={() => setPhase("training")}>
                  🎯 Training
                </button>
              </div>

              <ExpeditionMap
                cleared={cleared}
                isUnlocked={isUnlocked}
                onPick={(id) => {
                  setExpeditionId(id);
                  setPhase("run");
                }}
              />

              <div className={styles.sectionTitle}>Badges</div>
              <div className={styles.badgeRow}>
                {BADGES.map((badge) => {
                  const earned = progress.badges.includes(badge.id);
                  return (
                    <div key={badge.id} className={`${styles.badge} ${earned ? "" : styles.badgeDim}`} title={badge.desc}>
                      <span className={styles.badgeGlyph}>{badge.glyph}</span>
                      <span>{badge.name}</span>
                    </div>
                  );
                })}
              </div>

              <div className={styles.sectionTitle}>Danger zone</div>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => {
                  resetProgress();
                  setProgressState(loadProgress());
                  void refreshGold();
                }}
              >
                Reset progress &amp; practice wallet
              </button>
            </div>
          </div>
        )}

        {phase === "run" && expedition && (
          <RunMode
            key={expedition.id}
            expedition={expedition}
            pool={progress.ownedCardIds}
            ownedBadges={progress.badges}
            alreadyCleared={cleared.has(expedition.id)}
            onExit={() => {
              setPhase("map");
              void refreshGold();
            }}
            onRunEnd={async (victory, rewards) => {
              await awardEmeralds(rewards.emeralds);
              setPractice(isPracticeMode());
              let next = progress!;
              if (victory && !next.defeatedOpponentIds.includes(expedition.id)) {
                next = { ...next, defeatedOpponentIds: [...next.defeatedOpponentIds, expedition.id] };
              }
              const badgeIds = [...rewards.badgeIds];
              if (next.defeatedOpponentIds.length >= EXPEDITIONS.length) badgeIds.push("gauntlet");
              next = grantBadges(next, badgeIds);
              persist(next);
            }}
          />
        )}

        {phase === "training" && (
          <TrainingMode
            deck={squad}
            onExit={() => setPhase("map")}
            onBadge={(id) => persist(grantBadges(progress, [id]))}
          />
        )}

        {phase === "collection" && (
          <div className={styles.scroll}>
            <div className={styles.shell}>
              <div className={styles.mapIntro}>
                <h1>Collection</h1>
              </div>

              <div className={styles.sectionTitle}>
                Training squad · {squad.length}/{SQUAD_MAX} · power {deckPower(squad)}
              </div>
              <div className={styles.deckTray}>
                {squad.length === 0 && <div className={styles.deckEmpty}>Add owned cards from below.</div>}
                {squad.map((id, i) => {
                  const card = getCard(id);
                  if (!card) return null;
                  return <CardView key={`${id}-${i}`} card={card} size="sm" onClick={() => toggleSquad(card)} />;
                })}
              </div>

              <div className={styles.sectionTitle}>Cards — owned cards appear in expedition shops</div>
              <div className={styles.cardRow}>
                {CARD_LIST.map((card) => {
                  const isOwned = owned.has(card.id);
                  const inSquad = squad.includes(card.id);
                  const canBuy = !isOwned && gold >= card.cost;
                  const footer = isOwned ? (
                    inSquad ? (
                      <button className={styles.inDeckBtn} onClick={() => toggleSquad(card)}>
                        ✓ In squad — remove
                      </button>
                    ) : (
                      <button className={styles.buyBtn} disabled={squad.length >= SQUAD_MAX} onClick={() => toggleSquad(card)}>
                        {squad.length >= SQUAD_MAX ? "Squad full" : "Add to squad"}
                      </button>
                    )
                  ) : (
                    <button className={styles.buyBtn} disabled={!canBuy} onClick={() => buy(card)}>
                      Unlock · {card.cost} <CoinIcon size={11} />
                    </button>
                  );
                  return <CardView key={card.id} card={card} dim={!isOwned} footer={footer} />;
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The trail — each node is an expedition (a full run of `stages` fights).
// ---------------------------------------------------------------------------

const NODE_X = [50, 23, 71, 25, 73, 32, 52]; // percentages, per node
const NODE_GAP = 185;
const MAP_PAD = 105;

function ExpeditionMap({
  cleared,
  isUnlocked,
  onPick,
}: {
  cleared: Set<string>;
  isUnlocked: (index: number) => boolean;
  onPick: (id: string) => void;
}) {
  const n = EXPEDITIONS.length;
  const height = (n - 1) * NODE_GAP + MAP_PAD * 2;
  const activeRunId = getActiveRunExpeditionId();

  const points = EXPEDITIONS.map((_, i) => ({
    x: NODE_X[i % NODE_X.length],
    y: height - MAP_PAD - i * NODE_GAP,
  }));

  function pathThrough(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return "";
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const midY = (prev.y + cur.y) / 2;
      d += ` C ${prev.x} ${midY}, ${cur.x} ${midY}, ${cur.x} ${cur.y}`;
    }
    return d;
  }

  let furthest = 0;
  for (let i = 0; i < n; i += 1) if (isUnlocked(i)) furthest = i;

  return (
    <div className={styles.questWrap} style={{ height }}>
      <svg className={styles.questSvg} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <path className={styles.qpath} d={pathThrough(points)} />
        <path className={styles.qpathDone} d={pathThrough(points.slice(0, furthest + 1))} />
      </svg>

      {EXPEDITIONS.map((exp, i) => {
        const unlocked = isUnlocked(i);
        const done = cleared.has(exp.id);
        const isNext = unlocked && !done;
        const resuming = activeRunId === exp.id;
        const accent = FACTION_COLOR[exp.faction];
        const cls = [
          styles.qnode,
          unlocked ? "" : styles.qnodeLocked,
          isNext ? styles.qnodeNext : "",
          exp.boss ? styles.qnodeBoss : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={exp.id}
            className={cls}
            style={{ left: `${points[i].x}%`, top: points[i].y, ["--accent"]: accent } as React.CSSProperties}
            onClick={unlocked ? () => onPick(exp.id) : undefined}
            title={exp.flavor}
          >
            <div className={styles.qportrait}>
              {exp.boss && <span className={styles.qbossBadge}>BOSS</span>}
              <Sigil kind={exp.sigil} size={exp.boss ? 46 : 36} />
              {done && <span className={styles.qcheck}>✓</span>}
              {!unlocked && <span className={styles.qlock}>🔒</span>}
            </div>
            <div className={styles.qname}>{exp.name}</div>
            <div className={styles.qtitle}>{exp.title}</div>
            <div className={styles.qstages}>
              {exp.stages} stages
              {resuming && <span className={styles.qresume}> · ▶ resume</span>}
            </div>
            {!done && <div className={`${styles.qbounty} ${styles.emeraldText}`}>◆ {exp.reward}</div>}
          </div>
        );
      })}
    </div>
  );
}
