/** Achievement badges — earned once, displayed on the Arena home screen. */

export interface Badge {
  id: string;
  name: string;
  desc: string;
  glyph: string;
}

export const BADGES: Badge[] = [
  { id: "first-victory", name: "Runbreaker", desc: "Clear your first expedition", glyph: "🏆" },
  { id: "flawless", name: "Untouchable", desc: "Clear an expedition without losing a life", glyph: "🛡" },
  { id: "survivor", name: "Deep Run", desc: "Win 5+ stages in a single expedition", glyph: "🗡" },
  { id: "maxed", name: "Full Muster", desc: "Reach level 5 in an expedition", glyph: "⭐" },
  { id: "gauntlet", name: "Keeper of Keepers", desc: "Clear all seven expeditions", glyph: "🗝" },
  { id: "heavy-hitter", name: "Heavy Hitter", desc: "Deal 450+ damage in a training test", glyph: "💥" },
];

export function getBadge(id: string): Badge | undefined {
  return BADGES.find((b) => b.id === id);
}
