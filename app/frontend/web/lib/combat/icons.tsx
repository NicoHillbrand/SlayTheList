/**
 * Card sigils — a cohesive set of "arcane emblem" glyphs used as card art.
 * Deliberately abstract/geometric rather than literal creatures: it reads as
 * an intentional, premium card game and stays crisp at any size. Everything is
 * a single-color shape drawn with `currentColor`, so cards tint the sigil to
 * their faction colour (and gold on the shop frames) purely via CSS.
 */
import type { CSSProperties } from "react";

export type SigilKind =
  | "leaf"
  | "flame"
  | "drop"
  | "crystal"
  | "spark"
  | "arcane"
  | "stone"
  | "shield"
  | "fang"
  | "feather"
  | "moon"
  | "eye";

function polygon(cx: number, cy: number, r: number, sides: number, rotDeg = -90): string {
  const rot = (rotDeg * Math.PI) / 180;
  const points: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = rot + (i * 2 * Math.PI) / sides;
    points.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return points.join(" ");
}

function starPoints(cx: number, cy: number, ro: number, ri: number, spikes: number, rotDeg = -90): string {
  const rot = (rotDeg * Math.PI) / 180;
  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? ro : ri;
    const a = rot + (i * Math.PI) / spikes;
    points.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return points.join(" ");
}

function Body({ kind }: { kind: SigilKind }) {
  switch (kind) {
    case "leaf":
      return (
        <>
          <path d="M50 90 C20 70 20 32 50 10 C80 32 80 70 50 90 Z" />
          <path d="M50 20 L50 84" stroke="rgba(0,0,0,0.35)" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      );
    case "flame":
      return <path d="M50 8 C50 8 84 46 84 66 A34 34 0 1 1 16 66 C16 46 50 8 50 8 Z" />;
    case "drop":
      return (
        <>
          <path d="M50 10 C50 10 82 48 82 66 A32 32 0 1 1 18 66 C18 48 50 10 50 10 Z" />
          <circle cx={40} cy={62} r={7} fill="rgba(255,255,255,0.4)" />
        </>
      );
    case "crystal":
      return (
        <>
          <path d="M50 6 L80 40 L50 94 L20 40 Z" />
          <path d="M50 6 L50 94 M20 40 L80 40" stroke="rgba(0,0,0,0.3)" strokeWidth={2.5} fill="none" />
        </>
      );
    case "spark":
      return <path d="M50 4 C55 34 66 45 96 50 C66 55 55 66 50 96 C45 66 34 55 4 50 C34 45 45 34 50 4 Z" />;
    case "arcane":
      return (
        <>
          <polygon points={starPoints(50, 50, 44, 18, 6)} />
          <circle cx={50} cy={50} r={9} fill="rgba(0,0,0,0.3)" />
        </>
      );
    case "stone":
      return (
        <>
          <polygon points={polygon(50, 50, 42, 6, 0)} />
          <polygon points={polygon(50, 50, 24, 6, 0)} fill="rgba(0,0,0,0.22)" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M50 8 L84 22 C84 56 71 82 50 92 C29 82 16 56 16 22 Z" />
          <path d="M50 26 L50 74 M32 40 L68 40" stroke="rgba(0,0,0,0.3)" strokeWidth={4} fill="none" strokeLinecap="round" />
        </>
      );
    case "fang":
      return (
        <>
          <path d="M28 16 C32 54 39 80 44 86 C45 80 47 54 47 16 Z" />
          <path d="M53 16 C53 54 55 80 56 86 C61 80 68 54 72 16 Z" />
        </>
      );
    case "feather":
      return (
        <>
          <path d="M74 20 C46 28 30 54 25 82 C24 88 31 88 34 82 C42 62 53 51 70 45 C77 43 80 28 74 20 Z" />
          <path d="M70 26 L30 80" stroke="rgba(0,0,0,0.3)" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      );
    case "moon":
      return <path d="M58 10 A42 42 0 1 0 58 90 A32 32 0 1 1 58 10 Z" />;
    case "eye":
      return (
        <>
          <path d="M8 50 Q50 18 92 50 Q50 82 8 50 Z" />
          <circle cx={50} cy={50} r={15} fill="rgba(0,0,0,0.45)" />
          <circle cx={45} cy={45} r={4} fill="rgba(255,255,255,0.7)" />
        </>
      );
    default:
      return <circle cx={50} cy={50} r={38} />;
  }
}

export function Sigil({
  kind,
  size = 64,
  className,
  style,
}: {
  kind: SigilKind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="currentColor"
      aria-hidden
    >
      <Body kind={kind} />
    </svg>
  );
}

/** Small stat icons for attack / health, drawn inline so they inherit colour. */
export function SwordIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M6.9 3H3v3.9l9 9 2.2-2.2-9-9L6.9 3zM14.3 14.8l1.4-1.4 4.6 4.6-.7 2.8-2.8.7-4.6-4.6 1.4-1.4-.3-.3 1.4-1.4.2.4z" />
    </svg>
  );
}

export function HeartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 21s-7.5-4.9-10-9.5C.6 8.6 2 5 5.4 5c2 0 3.4 1.2 4.6 2.7C11.2 6.2 12.6 5 14.6 5 18 5 19.4 8.6 22 11.5 19.5 16.1 12 21 12 21z" />
    </svg>
  );
}

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6.2" fill="rgba(0,0,0,0.22)" />
      <path d="M12 8.2v7.6M9.6 10.2h3.1a1.4 1.4 0 0 1 0 2.8H9.6h3.4a1.4 1.4 0 0 1 0 2.8H9.6" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}
