"use client";

import type { CSSProperties, ReactNode } from "react";
import { FACTION_COLOR, RARITY_COLOR, RARITY_LABEL, describeAbility, type GameCard } from "./cards";
import { CoinIcon, HeartIcon, Sigil, SwordIcon } from "./icons";
import styles from "../../app/combat/combat.module.css";

interface CardViewProps {
  card: GameCard;
  size?: "full" | "sm";
  dim?: boolean;
  onClick?: () => void;
  footer?: ReactNode;
  /** Show a shard (◈) price instead of the default real-gold unlock cost. */
  shardCost?: number;
  /** Hide the price pill entirely (e.g. cards already on your team). */
  hideCost?: boolean;
}

export function CardView({ card, size = "full", dim, onClick, footer, shardCost, hideCost }: CardViewProps) {
  const accent = FACTION_COLOR[card.faction];
  const rarity = RARITY_COLOR[card.rarity];
  const style = { ["--accent"]: accent, ["--rarity"]: rarity } as CSSProperties;

  const classes = [
    styles.card,
    size === "sm" ? styles.cardSm : "",
    card.rarity === "legendary" ? styles.cardLegendary : "",
    onClick ? styles.cardClickable : "",
    dim ? styles.cardDim : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={style}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      title={size === "sm" && card.ability ? describeAbility(card.ability) : undefined}
    >
      <div className={styles.cardInner}>
        <div className={styles.cardHead}>
          <span className={styles.cardName}>{card.name}</span>
          {!hideCost &&
            (shardCost !== undefined ? (
              <span className={`${styles.cost} ${styles.costShard}`}>◈{shardCost}</span>
            ) : (
              <span className={styles.cost}>
                <CoinIcon size={13} />
                {card.cost}
              </span>
            ))}
        </div>

        <div className={styles.art}>
          <span
            className={styles.roleTag}
            title={card.ranged ? "Ranged — attacks from any position, hits a random enemy" : "Melee — attacks only while holding the front slot"}
          >
            {card.ranged ? "🏹" : "⚔"}
          </span>
          <span className={styles.rarityPip}>{RARITY_LABEL[card.rarity]}</span>
          {card.level && <span className={styles.starBadge}>{"★".repeat(card.level)}</span>}
          <Sigil kind={card.sigil} size={size === "sm" ? 40 : 62} />
        </div>

        <div className={styles.stats}>
          <span className={`${styles.stat} ${styles.atk}`}>
            <SwordIcon size={15} />
            {card.attack}
          </span>
          <span className={`${styles.stat} ${styles.spd}`} title="attacks per second">
            ⚡{card.attackSpeed}
          </span>
          <span className={`${styles.stat} ${styles.hp}`}>
            <HeartIcon size={15} />
            {card.health}
          </span>
        </div>

        {size === "full" && (
          <div className={styles.rulesBox}>
            {card.ability && <div className={styles.abilityText}>{describeAbility(card.ability)}</div>}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
