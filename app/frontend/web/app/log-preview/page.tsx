"use client";

// Standalone visual-iteration surface for the shareable achievement summary.
// Renders the exact same component (and CSS) used on your own social profile,
// but with fixed sample data so the look can be refined and screenshotted
// without a cloud connection or ledger history.
//
// Not linked from anywhere in the app — visit /log-preview directly.

import { useState } from "react";
import type { Habit, Prediction, SharedDailyLogDay } from "@slaythelist/contracts";
import { AchievementSummary, PeriodSelector, defaultLogPeriod } from "../daily-log";

function dayKey(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ms timestamp at midday `offset` days ago (for prediction resolvedAt).
function at(offset: number) {
  return new Date(`${dayKey(offset)}T12:00:00`).getTime();
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

// Resolved, staked predictions spread across the week (enough to draw a
// calibration curve in the week view).
const SAMPLE_PREDICTIONS: Prediction[] = [
  { id: "p1", title: "Answer grant application emails", confidence: 95, outcome: "hit", createdAt: at(1), resolvedAt: at(0), stake: 10, payout: 20 },
  { id: "p2", title: "No buying sweets today", confidence: 75, outcome: "miss", createdAt: at(1), resolvedAt: at(0), stake: 10, payout: 0 },
  { id: "p3", title: "Finish the design doc", confidence: 60, outcome: "hit", createdAt: at(2), resolvedAt: at(1), stake: 5, payout: 7 },
  { id: "p4", title: "Ship before standup", confidence: 80, outcome: "hit", createdAt: at(3), resolvedAt: at(1), stake: 8, payout: 13 },
  { id: "p5", title: "Reply to Felix by noon", confidence: 90, outcome: "miss", createdAt: at(3), resolvedAt: at(2), stake: 6, payout: 0 },
  { id: "p6", title: "Run 5k", confidence: 65, outcome: "hit", createdAt: at(4), resolvedAt: at(3), stake: 4, payout: 6 },
  { id: "p7", title: "Inbox zero", confidence: 55, outcome: "miss", createdAt: at(5), resolvedAt: at(4), stake: 3, payout: 2 },
  // Still-pending bets (show on the day they were made).
  { id: "p8", title: "Finish the grant draft today", confidence: 70, outcome: "pending", createdAt: at(0), resolvedAt: null, stake: 8 },
  { id: "p9", title: "Gym before noon", confidence: 60, outcome: "pending", createdAt: at(1), resolvedAt: null },
];

// Mirrors the social-tab layout: the period selector sits in the header row
// (left of "View base"), and the card below reflects the selected period.
function PreviewProfile({ label, compact }: { label: string; compact?: boolean }) {
  const [period, setPeriod] = useState<string>(defaultLogPeriod());
  return (
    <div style={{ flex: compact ? "1 1 360px" : "1 1 480px", maxWidth: compact ? 400 : 540 }}>
      <p className="settings-hint" style={{ marginBottom: "0.5rem" }}>{label}</p>
      <div className="social-profile-content">
        <div className="social-profile-top">
          <h4>@marcus_hillbrand</h4>
          <span className="social-gold-value">145 gold</span>
          <div className="social-profile-top-actions">
            <PeriodSelector selected={period} onSelect={setPeriod} />
            <a className="achievement-period-pill" href="#" style={{ textDecoration: "none" }}>
              View base
            </a>
          </div>
        </div>
        <AchievementSummary
          days={SAMPLE_LOG}
          habits={SAMPLE_HABITS}
          predictions={SAMPLE_PREDICTIONS}
          selected={period}
          compact={compact}
        />
      </div>
    </div>
  );
}

export default function LogPreviewPage() {
  return (
    <div style={{ padding: "1.5rem", display: "flex", gap: "2rem", flexWrap: "wrap", justifyContent: "center" }}>
      <PreviewProfile label="Full (future dedicated page)" />
      <PreviewProfile label="Compact (social tab)" compact />
    </div>
  );
}
