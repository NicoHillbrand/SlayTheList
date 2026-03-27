import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { habitSchema, predictionSchema, reflectionEntrySchema } from "@slaythelist/contracts";
import {
  listTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getAccountabilityState,
  saveAccountabilityState,
} from "./store.js";

const server = new McpServer({ name: "slaythelist", version: "0.1.0" });

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
  "Replace the full habits array. Read the current state with list_habits first, modify the array, then call this to save.",
  {
    habits: z.array(habitSchema).describe("The complete replacement habits array."),
  },
  async ({ habits }) => {
    const state = getAccountabilityState();
    saveAccountabilityState({ ...state, habits });
    return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, count: habits.length }) }] };
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
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
