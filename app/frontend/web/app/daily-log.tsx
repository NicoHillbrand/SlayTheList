"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toBlob } from "html-to-image";
import type { Habit, Prediction, SharedDailyLogDay, SharedDailyLogEntry } from "@slaythelist/contracts";

// Fixed English locale (day-before-month) so dates don't follow the OS/browser
// locale — and so server and client render identically (no hydration mismatch).
const DATE_LOCALE = "en-GB";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

// Local YYYY-MM-DD (matches the backend ledger's localDateKey), so labels stay
// correct across timezone offsets.
function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Key for `offset` days ago (0 = today).
function keyDaysAgo(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return localDayKey(d);
}

export function dailyLogDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const todayKey = keyDaysAgo(0);
  const yesterdayKey = keyDaysAgo(1);
  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString(DATE_LOCALE, { weekday: "long", month: "long", day: "numeric" });
}

// The `n` days ending on `endKey`, oldest → newest, for the habit grid columns.
function daysEndingKey(endKey: string, n: number) {
  const end = new Date(`${endKey}T00:00:00`);
  const todayKey = keyDaysAgo(0);
  return Array.from({ length: n }).map((_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (n - 1 - index));
    const key = localDayKey(date);
    return {
      key,
      label: key === todayKey ? "Today" : date.toLocaleDateString(DATE_LOCALE, { weekday: "short" }),
      subLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Habit grid — read-only 7-day checkmarks, ending on `endKey` (default today).
// Bonus habits get their own labeled section but share the regular styling.
// ---------------------------------------------------------------------------

export function HabitCheckGrid({
  habits,
  endKey,
  columns = 7,
}: {
  habits: Habit[];
  endKey?: string;
  columns?: number;
}) {
  const end = endKey ?? keyDaysAgo(0);
  // Never let the grid grow past a week — it stays screenshot-friendly.
  const n = Math.max(1, Math.min(columns, 7));
  const days = useMemo(() => daysEndingKey(end, n), [end, n]);
  const rows = habits.filter((habit) => (habit.status ?? "active") === "active");
  // Core habits always show. Bonus habits only show if they were actually done
  // at least once in the visible window (no point listing dormant bonus habits).
  const windowKeys = new Set(days.map((d) => d.key));
  const doneInWindow = (h: Habit) => h.checks.some((c) => c.done && windowKeys.has(c.date));
  const coreRows = rows.filter((h) => !h.bonus);
  const bonusRows = rows.filter((h) => h.bonus && doneInWindow(h));
  if (coreRows.length === 0 && bonusRows.length === 0) return null;
  const colSpan = days.length + 1;
  const todayKey = keyDaysAgo(0);

  const renderRow = (habit: Habit) => (
    <tr key={habit.id}>
      <td className="social-habit-grid-name" title={habit.name}>
        {habit.name}
      </td>
      {days.map((day) => {
        const done = habit.checks.some((check) => check.date === day.key && check.done);
        return (
          <td key={`${habit.id}:${day.key}`} className="social-habit-grid-cell">
            <span className={`social-habit-grid-mark ${done ? "done" : ""}`}>{done ? "✓" : "·"}</span>
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
              <th
                key={day.key}
                className={`social-habit-grid-day ${day.key === todayKey ? "is-today" : ""}`}
              >
                <span className="social-habit-grid-day-label">{day.label}</span>
                <span className="social-habit-grid-day-sub">{day.subLabel}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coreRows.map(renderRow)}
          {bonusRows.length > 0 && (
            <>
              <tr className="social-habit-grid-section">
                <td colSpan={colSpan}>Bonus</td>
              </tr>
              {bonusRows.map(renderRow)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gold ledger → category groups. Predictions are handled separately (below),
// so prediction/spend/encouragement ledger entries never appear here.
// ---------------------------------------------------------------------------

// Log entries as this component consumes them: the privacy-applied shared shape,
// optionally enriched with the local ledger's `id` + `date` (present when the
// viewer is looking at their own log), which enables moving entries between days.
export type DailyLogEntry = SharedDailyLogEntry & { id?: string; date?: string };
export type DailyLogDay = { date: string; total: number; entries: DailyLogEntry[] };

function isExcluded(entry: SharedDailyLogEntry) {
  return (
    entry.sourceType === "spend" ||
    entry.sourceType === "encouragement" ||
    entry.sourceType === "prediction"
  );
}

function sumDelta(entries: SharedDailyLogEntry[]) {
  return entries.reduce((total, entry) => total + entry.delta, 0);
}

type DayGold = {
  // Todos + agent/manual awards, shown with labels.
  tasks: DailyLogEntry[];
  habits: DailyLogEntry[];
  // Micro-actions (engagement rewards flushed by agents) — always rolled into a
  // single running-total row at the bottom of Tasks.
  micro: DailyLogEntry[];
  // Private items (any source) — rolled into a single labelless row under Tasks.
  privateEntries: DailyLogEntry[];
};

function buildDayGold(entries: DailyLogEntry[]): DayGold {
  const tasks = entries.filter((e) => (e.sourceType === "todo" || e.sourceType === "manual") && !e.private);
  const habits = entries.filter((e) => e.sourceType === "habit" && !e.private);
  const micro = entries.filter((e) => e.sourceType === "micro" && !e.private);
  const privateEntries = entries.filter((e) => e.private && !isExcluded(e));
  return { tasks, habits, micro, privateEntries };
}

// Collapse a single day's habit-ledger noise. Ticking a habit writes a +N row;
// un-ticking writes a −N row — so a fumbled tick → untick → tick leaves three
// rows (+N, −N, +N) even though the only thing that matters is the final state:
// was the habit done today or not. Group habit rows by name, sum their deltas,
// and keep one representative row per habit carrying the net gold. Names that net
// to zero or below (ticked then unticked — not actually done today) drop out
// entirely. Non-habit rows pass through untouched. Runs per day, before any
// cross-day aggregation, so range views still count each distinct day once.
function collapseDailyHabits(entries: DailyLogEntry[]): DailyLogEntry[] {
  const habits = new Map<string, { rep: DailyLogEntry; total: number }>();
  const others: DailyLogEntry[] = [];
  for (const entry of entries) {
    if (entry.sourceType !== "habit") {
      others.push(entry);
      continue;
    }
    const key = entry.label || "Habit";
    const group = habits.get(key);
    if (group) {
      group.total += entry.delta;
      // Prefer the latest positive row as the representative — its id/date back
      // the move-day picker, so the surviving row always points at a real award.
      if (entry.delta > 0) group.rep = entry;
    } else {
      habits.set(key, { rep: entry, total: entry.delta });
    }
  }
  const collapsed = Array.from(habits.values())
    .filter((g) => g.total > 0)
    .map((g) => ({ ...g.rep, delta: g.total }));
  return [...others, ...collapsed];
}

// Collapse entries sharing a label into one row (first-seen order kept).
function groupEntriesByLabel(entries: DailyLogEntry[], fallbackLabel: string) {
  const groups = new Map<string, { label: string; entries: DailyLogEntry[]; total: number }>();
  for (const entry of entries) {
    const label = entry.label || fallbackLabel;
    const group = groups.get(label) ?? { label, entries: [], total: 0 };
    group.entries.push(entry);
    group.total += entry.delta;
    groups.set(label, group);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

// Net gold from a resolved staked prediction (payout minus what was staked).
// Unstaked predictions net zero.
function predictionNet(p: Prediction) {
  if (p.stake == null || p.payout == null) return 0;
  return p.payout - p.stake;
}

function predictionResolvedKey(p: Prediction): string | null {
  if (p.outcome === "pending" || p.resolvedAt == null) return null;
  return localDayKey(new Date(p.resolvedAt));
}

// The day a prediction is grouped under in the log: an explicit logDate
// override wins; otherwise resolution day (resolved) or made day (pending).
function predictionLogKey(p: Prediction): string {
  return p.logDate ?? predictionResolvedKey(p) ?? localDayKey(new Date(p.createdAt));
}

function PredictionsSection({
  predictions,
  onMovePrediction,
}: {
  predictions: Prediction[];
  onMovePrediction?: (predictionId: string, date: string) => void;
}) {
  if (predictions.length === 0) return null;
  // Resolved first (by recency of resolution), then still-pending.
  const ordered = [...predictions].sort((a, b) => {
    const ap = a.outcome === "pending" ? 1 : 0;
    const bp = b.outcome === "pending" ? 1 : 0;
    return ap - bp;
  });
  const total = predictions.reduce((s, p) => s + predictionNet(p), 0);
  const staked = predictions.some((p) => p.stake != null && p.outcome !== "pending");
  return (
    <div className="achievement-category">
      <div className="achievement-category-header">
        <span className="achievement-category-icon">🎯</span>
        <span className="achievement-category-name">Predictions</span>
        <span className="achievement-category-count">{predictions.length}</span>
        {staked && (
          <span className={`achievement-category-total ${total < 0 ? "negative" : ""}`}>
            {total >= 0 ? "+" : ""}
            {total}
          </span>
        )}
      </div>
      <div className="achievement-items">
        {ordered.map((p) => {
          const pending = p.outcome === "pending";
          const hit = p.outcome === "hit";
          const net = predictionNet(p);
          const outcomeClass = pending ? "pending" : hit ? "hit" : "miss";
          const outcomeMark = pending ? "•" : hit ? "✓" : "✗";
          // Rows appear under their log day (logDate override, else resolution
          // day, else made day) — flag ones made on an earlier day so
          // carried-over predictions are distinguishable from same-day ones.
          const madeKey = localDayKey(new Date(p.createdAt));
          const appearKey = predictionLogKey(p);
          const madeLabel =
            madeKey === appearKey
              ? null
              : new Date(p.createdAt).toLocaleDateString(DATE_LOCALE, { month: "short", day: "numeric" });
          return (
            <div key={p.id} className="achievement-item prediction">
              <span className={`achievement-pred-outcome ${outcomeClass}`}>{outcomeMark}</span>
              <span className="achievement-item-label">
                {p.title}
                {madeLabel && <span className="achievement-pred-made">(Made {madeLabel})</span>}
              </span>
              {onMovePrediction && (
                <input
                  type="date"
                  className="achievement-item-date"
                  title="Move this prediction to the day it belongs in the log"
                  aria-label={`Change day for "${p.title}"`}
                  value={appearKey}
                  max={keyDaysAgo(0)}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next && next !== appearKey) onMovePrediction(p.id, next);
                  }}
                />
              )}
              {!pending && p.stake != null && (
                <span
                  className={`achievement-pred-earn ${net < 0 ? "negative" : ""}`}
                  title={`Staked ${p.stake}, paid out ${p.payout ?? 0} — net ${net >= 0 ? "+" : "−"}${Math.abs(net)} gold`}
                >
                  🪙{net >= 0 ? "+" : ""}
                  {net}
                </span>
              )}
              <span className="achievement-pred-confidence">{p.confidence}%</span>
              {pending && p.stake != null && (
                <span className="achievement-pred-pending">{p.stake} staked</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration chart — reliability curve from resolved predictions.
// ---------------------------------------------------------------------------

function CalibrationChart({ predictions }: { predictions: Prediction[] }) {
  const resolved = predictions.filter((p) => p.outcome !== "pending");
  if (resolved.length < 3) return null;

  const W = 240;
  const H = 200;
  const pad = 30;
  const sx = (v: number) => pad + (v / 100) * (W - 2 * pad);
  const sy = (v: number) => H - pad - (v / 100) * (H - 2 * pad);

  const buckets = new Map<number, { sum: number; hit: number; n: number }>();
  for (const p of resolved) {
    const b = Math.min(90, Math.floor(p.confidence / 10) * 10);
    const cur = buckets.get(b) ?? { sum: 0, hit: 0, n: 0 };
    cur.sum += p.confidence;
    cur.hit += p.outcome === "hit" ? 1 : 0;
    cur.n += 1;
    buckets.set(b, cur);
  }
  const points = [...buckets.values()].map((b) => ({
    x: b.sum / b.n,
    y: (b.hit / b.n) * 100,
    n: b.n,
  }));

  return (
    <div className="achievement-calibration">
      <p className="achievement-section-label">Calibration ({resolved.length} resolved)</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        preserveAspectRatio="xMidYMid meet"
        className="achievement-calibration-svg"
        role="img"
        aria-label="Calibration curve"
      >
        {/* frame */}
        <line x1={pad} y1={sy(0)} x2={W - pad} y2={sy(0)} className="cal-axis" />
        <line x1={pad} y1={sy(0)} x2={pad} y2={sy(100)} className="cal-axis" />
        {/* perfect-calibration diagonal */}
        <line x1={sx(0)} y1={sy(0)} x2={sx(100)} y2={sy(100)} className="cal-diagonal" />
        {/* points */}
        {points.map((pt, i) => (
          <circle key={i} cx={sx(pt.x)} cy={sy(pt.y)} r={3 + Math.min(4, pt.n)} className="cal-point" />
        ))}
        <text x={W - pad} y={sy(0) + 16} className="cal-label" textAnchor="end">
          confidence →
        </text>
        <text x={pad - 6} y={sy(100) - 2} className="cal-label" textAnchor="start">
          hit rate ↑
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category rendering (shared by day + week views)
// ---------------------------------------------------------------------------

function CategoryBlock({
  icon,
  label,
  count,
  total,
  showItems,
  children,
}: {
  icon: string;
  label: string;
  count: number;
  total: number;
  showItems: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="achievement-category">
      <div className="achievement-category-header">
        <span className="achievement-category-icon">{icon}</span>
        <span className="achievement-category-name">{label}</span>
        <span className="achievement-category-count">{count}</span>
        <span className="achievement-category-total">+{total}</span>
      </div>
      {showItems && <div className="achievement-items">{children}</div>}
    </div>
  );
}

// Hover-revealed date field on a log row — pick the day the thing was actually
// done and the entry moves there. Only rendered on your own log (entries carry
// the local ledger id) when an onMoveEntry handler is wired up.
function EntryDatePicker({
  entry,
  onMoveEntry,
}: {
  entry: DailyLogEntry;
  onMoveEntry?: (entryId: string, date: string) => void;
}) {
  if (!onMoveEntry || !entry.id || !entry.date) return null;
  const id = entry.id;
  return (
    <input
      type="date"
      className="achievement-item-date"
      title="Move this entry to the day you actually did it"
      aria-label={`Change date for "${entry.label || "entry"}"`}
      value={entry.date}
      max={keyDaysAgo(0)}
      onChange={(event) => {
        const next = event.target.value;
        if (next && next !== entry.date) onMoveEntry(id, next);
      }}
    />
  );
}

// Tasks folds in agent/manual awards and a single rolled-up "Private items" row.
// Habits is its own block. (Predictions render separately.)
function GoldCategories({
  gold,
  showItems,
  groupRepeats = false,
  onMoveEntry,
}: {
  gold: DayGold;
  showItems: boolean;
  // Multi-day ranges: collapse repeated habits into one "label ×n" row with the
  // summed gold. Grouped rows drop the per-entry date picker.
  groupRepeats?: boolean;
  onMoveEntry?: (entryId: string, date: string) => void;
}) {
  const privateTotal = sumDelta(gold.privateEntries);
  const microTotal = sumDelta(gold.micro);
  const taskTotal = sumDelta(gold.tasks) + microTotal + privateTotal;
  const showTasks = gold.tasks.length > 0 || gold.micro.length > 0 || gold.privateEntries.length > 0;
  return (
    <>
      {showTasks && (
        <CategoryBlock
          icon="✓"
          label="Tasks"
          count={gold.tasks.length + gold.micro.length + gold.privateEntries.length}
          total={taskTotal}
          showItems={showItems}
        >
          {gold.tasks.map((entry, index) => (
            <div key={`task:${index}`} className="achievement-item">
              <span className="achievement-item-label">{entry.label || "Task"}</span>
              <EntryDatePicker entry={entry} onMoveEntry={onMoveEntry} />
              <span className="achievement-item-delta">+{entry.delta}</span>
            </div>
          ))}
          {gold.micro.length > 0 && (
            <div className="achievement-item">
              <span className="achievement-item-label">
                ⚡ Micro actions
                <span className="achievement-item-mult"> ×{gold.micro.length}</span>
              </span>
              <span className="achievement-item-delta">+{microTotal}</span>
            </div>
          )}
          {gold.privateEntries.length > 0 && (
            <div className="achievement-item">
              <span className="achievement-item-label is-private">
                Private items{gold.privateEntries.length > 1 ? ` (${gold.privateEntries.length})` : ""}
              </span>
              <span className="achievement-item-delta">+{privateTotal}</span>
            </div>
          )}
        </CategoryBlock>
      )}
      {gold.habits.length > 0 && (
        <CategoryBlock
          icon="🔥"
          label="Habits"
          count={gold.habits.length}
          total={sumDelta(gold.habits)}
          showItems={showItems}
        >
          {(groupRepeats
            ? groupEntriesByLabel(gold.habits, "Habit")
            : gold.habits.map((entry) => ({ label: entry.label || "Habit", entries: [entry], total: entry.delta }))
          ).map((group, index) => (
            <div key={`habit:${index}`} className="achievement-item">
              <span className="achievement-item-label">
                {group.label}
                {group.entries.length > 1 && (
                  <span className="achievement-item-mult"> ×{group.entries.length}</span>
                )}
              </span>
              {group.entries.length === 1 && (
                <EntryDatePicker entry={group.entries[0]} onMoveEntry={onMoveEntry} />
              )}
              <span className="achievement-item-delta">+{group.total}</span>
            </div>
          ))}
        </CategoryBlock>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shareable achievement summary
// ---------------------------------------------------------------------------

const OLDER_DAY_COUNT = 12;

// Default period shown when a profile first opens (today).
export function defaultLogPeriod() {
  return keyDaysAgo(0);
}

// Copy the log card next to `button` to the clipboard as a PNG. The card is
// looked up through the shared .social-profile-content wrapper, so the button
// works wherever PeriodSelector renders (social modal, log preview).
async function copyLogPng(button: HTMLElement) {
  const card =
    button.closest(".social-profile-content")?.querySelector<HTMLElement>(".achievement-card") ??
    document.querySelector<HTMLElement>(".achievement-card");
  if (!card) return;
  // Fill the rounded-corner cutouts with the app's page color — transparent
  // corners read as white when pasted into light-background apps.
  const blob = await toBlob(card, { pixelRatio: 2, backgroundColor: "#0a101b" });
  if (!blob) throw new Error("PNG render failed");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

// Period selector — lives in the profile header, not the card. Today and
// Yesterday are single days; picking an older day summarizes the span from that
// day through today.
export function PeriodSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  const todayKey = keyDaysAgo(0);
  const yesterdayKey = keyDaysAgo(1);
  const isRange = selected.startsWith("range:");
  const rangeN = isRange ? Math.max(1, parseInt(selected.slice(6), 10) || 7) : 0;
  const [copyState, setCopyState] = useState<"idle" | "busy" | "copied">("idle");
  return (
    <div className="achievement-selector">
      <button
        type="button"
        className="achievement-png-btn"
        title="Copy this log to the clipboard as an image"
        aria-label="Copy this log to the clipboard as an image"
        disabled={copyState === "busy"}
        onClick={(event) => {
          const el = event.currentTarget;
          setCopyState("busy");
          void copyLogPng(el)
            .then(() => {
              setCopyState("copied");
              setTimeout(() => setCopyState("idle"), 1500);
            })
            .catch(() => setCopyState("idle"));
        }}
      >
        {copyState === "busy" ? (
          "…"
        ) : copyState === "copied" ? (
          "✓"
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`achievement-period-pill ${selected === todayKey ? "active" : ""}`}
        onClick={() => onSelect(todayKey)}
      >
        Today
      </button>
      <button
        type="button"
        className={`achievement-period-pill ${selected === yesterdayKey ? "active" : ""}`}
        onClick={() => onSelect(yesterdayKey)}
      >
        Yesterday
      </button>
      <select
        className={`achievement-day-dropdown ${isRange ? "active" : ""}`}
        value={isRange ? String(rangeN) : ""}
        title="Summarize from an older day through today"
        onChange={(e) => {
          if (e.target.value) onSelect(`range:${e.target.value}`);
        }}
      >
        {/* Hidden placeholder: the closed control shows just ▾ until a range is picked */}
        <option value="" hidden>
          ▾
        </option>
        {Array.from({ length: OLDER_DAY_COUNT }, (_, i) => i + 2).map((offset) => {
          const date = new Date(`${keyDaysAgo(offset)}T00:00:00`);
          // Span from that day through today = offset + 1 days. Label it as the
          // range "Today – <start day>" so it's clear it summarizes up to today.
          return (
            <option key={offset} value={offset + 1}>
              Today – {date.toLocaleDateString(DATE_LOCALE, { month: "short", day: "numeric" })}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function AchievementSummary({
  days,
  habits,
  predictions = [],
  selected,
  username,
  showHabits = true,
  compact = false,
  onMoveEntry,
  onMovePrediction,
}: {
  days: DailyLogDay[];
  habits: Habit[];
  predictions?: Prediction[];
  // Controlled period: a YYYY-MM-DD key (single day) or "range:N" (last N days).
  selected: string;
  username?: string;
  showHabits?: boolean;
  // Tighter type/spacing for the in-modal social tab (all features kept).
  compact?: boolean;
  // Own-log only: move a ledger entry to a different day (hover date picker).
  onMoveEntry?: (entryId: string, date: string) => void;
  // Own-log only: move a prediction to a different day (resolution day for
  // resolved ones, made day for pending ones).
  onMovePrediction?: (predictionId: string, date: string) => void;
}) {
  const goldByKey = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const resolvedPreds = useMemo(
    () => predictions.filter((p) => p.outcome !== "pending" && p.resolvedAt != null),
    [predictions],
  );
  // Resolved predictions key off their resolution day; pending ones off the day
  // they were made — so a bet shows up the day you place it, then again resolved.
  // An explicit logDate override (own-log date picker) beats both.
  const predsByKey = useMemo(() => {
    const map = new Map<string, Prediction[]>();
    const add = (key: string | null, p: Prediction) => {
      if (!key) return;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    };
    for (const p of resolvedPreds) add(predictionLogKey(p), p);
    for (const p of predictions) {
      if (p.outcome === "pending") add(predictionLogKey(p), p);
    }
    return map;
  }, [predictions, resolvedPreds]);

  const isRange = selected.startsWith("range:");
  const rangeN = isRange ? Math.max(1, parseInt(selected.slice(6), 10) || 7) : 0;
  const scopeKeys = isRange ? Array.from({ length: rangeN }, (_, i) => keyDaysAgo(i)) : [selected];

  // Aggregate gold + predictions over the scope. Habit tick/untick noise is
  // collapsed per day (see collapseDailyHabits) before flattening, so each day
  // contributes one net row per habit — never a run of +N/−N movements.
  const scopeEntries = scopeKeys.flatMap((k) => collapseDailyHabits(goldByKey.get(k)?.entries ?? []));
  const gold = buildDayGold(scopeEntries);
  const scopePreds = scopeKeys.flatMap((k) => predsByKey.get(k) ?? []);

  const goldTotal =
    sumDelta(gold.tasks) + sumDelta(gold.habits) + sumDelta(gold.micro) + sumDelta(gold.privateEntries);
  const predTotal = scopePreds.reduce((s, p) => s + predictionNet(p), 0);
  const total = goldTotal + predTotal;

  const showPredictions = scopePreds.length > 0;
  const nothing =
    gold.tasks.length === 0 &&
    gold.habits.length === 0 &&
    gold.micro.length === 0 &&
    gold.privateEntries.length === 0 &&
    scopePreds.length === 0;
  // Single-day heading shows the actual date (weekday + day + month, no year)
  // rather than "Today"/"Yesterday".
  const heading = isRange
    ? `Last ${rangeN} days`
    : new Date(`${selected}T00:00:00`).toLocaleDateString(DATE_LOCALE, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });

  return (
    <div className={`achievement-card ${compact ? "compact" : ""}`}>
      {/* Header */}
      <div className="achievement-header">
        <div className="achievement-header-text">
          {username && <span className="achievement-user">@{username}</span>}
          <span className="achievement-range-label">{heading}</span>
        </div>
        <div className="achievement-total">
          <span className="achievement-total-value">{total}</span>
          <span className="achievement-total-unit">gold earned</span>
        </div>
      </div>

      {/* Body */}
      {nothing ? (
        <p className="achievement-empty">Nothing logged {isRange ? "in this range" : "on this day"}.</p>
      ) : (
        <div className="achievement-categories">
          <GoldCategories gold={gold} showItems groupRepeats={isRange} onMoveEntry={onMoveEntry} />
          {showPredictions && <PredictionsSection predictions={scopePreds} onMovePrediction={onMovePrediction} />}
        </div>
      )}

      {/* Calibration chart intentionally hidden for now — may return, likely at
          the end of the card once the styling fits. (CalibrationChart kept.) */}

      {/* Habits — capped at 7 columns so it never grows large */}
      {showHabits && habits.length > 0 && (
        <div className="achievement-habits">
          <p className="achievement-section-label">Habits</p>
          <HabitCheckGrid
            habits={habits}
            endKey={isRange ? undefined : selected}
            columns={isRange ? Math.min(rangeN, 7) : 7}
          />
        </div>
      )}
    </div>
  );
}
