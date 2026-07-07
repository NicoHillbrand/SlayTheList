import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { habitSchema, predictionSchema, reflectionEntrySchema, walkthroughSchema } from "@slaythelist/contracts";
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

function mcpCategoryToSourceType(category?: string): "todo" | "habit" | "encouragement" | "prediction" | "manual" {
  const c = (category ?? "").trim().toLowerCase();
  if (c === "tasks" || c === "task" || c === "todo" || c === "todos") return "todo";
  if (c === "habits" || c === "habit") return "habit";
  if (c === "encouragements" || c === "encouragement" || c === "encourage") return "encouragement";
  if (c === "predictions" || c === "prediction") return "prediction";
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
      .describe('Which category the entry belongs to: "Tasks", "Habits", "Encouragements", or "Predictions". Unknown/missing falls back to "Other".'),
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
    const activity = title && title.trim()
      ? {
          sourceType: mcpCategoryToSourceType(category),
          label: title.trim().slice(0, 500),
          source: source ?? null,
          at: timestamp ?? null,
        }
      : undefined;
    const state = awardGold(amount, undefined, activity);
    if (with_sound) await fireSoundEvent("gold");
    return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
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
  "Replace the full predictions array. Read the current state with list_predictions first, modify the array, then call this to save.",
  {
    predictions: z.array(predictionSchema).describe("The complete replacement predictions array."),
  },
  async ({ predictions }) => {
    const state = getAccountabilityState();
    saveAccountabilityState({ ...state, predictions });
    return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, count: predictions.length }) }] };
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
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
