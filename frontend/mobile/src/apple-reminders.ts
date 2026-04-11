import { registerPlugin } from "@capacitor/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReminderList {
  id: string;
  title: string;
}

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  isCompleted: boolean;
  dueDate: string | null; // ISO 8601
  completionDate: string | null; // ISO 8601
  lastModified: string | null; // ISO 8601
}

export interface CreateReminderOptions {
  listId: string;
  title: string;
  notes?: string;
  dueDate?: string; // ISO 8601
}

export interface UpdateReminderOptions {
  id: string;
  title?: string;
  notes?: string;
  isCompleted?: boolean;
  dueDate?: string | null;
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface AppleRemindersPlugin {
  /** Request access to Reminders (triggers iOS permission dialog) */
  requestAccess(): Promise<{ granted: boolean }>;

  /** Get all reminder lists the user has */
  getLists(): Promise<{ lists: ReminderList[] }>;

  /** Get all reminders in a specific list */
  getReminders(options: { listId: string }): Promise<{ reminders: Reminder[] }>;

  /** Create a new reminder in the given list */
  createReminder(options: CreateReminderOptions): Promise<{ id: string }>;

  /** Update an existing reminder */
  updateReminder(options: UpdateReminderOptions): Promise<void>;

  /** Delete a reminder by ID */
  deleteReminder(options: { id: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Web stub (no-op on non-iOS platforms)
// ---------------------------------------------------------------------------

class AppleRemindersWeb implements AppleRemindersPlugin {
  async requestAccess(): Promise<{ granted: boolean }> {
    console.warn("AppleReminders: not available on this platform");
    return { granted: false };
  }
  async getLists(): Promise<{ lists: ReminderList[] }> {
    return { lists: [] };
  }
  async getReminders(): Promise<{ reminders: Reminder[] }> {
    return { reminders: [] };
  }
  async createReminder(): Promise<{ id: string }> {
    throw new Error("AppleReminders: not available on this platform");
  }
  async updateReminder(): Promise<void> {
    throw new Error("AppleReminders: not available on this platform");
  }
  async deleteReminder(): Promise<void> {
    throw new Error("AppleReminders: not available on this platform");
  }
}

const AppleReminders = registerPlugin<AppleRemindersPlugin>("AppleReminders", {
  web: new AppleRemindersWeb(),
});

export default AppleReminders;

// ---------------------------------------------------------------------------
// Platform helper
// ---------------------------------------------------------------------------

export function isAppleRemindersAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent)
  );
}
