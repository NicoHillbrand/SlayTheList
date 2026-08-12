import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  habitSchema,
  predictionSchema,
  predictionStakePayout,
  reflectionEntrySchema,
  walkthroughSchema,
} from "@slaythelist/contracts";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getAccountabilityState,
  saveAccountabilityState,
  getGoldState,
  awardGold,
  deductGold,
  listGoldActivityDays,
  getGoldEarnedToday,
  awardMicroTenths,
  getCrawlSnapshot,
  setCrawlLockAction,
} from "./store.js";

const server = new McpServer({ name: "slaythelist", version: "0.1.0" });

const apiPort = Number(process.env.PORT ?? 8788);
const apiBaseUrl = `http://localhost:${apiPort}`;

async function fireSoundEvent(sound: string = "gold"): Promise<void> {
  try {
    await fetch(`${apiBaseUrl}/api/sound/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sound }),
    });
  } catch {
    // Sound is best-effort; the API server may not be running.
  }
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

server.tool(
  "list_todos",
  "List todos. Defaults to active (non-done, non-archived) todos only.",
  {
    status: z
      .enum(["active", "done", "all"])
      .optional()
      .describe("Filter by status. Defaults to 'active'."),
    include_archived: z
      .boolean()
      .optional()
      .describe("Include archived todos. Default false."),
  },
  async ({ status = "active", include_archived = false }) => {
    let todos = listTodos();
    if (!include_archived) {
      todos = todos.filter((t) => t.archivedAt == null);
    }
    if (status !== "all") {
      todos = todos.filter((t) => t.status === status);
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(todos, null, 2) }] };
  },
);

server.tool(
  "create_todo",
  "Create a new todo item.",
  {
    title: z.string().min(1).describe("Title of the todo."),
    context: z.string().optional().describe("Optional additional context or notes for the todo."),
    deadline_at: z
      .string()
      .optional()
      .describe("Optional deadline as an ISO 8601 datetime string, e.g. '2026-04-01T00:00:00.000Z'."),
  },
  async ({ title, context, deadline_at }) => {
    const todo = createTodo(title, { deadlineAt: deadline_at ?? null });
    const final = context != null ? (updateTodo(todo.id, { context }) ?? todo) : todo;
    return { content: [{ type: "text" as const, text: JSON.stringify(final, null, 2) }] };
  },
);

server.tool(
  "update_todo",
  "Update a todo item's fields. Only provided fields are changed.",
  {
    id: z.string().describe("ID of the todo to update."),
    title: z.string().min(1).optional().describe("New title."),
    context: z.string().optional().describe("New context/notes. Pass empty string to clear."),
    status: z.enum(["active", "done"]).optional().describe("New status."),
    deadline_at: z
      .string()
      .nullable()
      .optional()
      .describe("New deadline as ISO 8601 string, or null to clear."),
  },
  async ({ id, title, context, status, deadline_at }) => {
    const patch: Parameters<typeof updateTodo>[1] = {};
    if (title !== undefined) patch.title = title;
    if (context !== undefined) patch.context = context;
    if (status !== undefined) patch.status = status;
    if (deadline_at !== undefined) patch.deadlineAt = deadline_at;
    const updated = updateTodo(id, patch);
    if (!updated) {
      return { isError: true, content: [{ type: "text" as const, text: `Todo not found: ${id}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
  },
);

server.tool(
  "delete_todo",
  "Permanently delete a todo by ID.",
  {
    id: z.string().describe("ID of the todo to delete."),
  },
  async ({ id }) => {
    const deleted = deleteTodo(id);
    if (!deleted) {
      return { isError: true, content: [{ type: "text" as const, text: `Todo not found: ${id}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, id }) }] };
  },
);

// ---------------------------------------------------------------------------
// Gold
// ---------------------------------------------------------------------------

server.tool(
  "get_gold",
  "Get the current gold balance and the list of todo IDs that have already been rewarded.",
  {},
  async () => {
    const state = getGoldState();
    return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
  },
);

server.tool(
  "list_gold_activity",
  "Read the gold-activity ledger: what actually earned or spent gold, with per-entry amounts, timestamps, and source. Unlike get_gold (balance only), this lets you see what moved the balance — e.g. reconcile todos the user checked off in the UI this session into the session footer. Entries are grouped by local day, newest first. Pass `since` (ISO timestamp) to also get a flat list of entries recorded at or after that moment (i.e. \"while I've been active\").",
  {
    days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("How many recent days of ledger to return, newest first. Default 7, max 365."),
    since: z
      .string()
      .optional()
      .describe("ISO 8601 timestamp. When provided, also returns `sinceEntries` (flat, all entries with createdAt >= since) and `earnedSince` (sum of their positive deltas) — use for session reconciliation."),
  },
  async ({ days = 7, since }) => {
    const clampedDays = Math.min(Math.max(1, Math.trunc(days)), 365);
    const activityDays = listGoldActivityDays(clampedDays);
    const result: Record<string, unknown> = {
      earnedToday: getGoldEarnedToday(),
      balance: getGoldState().gold,
      days: activityDays,
    };
    const sinceMs = since ? Date.parse(since) : NaN;
    if (since && !Number.isNaN(sinceMs)) {
      const sinceEntries = activityDays
        .flatMap((d) => d.entries)
        .filter((e) => Date.parse(e.createdAt) >= sinceMs)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      result.since = new Date(sinceMs).toISOString();
      result.sinceEntries = sinceEntries;
      result.earnedSince = sinceEntries.reduce((sum, e) => (e.delta > 0 ? sum + e.delta : sum), 0);
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

function mcpCategoryToSourceType(
  category?: string,
): "todo" | "habit" | "encouragement" | "prediction" | "micro" | "manual" {
  const c = (category ?? "").trim().toLowerCase();
  if (c === "tasks" || c === "task" || c === "todo" || c === "todos") return "todo";
  if (c === "habits" || c === "habit") return "habit";
  if (c === "encouragements" || c === "encouragement" || c === "encourage") return "encouragement";
  if (c === "predictions" || c === "prediction") return "prediction";
  if (c.startsWith("micro")) return "micro";
  return "manual";
}

server.tool(
  "award_gold",
  "Add gold to the user's balance. Pass `title` to record a named achievement in the daily/shareable log (e.g. a subtask you completed); without a title only the balance changes. Set with_sound: true to play the gold coin sound in the overlay.",
  {
    amount: z
      .number()
      .int()
      .nonnegative()
      .describe("Amount of gold to award. Must be a non-negative integer."),
    title: z
      .string()
      .optional()
      .describe("What was accomplished. When provided, this shows up as a log entry in the achievement view. Omit for a silent balance-only bump."),
    category: z
      .string()
      .optional()
      .describe('Which category the entry belongs to: "Tasks", "Habits", "Encouragements", "Predictions", or "Micro" (small engagement/micro-action rewards, shown as one running total in the log). Unknown/missing falls back to "Other".'),
    source: z
      .string()
      .optional()
      .describe('Which agent submitted this (e.g. "claude-code"). Optional.'),
    timestamp: z
      .string()
      .optional()
      .describe("ISO 8601 timestamp to backdate the entry. Defaults to now."),
    with_sound: z
      .boolean()
      .optional()
      .describe("If true, play the gold coin sound in the overlay UI. Defaults to false."),
  },
  async ({ amount, title, category, source, timestamp, with_sound = false }) => {
    // Claude's awards always attach a log item. With a title it's shown; without
    // one it's recorded privately (rolls into "Private items" in shared views).
    const hasTitle = !!(title && title.trim());
    const activity = {
      sourceType: hasTitle ? mcpCategoryToSourceType(category) : ("manual" as const),
      label: hasTitle ? title!.trim().slice(0, 500) : "",
      source: source ?? null,
      at: timestamp ?? null,
      private: !hasTitle,
    };
    const state = awardGold(amount, undefined, activity);
    if (with_sound) await fireSoundEvent("gold");
    return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
  },
);

server.tool(
  "award_micro",
  "Record micro-actions in tenths of a gold — the fast sub-tick between finished todos. Use it for the small stuff a session generates (a decision made, a message sent, a file read) instead of tracking 0.1 increments yourself: the count lives on the server, so it survives the session and is exact. Every 3 tenths buys one extra card draw in The Crawl (micro buys OPTIONS), and every 10 tenths roll over into 1 real gold automatically (do not call award_gold for the rollover). Unspent tenths expire at midnight.",
  {
    tenths: z
      .number()
      .int()
      .positive()
      .describe("How many tenths of a gold to record. 1 tenth = one micro-action = 0.1 gold."),
    label: z
      .string()
      .optional()
      .describe('What the micro-actions were, for the ledger entry written when they roll over into whole gold. Defaults to "Micro actions".'),
    source: z
      .string()
      .optional()
      .describe('Which agent submitted this (e.g. "claude-code"). Optional.'),
    with_sound: z
      .boolean()
      .optional()
      .describe("If true, play the gold coin sound in the overlay UI. Defaults to false."),
  },
  async ({ tenths, label, source, with_sound = false }) => {
    const result = awardMicroTenths(tenths, { label: label ?? null, source: source ?? null });
    if (with_sound) await fireSoundEvent("gold");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "spend_gold",
  "Deduct gold from the user's balance (clamps at zero, never negative). Set with_sound: true to play the gold coin sound in the overlay; leave it false (or omit it) to update silently.",
  {
    amount: z
      .number()
      .int()
      .nonnegative()
      .describe("Amount of gold to deduct. Must be a non-negative integer."),
    with_sound: z
      .boolean()
      .optional()
      .describe("If true, play the gold coin sound in the overlay UI. Defaults to false."),
  },
  async ({ amount, with_sound = false }) => {
    const state = deductGold(amount, undefined, { sourceType: "spend", label: "Spent via Claude" });
    if (with_sound) await fireSoundEvent("gold");
    return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

server.tool(
  "list_habits",
  "List all habits and their check history.",
  {},
  async () => {
    const { habits } = getAccountabilityState();
    return { content: [{ type: "text" as const, text: JSON.stringify(habits, null, 2) }] };
  },
);

server.tool(
  "set_habits",
  "Replace the full habits array. Read the current state with list_habits first, modify the array, then call this to save. When a new completed check is added (a {date, done: true} entry that wasn't there before), the gold coin sound fires in the overlay UI so the user gets feedback, matching what clicking the habit in the app does.",
  {
    habits: z.array(habitSchema).describe("The complete replacement habits array."),
  },
  async ({ habits }) => {
    const state = getAccountabilityState();
    const prevDoneDates = new Map<string, Set<string>>();
    for (const h of state.habits) {
      prevDoneDates.set(h.id, new Set(h.checks.filter((c) => c.done).map((c) => c.date)));
    }
    let newlyCompleted = 0;
    for (const h of habits) {
      const prior = prevDoneDates.get(h.id) ?? new Set<string>();
      for (const c of h.checks) {
        if (c.done && !prior.has(c.date)) newlyCompleted += 1;
      }
    }
    saveAccountabilityState({ ...state, habits });
    if (newlyCompleted > 0) await fireSoundEvent("gold");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ saved: true, count: habits.length, newlyCompleted }),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

server.tool(
  "list_predictions",
  "List all predictions and their outcomes.",
  {},
  async () => {
    const { predictions } = getAccountabilityState();
    return { content: [{ type: "text" as const, text: JSON.stringify(predictions, null, 2) }] };
  },
);

server.tool(
  "set_predictions",
  "Replace the full predictions array. Read the current state with list_predictions first, modify the array, then call this to save. " +
    "Stakes are handled like the app UI: adding `stake` to a new/pending prediction escrows that much gold from the balance (clamped to what's available, with a ledger entry); " +
    "resolving a staked prediction to hit/miss computes the payout server-side (quadratic scoring, break-even at 50% confidence, up to 2× back) and awards it; " +
    "removing a pending staked prediction refunds the stake silently. While a stake is pending, confidence and stake are locked; a resolved staked prediction's outcome/payout are frozen. " +
    "Predictions written already-resolved with stake+payout are stored as-is with no gold movement (history backfill).",
  {
    predictions: z.array(predictionSchema).describe("The complete replacement predictions array."),
  },
  async ({ predictions }) => {
    const state = getAccountabilityState();
    const prevById = new Map(state.predictions.map((p) => [p.id, p]));

    let staked = 0;
    let paidOut = 0;
    let refunded = 0;

    const next = predictions.map((incoming) => {
      const before = prevById.get(incoming.id);
      const p = { ...incoming };

      // Resolved staked predictions are settled — outcome, payout, stake, and
      // confidence are frozen so a re-resolve can't pay out twice.
      if (before?.stake && before.outcome !== "pending") {
        p.outcome = before.outcome;
        p.stake = before.stake;
        p.payout = before.payout;
        p.confidence = before.confidence;
        p.resolvedAt = before.resolvedAt;
        return p;
      }

      // While a stake is pending, confidence is locked (it sets the payout)
      // and the escrowed amount can't be edited.
      if (before?.stake && before.outcome === "pending") {
        p.confidence = before.confidence;
        p.stake = before.stake;
        if (p.outcome === "pending") {
          delete p.payout;
          return p;
        }
        // Pending → resolved: settle the stake.
        const payout = predictionStakePayout(before.stake, before.confidence, p.outcome);
        p.payout = payout;
        if (p.resolvedAt == null) p.resolvedAt = Date.now();
        if (payout > 0) {
          const net = payout - before.stake;
          const netLabel = `net ${net >= 0 ? "+" : "−"}${Math.abs(net)}`;
          const label =
            p.outcome === "hit"
              ? `Called it: "${before.title}" (${before.confidence}%) — staked ${before.stake}, won ${payout} (${netLabel})`
              : `Missed: "${before.title}" (${before.confidence}%) — staked ${before.stake}, got back ${payout} (${netLabel})`;
          awardGold(payout, undefined, { sourceType: "prediction", sourceId: p.id, label });
          paidOut += payout;
        }
        return p;
      }

      // New (or newly staked) pending prediction: escrow the stake now. Clamp
      // to the balance so the record never claims more escrow than happened.
      if (p.outcome === "pending" && (p.stake ?? 0) > 0) {
        const stake = Math.min(Math.floor(p.stake!), getGoldState().gold);
        if (stake <= 0) {
          delete p.stake;
        } else {
          p.stake = stake;
          deductGold(stake, undefined, {
            sourceType: "prediction",
            sourceId: p.id,
            label: `Staked ${stake} on "${p.title}" (${p.confidence}%)`,
          });
          staked += stake;
        }
        delete p.payout;
      }
      return p;
    });

    // Pending staked predictions dropped from the array: refund balance-only
    // (no ledger entry — a "+N refund" line would read as a gain for net-zero).
    const nextIds = new Set(next.map((p) => p.id));
    for (const before of state.predictions) {
      if (!nextIds.has(before.id) && before.outcome === "pending" && (before.stake ?? 0) > 0) {
        awardGold(before.stake!);
        refunded += before.stake!;
      }
    }

    saveAccountabilityState({ ...state, predictions: next });
    const gold = getGoldState().gold;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ saved: true, count: next.length, staked, paidOut, refunded, gold }),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Reflections
// ---------------------------------------------------------------------------

server.tool(
  "list_reflections",
  "List reflection journal entries, most recent first.",
  {
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of entries to return. Defaults to 30."),
  },
  async ({ limit = 30 }) => {
    const { reflections } = getAccountabilityState();
    const sorted = [...reflections].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(sorted, null, 2) }] };
  },
);

server.tool(
  "set_reflections",
  "Replace the full reflections array. Read the current state with list_reflections first, modify the array, then call this to save.",
  {
    reflections: z.array(reflectionEntrySchema).describe("The complete replacement reflections array."),
  },
  async ({ reflections }) => {
    const state = getAccountabilityState();
    saveAccountabilityState({ ...state, reflections });
    return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, count: reflections.length }) }] };
  },
);

// ---------------------------------------------------------------------------
// Walkthroughs
// ---------------------------------------------------------------------------

server.tool(
  "list_walkthroughs",
  "List day walkthrough entries, most recent first.",
  {
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of entries to return. Defaults to 30."),
  },
  async ({ limit = 30 }) => {
    const { walkthroughs } = getAccountabilityState();
    const sorted = [...(walkthroughs ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(sorted, null, 2) }] };
  },
);

server.tool(
  "set_walkthroughs",
  "Replace the full walkthroughs array. Read the current state with list_walkthroughs first, modify the array, then call this to save.",
  {
    walkthroughs: z.array(walkthroughSchema).describe("The complete replacement walkthroughs array."),
  },
  async ({ walkthroughs }) => {
    const state = getAccountabilityState();
    saveAccountabilityState({ ...state, walkthroughs });
    return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, count: walkthroughs.length }) }] };
  },
);

// ---------------------------------------------------------------------------
// The Crawl — the overlay dungeon run
// ---------------------------------------------------------------------------

server.tool(
  "get_crawl",
  "Read the state of The Crawl, the overlay dungeon run: floor and room, HP, the current enemy, the hand and deck, how much energy is left today (energy = gold earned today, it expires at midnight), how many extra card draws today's micro-actions have bought (drawCredits, from award_micro), and whether a todo is currently pinned as a lock. Use it to see how the run is doing before suggesting what to pin next.",
  {},
  async () => {
    const snapshot = getCrawlSnapshot();
    return { content: [{ type: "text" as const, text: JSON.stringify(snapshot, null, 2) }] };
  },
);

server.tool(
  "lock_crawl_on_todo",
  "Pin a todo to The Crawl. While the pinned todo is not done, the run is FROZEN — no card can be played and no room can be entered, regardless of energy. This is the hard gate for turning a sub-task you just suggested into the thing that unlocks the next turn. Create the todo with create_todo first, then pass its id here. Pass todo_id: null to clear the lock. Use it deliberately: a lock the user cannot finish today stalls their run.",
  {
    todo_id: z
      .string()
      .nullable()
      .describe("Id of the todo that must be completed before the run resumes. Null clears the lock."),
  },
  async ({ todo_id }) => {
    try {
      const snapshot = setCrawlLockAction(todo_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { locked: snapshot.lock, blocked: snapshot.blocked, energy: snapshot.energy },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: err instanceof Error ? err.message : "lock failed" },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
