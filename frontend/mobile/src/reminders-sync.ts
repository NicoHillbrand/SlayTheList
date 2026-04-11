import { Preferences } from "@capacitor/preferences";
import AppleReminders, {
  isAppleRemindersAvailable,
  type Reminder,
} from "./apple-reminders";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Todo {
  id: string;
  title: string;
  status: "active" | "done";
  context?: string;
  deadlineAt: string | null;
  completedAt: string | null;
}

/** Persistent mapping between a SlayTheList todo and an Apple Reminder */
interface IdMapping {
  todoId: string;
  reminderId: string;
}

export interface RemindersSyncSettings {
  enabled: boolean;
  listId: string | null;
  listName: string | null;
  direction: "bidirectional" | "import" | "export";
}

export interface SyncResult {
  imported: number;
  exported: number;
  updated: number;
  deleted: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "reminders_settings";
const MAPPING_KEY = "reminders_id_map";
const LAST_SYNC_KEY = "reminders_last_sync";

export async function loadRemindersSettings(): Promise<RemindersSyncSettings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  if (value) {
    try {
      return JSON.parse(value) as RemindersSyncSettings;
    } catch {
      /* corrupted — return defaults */
    }
  }
  return { enabled: false, listId: null, listName: null, direction: "bidirectional" };
}

export async function saveRemindersSettings(
  settings: RemindersSyncSettings,
): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
}

async function loadIdMap(): Promise<IdMapping[]> {
  const { value } = await Preferences.get({ key: MAPPING_KEY });
  if (value) {
    try {
      return JSON.parse(value) as IdMapping[];
    } catch {
      /* corrupted */
    }
  }
  return [];
}

async function saveIdMap(map: IdMapping[]): Promise<void> {
  await Preferences.set({ key: MAPPING_KEY, value: JSON.stringify(map) });
}

export async function loadLastSyncTime(): Promise<string | null> {
  const { value } = await Preferences.get({ key: LAST_SYNC_KEY });
  return value;
}

async function saveLastSyncTime(): Promise<void> {
  await Preferences.set({
    key: LAST_SYNC_KEY,
    value: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

function reminderToTodo(r: Reminder): Todo {
  return {
    id: generateId(),
    title: r.title,
    status: r.isCompleted ? "done" : "active",
    context: r.notes ?? undefined,
    deadlineAt: r.dueDate ?? null,
    completedAt: r.completionDate ?? null,
  };
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------

/**
 * Run a bidirectional (or one-way) sync between Apple Reminders and
 * SlayTheList todos. Returns updated todos array plus a summary.
 *
 * The caller is responsible for writing the updated todos back into the
 * vault/state.
 */
export async function syncReminders(
  currentTodos: Todo[],
  settings: RemindersSyncSettings,
): Promise<{ todos: Todo[]; result: SyncResult }> {
  const result: SyncResult = {
    imported: 0,
    exported: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };

  if (!settings.enabled || !settings.listId) {
    return { todos: currentTodos, result };
  }

  if (!isAppleRemindersAvailable()) {
    result.errors.push("Apple Reminders is not available on this platform");
    return { todos: currentTodos, result };
  }

  // 1. Load persisted ID mapping
  let idMap = await loadIdMap();

  // 2. Fetch reminders from Apple
  let reminders: Reminder[];
  try {
    const res = await AppleReminders.getReminders({
      listId: settings.listId,
    });
    reminders = res.reminders;
  } catch (err) {
    result.errors.push(
      `Failed to fetch reminders: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { todos: currentTodos, result };
  }

  const todos = [...currentTodos];
  const reminderById = new Map(reminders.map((r) => [r.id, r]));


  // 3. Process existing mappings — sync changes in both directions
  const survivingMappings: IdMapping[] = [];

  for (const mapping of idMap) {
    const reminder = reminderById.get(mapping.reminderId);
    const todoIdx = todos.findIndex((t) => t.id === mapping.todoId);
    const todo = todoIdx >= 0 ? todos[todoIdx] : null;

    if (!reminder && !todo) {
      // Both gone — drop mapping
      continue;
    }

    if (!reminder && todo) {
      // Reminder was deleted in Apple Reminders
      if (settings.direction !== "export") {
        // Mirror the deletion into SlayTheList
        todos.splice(todoIdx, 1);
        result.deleted++;
      } else {
        // Export-only: re-create the reminder
        try {
          const { id } = await AppleReminders.createReminder({
            listId: settings.listId,
            title: todo.title,
            notes: todo.context,
            dueDate: todo.deadlineAt ?? undefined,
          });
          if (todo.status === "done") {
            await AppleReminders.updateReminder({ id, isCompleted: true });
          }
          survivingMappings.push({ todoId: todo.id, reminderId: id });
          result.exported++;
        } catch (err) {
          result.errors.push(`Re-export failed for "${todo.title}": ${err instanceof Error ? err.message : String(err)}`);
          survivingMappings.push(mapping); // keep mapping for retry
        }
        continue;
      }
      continue;
    }

    if (reminder && !todo) {
      // Todo was deleted in SlayTheList
      if (settings.direction !== "import") {
        // Mirror the deletion into Apple Reminders
        try {
          await AppleReminders.deleteReminder({ id: reminder.id });
          result.deleted++;
        } catch (err) {
          result.errors.push(`Delete failed for "${reminder.title}": ${err instanceof Error ? err.message : String(err)}`);
          survivingMappings.push(mapping);
        }
      } else {
        // Import-only: re-create the todo
        const newTodo = reminderToTodo(reminder);
        todos.push(newTodo);
        survivingMappings.push({ todoId: newTodo.id, reminderId: reminder.id });
        result.imported++;
      }
      continue;
    }

    // Both exist — sync fields
    if (reminder && todo && todoIdx >= 0) {
      survivingMappings.push(mapping);

      const todoIsDone = todo.status === "done";
      const reminderIsDone = reminder.isCompleted;

      // Import direction: Apple → SlayTheList
      if (settings.direction !== "export") {
        let changed = false;
        if (reminder.title !== todo.title) {
          todos[todoIdx] = { ...todos[todoIdx], title: reminder.title };
          changed = true;
        }
        if (reminderIsDone !== todoIsDone) {
          todos[todoIdx] = {
            ...todos[todoIdx],
            status: reminderIsDone ? "done" : "active",
            completedAt: reminderIsDone
              ? reminder.completionDate ?? new Date().toISOString()
              : null,
          };
          changed = true;
        }
        if ((reminder.dueDate ?? null) !== todo.deadlineAt) {
          todos[todoIdx] = { ...todos[todoIdx], deadlineAt: reminder.dueDate ?? null };
          changed = true;
        }
        if (changed) result.updated++;
      }

      // Export direction: SlayTheList → Apple
      if (settings.direction !== "import") {
        try {
          const updates: Record<string, unknown> = { id: reminder.id };
          let needsUpdate = false;

          if (todo.title !== reminder.title) {
            updates.title = todo.title;
            needsUpdate = true;
          }
          if (todoIsDone !== reminderIsDone) {
            updates.isCompleted = todoIsDone;
            needsUpdate = true;
          }
          if ((todo.deadlineAt ?? null) !== (reminder.dueDate ?? null)) {
            updates.dueDate = todo.deadlineAt;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await AppleReminders.updateReminder(updates as any);
            result.updated++;
          }
        } catch (err) {
          result.errors.push(`Update failed for "${todo.title}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // 4. New reminders not yet mapped → import into SlayTheList
  if (settings.direction !== "export") {
    const mappedReminderIds = new Set(survivingMappings.map((m) => m.reminderId));
    for (const reminder of reminders) {
      if (mappedReminderIds.has(reminder.id)) continue;
      const newTodo = reminderToTodo(reminder);
      todos.push(newTodo);
      survivingMappings.push({ todoId: newTodo.id, reminderId: reminder.id });
      result.imported++;
    }
  }

  // 5. New todos not yet mapped → export to Apple Reminders
  if (settings.direction !== "import") {
    const mappedTodoIds = new Set(survivingMappings.map((m) => m.todoId));
    for (const todo of todos) {
      if (mappedTodoIds.has(todo.id)) continue;
      try {
        const { id } = await AppleReminders.createReminder({
          listId: settings.listId,
          title: todo.title,
          notes: todo.context,
          dueDate: todo.deadlineAt ?? undefined,
        });
        if (todo.status === "done") {
          await AppleReminders.updateReminder({ id, isCompleted: true });
        }
        survivingMappings.push({ todoId: todo.id, reminderId: id });
        result.exported++;
      } catch (err) {
        result.errors.push(`Export failed for "${todo.title}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 6. Persist updated mapping & timestamp
  await saveIdMap(survivingMappings);
  await saveLastSyncTime();

  return { todos, result };
}

/**
 * One-shot import: pulls all reminders from the selected list and returns
 * them as new todos. Does not create any mappings (for initial bulk import).
 */
export async function importRemindersOnce(
  listId: string,
): Promise<{ todos: Todo[]; count: number; error?: string }> {
  if (!isAppleRemindersAvailable()) {
    return { todos: [], count: 0, error: "Apple Reminders is not available" };
  }
  try {
    const { reminders } = await AppleReminders.getReminders({ listId });
    const todos = reminders
      .filter((r) => !r.isCompleted) // only import active reminders
      .map(reminderToTodo);
    return { todos, count: todos.length };
  } catch (err) {
    return {
      todos: [],
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Clear all sync state (mappings & settings). Used when disconnecting.
 */
export async function clearRemindersSync(): Promise<void> {
  await Preferences.remove({ key: SETTINGS_KEY });
  await Preferences.remove({ key: MAPPING_KEY });
  await Preferences.remove({ key: LAST_SYNC_KEY });
}
