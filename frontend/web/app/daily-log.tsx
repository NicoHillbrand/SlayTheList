"use client";

import { useMemo, useState } from "react";
import type { GoldActivitySource, Habit, SharedDailyLogDay, SharedDailyLogEntry } from "@slaythelist/contracts";

// The most recent `n` days as {key: YYYY-MM-DD, label, subLabel}, oldest → newest.
export function lastNDays(n: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (n - 1 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: index === n - 1 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" }),
      subLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

// Read-only 7-day checkmark grid for a shared profile's habits. Regular habits
// and bonus habits are shown as two labeled sections.
export function HabitCheckGrid({ habits }: { habits: Habit[] }) {
  const days = useMemo(() => lastNDays(7), []);
  // Showcase only active habits (core + bonus); "idea"/archived habits would
  // otherwise appear as empty rows.
  const rows = habits.filter((habit) => (habit.status ?? "active") === "active");
  if (rows.length === 0) return null;
  const coreRows = rows.filter((h) => !h.bonus);
  const bonusRows = rows.filter((h) => h.bonus);
  const colSpan = days.length + 1;

  const renderRow = (habit: Habit, bonus: boolean) => (
    <tr key={habit.id} className={bonus ? "is-bonus" : ""}>
      <td className="social-habit-grid-name" title={habit.name}>
        {habit.name}
      </td>
      {days.map((day) => {
        const done = habit.checks.some((check) => check.date === day.key && check.done);
        return (
          <td key={`${habit.id}:${day.key}`} className="social-habit-grid-cell">
            <span className={`social-habit-grid-mark ${done ? "done" : ""} ${bonus ? "bonus" : ""}`}>
              {done ? "✓" : "·"}
            </span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="social-habit-grid-wrap">
      <table className="social-habit-grid">
        <thead>
          <tr>
            <th className="social-habit-grid-name" />
            {days.map((day) => (
              <th key={day.key} className="social-habit-grid-day">
                <span className="social-habit-grid-day-label">{day.label}</span>
                <span className="social-habit-grid-day-sub">{day.subLabel}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coreRows.map((habit) => renderRow(habit, false))}
          {bonusRows.length > 0 && (
            <>
              <tr className="social-habit-grid-section">
                <td colSpan={colSpan}>★ Bonus</td>
              </tr>
              {bonusRows.map((habit) => renderRow(habit, true))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

const DAILY_LOG_ICONS: Record<GoldActivitySource, string> = {
  todo: "✓",
  habit: "🔥",
  encouragement: "💬",
  manual: "✨",
  spend: "🛒",
  prediction: "🎯",
};

// Local YYYY-MM-DD (matches the backend ledger's localDateKey), so the
// "Today"/"Yesterday" labels stay correct across timezone offsets.
function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyLogDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const todayKey = localDayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);
  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function privateEntryLabel(source: GoldActivitySource) {
  switch (source) {
    case "todo":
      return "Completed a private task";
    case "habit":
      return "Checked a private habit";
    case "prediction":
      return "Gold staked on a private prediction";
    default:
      return "Private activity";
  }
}

function fallbackEntryLabel(source: GoldActivitySource) {
  switch (source) {
    case "todo":
      return "Completed a task";
    case "habit":
      return "Checked a habit";
    case "encouragement":
      return "Encouraged a friend";
    case "spend":
      return "Spent gold";
    case "prediction":
      return "Prediction stake";
    default:
      return "Earned gold";
  }
}

export function DailyLogDay({ day }: { day: SharedDailyLogDay }) {
  return (
    <div className="social-log-day">
      <div className="social-log-day-header">
        <span className="social-log-day-label">{dailyLogDayLabel(day.date)}</span>
        <span className={`social-log-day-total ${day.total < 0 ? "negative" : ""}`}>
          {day.total >= 0 ? "+" : ""}
          {day.total} gold
        </span>
      </div>
      <div className="social-log-entries">
        {day.entries.map((entry, index) => (
          <div key={`${day.date}:${index}`} className="social-log-entry">
            <span className="social-log-entry-icon">{DAILY_LOG_ICONS[entry.sourceType] ?? "•"}</span>
            <span className={`social-log-entry-label ${entry.private ? "is-private" : ""}`}>
              {entry.private ? privateEntryLabel(entry.sourceType) : entry.label || fallbackEntryLabel(entry.sourceType)}
            </span>
            <span className={`social-log-entry-delta ${entry.delta < 0 ? "negative" : ""}`}>
              {entry.delta >= 0 ? "+" : ""}
              {entry.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shareable achievement summary — a clean, screenshot-friendly overview of the
// last 1–3 days of gold-earning achievements, grouped by category per day, plus
// the habit grid.
// ---------------------------------------------------------------------------

type CategoryDef = {
  key: string;
  label: string;
  icon: string;
  match: (entry: SharedDailyLogEntry) => boolean;
};

// Named categories derived from the entry source. Everything non-private that
// doesn't match one of these (e.g. agent-submitted "manual" achievements) falls
// into "Other", alongside a single rolled-up row for private items.
const CATEGORIES: CategoryDef[] = [
  { key: "tasks", label: "Tasks", icon: "✓", match: (e) => e.sourceType === "todo" && !e.private },
  { key: "habits", label: "Habits", icon: "🔥", match: (e) => e.sourceType === "habit" && !e.private },
  {
    key: "predictions",
    label: "Predictions",
    icon: "🎯",
    match: (e) => e.sourceType === "prediction" && !e.private && e.delta > 0,
  },
];

// Entries never shown in the achievement view (not "achievements"). Negative
// prediction entries are the stakes placed at bet time — the resolution entry
// already carries the net result in its label, so showing the stake too would
// double-count the loss side.
function isExcluded(entry: SharedDailyLogEntry) {
  return (
    entry.sourceType === "spend" ||
    entry.sourceType === "encouragement" ||
    (entry.sourceType === "prediction" && entry.delta <= 0)
  );
}

function localKey(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sumDelta(entries: SharedDailyLogEntry[]) {
  return entries.reduce((total, entry) => total + entry.delta, 0);
}

const OTHER_CHIP = { key: "other", label: "Other", icon: "•" };

type DayModel = {
  key: string;
  groups: { key: string; label: string; icon: string; items: SharedDailyLogEntry[]; subtotal: number }[];
  otherTitled: SharedDailyLogEntry[];
  privateEntries: SharedDailyLogEntry[];
};

function buildDayModel(key: string, entries: SharedDailyLogEntry[]): DayModel {
  const groups = CATEGORIES.map((cat) => {
    const items = entries.filter(cat.match);
    return { key: cat.key, label: cat.label, icon: cat.icon, items, subtotal: sumDelta(items) };
  }).filter((g) => g.items.length > 0);

  // "Other" = non-private entries that matched no named category (e.g. agent
  // "manual" submissions), shown with their titles, plus one rolled-up row for
  // all private items (no titles).
  const namedMatch = (e: SharedDailyLogEntry) => CATEGORIES.some((c) => c.match(e));
  const otherTitled = entries.filter((e) => !e.private && !isExcluded(e) && !namedMatch(e));
  const privateEntries = entries.filter((e) => e.private && !isExcluded(e));
  return { key, groups, otherTitled, privateEntries };
}

export function AchievementSummary({
  days,
  habits,
  username,
  gold,
  showHabits = true,
}: {
  days: SharedDailyLogDay[];
  habits: Habit[];
  username?: string;
  gold?: number;
  showHabits?: boolean;
}) {
  const [numDays, setNumDays] = useState(2);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const dayByKey = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  // Most recent day first: today, yesterday, day-before.
  const perDay = Array.from({ length: numDays }, (_, i) => {
    const key = localKey(i);
    return buildDayModel(key, dayByKey.get(key)?.entries ?? []);
  });

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Category filter chips: only categories that appear somewhere in the range.
  const presentKeys = new Set<string>();
  perDay.forEach((d) => d.groups.forEach((g) => presentKeys.add(g.key)));
  const otherPresent = perDay.some((d) => d.otherTitled.length > 0 || d.privateEntries.length > 0);
  const chips = [
    ...CATEGORIES.filter((c) => presentKeys.has(c.key)),
    ...(otherPresent ? [OTHER_CHIP] : []),
  ];

  const otherTotalFor = (d: DayModel) => sumDelta(d.otherTitled) + sumDelta(d.privateEntries);
  const daySubtotal = (d: DayModel) =>
    d.groups.filter((g) => !hidden.has(g.key)).reduce((s, g) => s + g.subtotal, 0) +
    (!hidden.has("other") ? otherTotalFor(d) : 0);
  const grandTotal = perDay.reduce((s, d) => s + daySubtotal(d), 0);

  const rangeLabel = numDays === 1 ? "Last day" : `Last ${numDays} days`;

  return (
    <div className="achievement-card">
      <div className="achievement-range-toggle">
        <span className="achievement-range-prefix">Last</span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            className={`achievement-range-btn ${numDays === n ? "active" : ""}`}
            onClick={() => setNumDays(n)}
          >
            {n}
          </button>
        ))}
        <span className="achievement-range-prefix">{numDays === 1 ? "day" : "days"}</span>
      </div>

      <div className="achievement-header">
        <div className="achievement-header-text">
          {username && <span className="achievement-user">@{username}</span>}
          <span className="achievement-range-label">{rangeLabel}</span>
        </div>
        <div className="achievement-total">
          <span className="achievement-total-value">{grandTotal}</span>
          <span className="achievement-total-unit">gold earned</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="achievement-filters">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`achievement-filter-chip ${hidden.has(chip.key) ? "is-off" : ""}`}
              onClick={() => toggle(chip.key)}
            >
              <span className="achievement-filter-icon">{chip.icon}</span>
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <div className="achievement-days">
        {perDay.map((d) => {
          const visibleGroups = d.groups.filter((g) => !hidden.has(g.key));
          const showOther = !hidden.has("other") && (d.otherTitled.length > 0 || d.privateEntries.length > 0);
          const empty = visibleGroups.length === 0 && !showOther;
          return (
            <div key={d.key} className="achievement-day">
              <div className="achievement-day-header">
                <span className="achievement-day-label">{dailyLogDayLabel(d.key)}</span>
                <span className="achievement-day-total">+{daySubtotal(d)}</span>
              </div>

              {empty ? (
                <p className="achievement-empty">Nothing logged.</p>
              ) : (
                <div className="achievement-categories">
                  {visibleGroups.map((group) => (
                    <div key={group.key} className="achievement-category">
                      <div className="achievement-category-header">
                        <span className="achievement-category-icon">{group.icon}</span>
                        <span className="achievement-category-name">{group.label}</span>
                        <span className="achievement-category-count">{group.items.length}</span>
                        <span className="achievement-category-total">+{group.subtotal}</span>
                      </div>
                      <div className="achievement-items">
                        {group.items.map((entry, index) => (
                          <div key={`${group.key}:${index}`} className="achievement-item">
                            <span className="achievement-item-label">{entry.label || `${group.label} item`}</span>
                            <span className="achievement-item-delta">+{entry.delta}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {showOther && (
                    <div className="achievement-category">
                      <div className="achievement-category-header">
                        <span className="achievement-category-icon">{OTHER_CHIP.icon}</span>
                        <span className="achievement-category-name">Other</span>
                        <span className="achievement-category-count">
                          {d.otherTitled.length + d.privateEntries.length}
                        </span>
                        <span className="achievement-category-total">+{otherTotalFor(d)}</span>
                      </div>
                      <div className="achievement-items">
                        {d.otherTitled.map((entry, index) => (
                          <div key={`other:${index}`} className="achievement-item">
                            <span className="achievement-item-label">{entry.label || "Achievement"}</span>
                            <span className="achievement-item-delta">+{entry.delta}</span>
                          </div>
                        ))}
                        {d.privateEntries.length > 0 && (
                          <div className="achievement-item">
                            <span className="achievement-item-label is-private">
                              Private items{d.privateEntries.length > 1 ? ` (${d.privateEntries.length})` : ""}
                            </span>
                            <span className="achievement-item-delta">+{sumDelta(d.privateEntries)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showHabits && habits.length > 0 && (
        <div className="achievement-habits">
          <p className="achievement-section-label">Habits this week</p>
          <HabitCheckGrid habits={habits} />
        </div>
      )}
    </div>
  );
}

// Renders the full "Daily log" timeline (recent days open, older collapsed).
export function DailyLogTimeline({ days }: { days: SharedDailyLogDay[] }) {
  if (days.length === 0) {
    return <p className="settings-hint">No gold earned yet.</p>;
  }
  const recent = days.slice(0, 2);
  const older = days.slice(2);
  return (
    <div className="social-log-timeline">
      {recent.map((day) => (
        <DailyLogDay key={day.date} day={day} />
      ))}
      {older.length > 0 && (
        <details className="social-log-past">
          <summary className="social-day-label">Previous days</summary>
          {older.map((day) => (
            <DailyLogDay key={day.date} day={day} />
          ))}
        </details>
      )}
    </div>
  );
}
