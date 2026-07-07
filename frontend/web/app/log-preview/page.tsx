"use client";

// Standalone visual-iteration surface for the shareable achievement summary.
// Renders the exact same component (and CSS) used on your own social profile,
// but with fixed sample data so the look can be refined and screenshotted
// without a cloud connection or ledger history.
//
// Not linked from anywhere in the app — visit /log-preview directly.

import type { Habit, SharedDailyLogDay } from "@slaythelist/contracts";
import { AchievementSummary } from "../daily-log";

function dayKey(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function check(offsets: number[]) {
  return offsets.map((o) => ({ date: dayKey(o), done: true }));
}

const SAMPLE_HABITS: Habit[] = [
  { id: "h1", name: "Meditate 13 min", checks: check([0, 1, 3, 4, 5, 6]), createdAt: 0, status: "active" },
  { id: "h2", name: "15 min reading", checks: check([0, 2, 3, 4, 6]), createdAt: 0, status: "active" },
  { id: "h3", name: "No phone after 22:30", checks: check([1, 2, 3, 5, 6]), createdAt: 0, status: "active" },
  { id: "h4", name: "3h deep work", checks: check([0, 1, 4]), createdAt: 0, status: "active" },
  { id: "b1", name: "Cold shower", checks: check([0, 2, 5]), createdAt: 0, status: "active", bonus: true },
  { id: "b2", name: "Gym session", checks: check([1, 4]), createdAt: 0, status: "active", bonus: true },
];

const SAMPLE_LOG: SharedDailyLogDay[] = [
  {
    date: dayKey(0),
    total: 34,
    entries: [
      { delta: 5, sourceType: "todo", label: "Ship the daily-log PR", private: false },
      { delta: 5, sourceType: "todo", label: "Email the landlord", private: false },
      { delta: 2, sourceType: "manual", label: "Refactored the auth module", private: false },
      { delta: 3, sourceType: "manual", label: "Wrote migration tests", private: false },
      { delta: 5, sourceType: "todo", label: null, private: true },
      { delta: 9, sourceType: "habit", label: "Meditate 13 min (5-day streak)", private: false },
      { delta: 5, sourceType: "habit", label: "15 min reading", private: false },
    ],
  },
  {
    date: dayKey(1),
    total: 26,
    entries: [
      { delta: 5, sourceType: "todo", label: "Draft Q3 plan", private: false },
      { delta: 5, sourceType: "todo", label: "Fix the sync bug", private: false },
      { delta: 8, sourceType: "habit", label: "3h deep work (4-day streak)", private: false },
      { delta: 5, sourceType: "habit", label: "No phone after 22:30", private: false },
      { delta: 3, sourceType: "todo", label: null, private: true },
      { delta: 2, sourceType: "encouragement", label: "Encouraged @sam", private: false },
      { delta: -2, sourceType: "spend", label: "Unlocked a zone", private: false },
    ],
  },
  {
    date: dayKey(2),
    total: 16,
    entries: [
      { delta: 5, sourceType: "todo", label: "Write journal entry", private: false },
      { delta: 6, sourceType: "habit", label: "15 min reading", private: false },
      { delta: 5, sourceType: "todo", label: null, private: true },
    ],
  },
];

export default function LogPreviewPage() {
  return (
    <div style={{ padding: "1.5rem", maxWidth: 520, margin: "0 auto" }}>
      <AchievementSummary days={SAMPLE_LOG} habits={SAMPLE_HABITS} username="marcus_hillbrand" gold={324} />
    </div>
  );
}
