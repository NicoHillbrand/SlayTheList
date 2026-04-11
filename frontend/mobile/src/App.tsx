import { useCallback, useEffect, useRef, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import {
  getMe,
  getVaultVersion,
  pollDeviceAuth,
  pullVault,
  pushVault,
  setAccessToken,
  startGoogleAuth,
} from "./cloud-api";
import { decryptVault, encryptVault } from "./vault-crypto";
import AppleReminders, {
  isAppleRemindersAvailable,
  type ReminderList,
} from "./apple-reminders";
import {
  clearRemindersSync,
  loadLastSyncTime,
  loadRemindersSettings,
  saveRemindersSettings,
  syncReminders,
  type RemindersSyncSettings,
  type SyncResult,
} from "./reminders-sync";

// ---------------------------------------------------------------------------
// Types (mirrors contracts, but kept lightweight for the mobile bundle)
// ---------------------------------------------------------------------------

interface Todo {
  id: string;
  title: string;
  status: "active" | "done";
  deadlineAt: string | null;
  completedAt: string | null;
}

interface Habit {
  id: string;
  name: string;
  status: "active" | "archived" | "idea";
  checks: { date: string; done: boolean }[];
}

interface Prediction {
  id: string;
  title: string;
  confidence: number;
  outcome: "pending" | "hit" | "miss";
}

interface VaultPayload {
  todos: Todo[];
  habits: Habit[];
  predictions: Prediction[];
  reflections: unknown[];
  gold: { gold: number; rewardedTodoIds: string[] };
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Auth persistence via Capacitor Preferences
// ---------------------------------------------------------------------------

async function loadToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: "accessToken" });
  return value;
}

async function saveToken(token: string) {
  await Preferences.set({ key: "accessToken", value: token });
}

async function clearToken() {
  await Preferences.remove({ key: "accessToken" });
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

type Screen = "login" | "unlock" | "main" | "settings";
type Tab = "todos" | "habits" | "predictions";

export function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [tab, setTab] = useState<Tab>("todos");
  const [username, setUsername] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auth state
  const [pendingDeviceCode, setPendingDeviceCode] = useState<string | null>(null);
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Vault data
  const [vaultVersion, setVaultVersion] = useState(0);
  const [data, setData] = useState<VaultPayload | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Apple Reminders sync state
  const [remindersSettings, setRemindersSettings] = useState<RemindersSyncSettings>({
    enabled: false,
    listId: null,
    listName: null,
    direction: "bidirectional",
  });
  const [reminderLists, setReminderLists] = useState<ReminderList[]>([]);
  const [remindersSyncBusy, setRemindersSyncBusy] = useState(false);
  const [remindersSyncResult, setRemindersSyncResult] = useState<SyncResult | null>(null);
  const [remindersLastSync, setRemindersLastSync] = useState<string | null>(null);
  const [remindersAvailable] = useState(() => isAppleRemindersAvailable());

  // Today's date for habit checks
  const today = new Date().toISOString().slice(0, 10);

  // On mount, try to restore session
  useEffect(() => {
    void (async () => {
      const token = await loadToken();
      if (!token) return;
      setAccessToken(token);
      try {
        const me = await getMe();
        if (me.user) {
          setUsername(me.user.username);
          setScreen("unlock");
        } else {
          await clearToken();
          setAccessToken(null);
        }
      } catch {
        await clearToken();
        setAccessToken(null);
      }
    })();
  }, []);

  // Load Apple Reminders settings on mount
  useEffect(() => {
    void (async () => {
      const settings = await loadRemindersSettings();
      setRemindersSettings(settings);
      const lastSync = await loadLastSyncTime();
      setRemindersLastSync(lastSync);
    })();
  }, []);

  // Poll for device auth
  useEffect(() => {
    if (!pendingDeviceCode) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await pollDeviceAuth(pendingDeviceCode);
        if (cancelled) return;
        if (result.status === "approved") {
          setAccessToken(result.accessToken);
          await saveToken(result.accessToken);
          setUsername(result.user.username);
          setPendingDeviceCode(null);
          setPendingAuthUrl(null);
          setScreen("unlock");
        } else if (result.status === "expired") {
          setPendingDeviceCode(null);
          setPendingAuthUrl(null);
          setError("Sign-in expired. Try again.");
        } else {
          pollTimerRef.current = setTimeout(() => void poll(), 2000);
        }
      } catch {
        if (!cancelled) {
          pollTimerRef.current = setTimeout(() => void poll(), 3000);
        }
      }
    };
    pollTimerRef.current = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [pendingDeviceCode]);

  const handleStartAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startGoogleAuth();
      setPendingDeviceCode(result.deviceCode);
      setPendingAuthUrl(result.authorizationUrl);
      window.open(result.authorizationUrl, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auth");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = useCallback(async () => {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const vault = await pullVault();
      if (!vault.encryptedBlob || !vault.salt || !vault.iv) {
        setError("No vault data found. Push from the desktop app first.");
        setBusy(false);
        return;
      }
      const decrypted = await decryptVault<VaultPayload>(
        { encryptedBlob: vault.encryptedBlob, salt: vault.salt, iv: vault.iv },
        passphrase,
      );
      setData(decrypted);
      setVaultVersion(vault.version);
      setLastSyncAt(vault.updatedAt);
      setScreen("main");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Decryption failed";
      setError(msg.includes("decrypt") || msg.includes("Unsupported") ? "Wrong passphrase." : msg);
    } finally {
      setBusy(false);
    }
  }, [passphrase]);

  const handleSync = async () => {
    if (!data || !passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const encrypted = await encryptVault(data, passphrase);
      const result = await pushVault({ ...encrypted, version: vaultVersion });
      setVaultVersion(result.version);
      setLastSyncAt(result.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const vault = await pullVault();
      if (!vault.encryptedBlob || !vault.salt || !vault.iv) {
        setError("No vault data.");
        setBusy(false);
        return;
      }
      const decrypted = await decryptVault<VaultPayload>(
        { encryptedBlob: vault.encryptedBlob, salt: vault.salt, iv: vault.iv },
        passphrase,
      );
      setData(decrypted);
      setVaultVersion(vault.version);
      setLastSyncAt(vault.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await clearToken();
    setAccessToken(null);
    setData(null);
    setUsername(null);
    setPassphrase("");
    setScreen("login");
  };

  // ── Apple Reminders handlers ──

  const handleConnectReminders = async () => {
    setRemindersSyncBusy(true);
    setRemindersSyncResult(null);
    try {
      const { granted } = await AppleReminders.requestAccess();
      if (!granted) {
        setRemindersSyncResult({
          imported: 0, exported: 0, updated: 0, deleted: 0,
          errors: ["Permission denied. Enable Reminders access in Settings."],
        });
        setRemindersSyncBusy(false);
        return;
      }
      const { lists } = await AppleReminders.getLists();
      setReminderLists(lists);
    } catch (err) {
      setRemindersSyncResult({
        imported: 0, exported: 0, updated: 0, deleted: 0,
        errors: [err instanceof Error ? err.message : "Failed to connect"],
      });
    } finally {
      setRemindersSyncBusy(false);
    }
  };

  const handleSelectReminderList = async (listId: string, listName: string) => {
    const updated: RemindersSyncSettings = {
      ...remindersSettings,
      enabled: true,
      listId,
      listName,
    };
    setRemindersSettings(updated);
    await saveRemindersSettings(updated);
  };

  const handleChangeDirection = async (direction: RemindersSyncSettings["direction"]) => {
    const updated = { ...remindersSettings, direction };
    setRemindersSettings(updated);
    await saveRemindersSettings(updated);
  };

  const handleSyncReminders = async () => {
    if (!data || !remindersSettings.enabled || !remindersSettings.listId) return;
    setRemindersSyncBusy(true);
    setRemindersSyncResult(null);
    try {
      const { todos: updatedTodos, result } = await syncReminders(
        data.todos as any,
        remindersSettings,
      );
      setData({ ...data, todos: updatedTodos as any, updatedAt: new Date().toISOString() });
      setRemindersSyncResult(result);
      const lastSync = await loadLastSyncTime();
      setRemindersLastSync(lastSync);
    } catch (err) {
      setRemindersSyncResult({
        imported: 0, exported: 0, updated: 0, deleted: 0,
        errors: [err instanceof Error ? err.message : "Sync failed"],
      });
    } finally {
      setRemindersSyncBusy(false);
    }
  };

  const handleDisconnectReminders = async () => {
    await clearRemindersSync();
    setRemindersSettings({ enabled: false, listId: null, listName: null, direction: "bidirectional" });
    setReminderLists([]);
    setRemindersSyncResult(null);
    setRemindersLastSync(null);
  };

  const toggleTodo = (todoId: string) => {
    if (!data) return;
    setData({
      ...data,
      todos: data.todos.map((t) =>
        t.id === todoId
          ? { ...t, status: t.status === "done" ? "active" : "done", completedAt: t.status === "active" ? new Date().toISOString() : null }
          : t,
      ),
      updatedAt: new Date().toISOString(),
    });
  };

  const toggleHabitCheck = (habitId: string) => {
    if (!data) return;
    setData({
      ...data,
      habits: data.habits.map((h) => {
        if (h.id !== habitId) return h;
        const existing = h.checks.find((c) => c.date === today);
        if (existing) {
          return { ...h, checks: h.checks.map((c) => (c.date === today ? { ...c, done: !c.done } : c)) };
        }
        return { ...h, checks: [...h.checks, { date: today, done: true }] };
      }),
      updatedAt: new Date().toISOString(),
    });
  };

  // ── Login screen ──
  if (screen === "login") {
    return (
      <div className="screen login-screen">
        <div className="login-card">
          <h1>SlayTheList</h1>
          <p className="subtitle">Cloud Vault</p>
          {error && <p className="error">{error}</p>}
          {!pendingAuthUrl ? (
            <button className="btn-primary" onClick={() => void handleStartAuth()} disabled={busy}>
              {busy ? "Starting..." : "Sign in with Google"}
            </button>
          ) : (
            <div className="pending-auth">
              <p>Complete sign-in in the browser window.</p>
              <a className="btn-primary" href={pendingAuthUrl} target="_blank" rel="noreferrer">
                Open Google sign-in
              </a>
              <p className="hint">Checking automatically...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Unlock screen ──
  if (screen === "unlock") {
    return (
      <div className="screen unlock-screen">
        <div className="login-card">
          <h1>SlayTheList</h1>
          <p className="subtitle">Welcome back, @{username}</p>
          {error && <p className="error">{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter vault passphrase"
              autoFocus
              autoComplete="current-password"
            />
            <button className="btn-primary" type="submit" disabled={busy || !passphrase}>
              {busy ? "Decrypting..." : "Unlock vault"}
            </button>
          </form>
          <button className="btn-link" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // ── Settings screen ──
  if (screen === "settings") {
    return (
      <div className="screen settings-screen">
        <header className="app-header">
          <div className="header-left">
            <button className="btn-icon" onClick={() => setScreen("main")} title="Back">
              &#x2190;
            </button>
            <h1>Settings</h1>
          </div>
        </header>

        <div className="content settings-content">
          {/* Apple Reminders Section */}
          <section className="settings-section">
            <h2>Apple Reminders</h2>
            {!remindersAvailable && (
              <p className="settings-note">
                Apple Reminders sync is only available on iOS devices.
              </p>
            )}

            {remindersAvailable && !remindersSettings.enabled && reminderLists.length === 0 && (
              <div className="settings-card">
                <p className="settings-desc">
                  Connect Apple Reminders to sync your todos bidirectionally.
                  Changes in either app will be mirrored to the other.
                </p>
                <button
                  className="btn-primary"
                  onClick={() => void handleConnectReminders()}
                  disabled={remindersSyncBusy}
                >
                  {remindersSyncBusy ? "Connecting..." : "Connect Apple Reminders"}
                </button>
              </div>
            )}

            {remindersAvailable && !remindersSettings.enabled && reminderLists.length > 0 && (
              <div className="settings-card">
                <p className="settings-desc">Select a Reminders list to sync with:</p>
                <div className="list-picker">
                  {reminderLists.map((list) => (
                    <button
                      key={list.id}
                      className="list-picker-item"
                      onClick={() => void handleSelectReminderList(list.id, list.title)}
                    >
                      {list.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {remindersSettings.enabled && (
              <div className="settings-card">
                <div className="settings-row">
                  <span className="settings-label">Connected list</span>
                  <span className="settings-value">{remindersSettings.listName}</span>
                </div>

                <div className="settings-row">
                  <span className="settings-label">Sync direction</span>
                  <select
                    className="settings-select"
                    value={remindersSettings.direction}
                    onChange={(e) =>
                      void handleChangeDirection(e.target.value as RemindersSyncSettings["direction"])
                    }
                  >
                    <option value="bidirectional">Bidirectional</option>
                    <option value="import">Import only (Reminders → SlayTheList)</option>
                    <option value="export">Export only (SlayTheList → Reminders)</option>
                  </select>
                </div>

                {remindersLastSync && (
                  <div className="settings-row">
                    <span className="settings-label">Last synced</span>
                    <span className="settings-value">
                      {new Date(remindersLastSync).toLocaleString()}
                    </span>
                  </div>
                )}

                <button
                  className="btn-primary"
                  onClick={() => void handleSyncReminders()}
                  disabled={remindersSyncBusy || !data}
                  style={{ marginTop: "0.75rem" }}
                >
                  {remindersSyncBusy ? "Syncing..." : "Sync Now"}
                </button>

                {remindersSyncResult && (
                  <div className="sync-result">
                    {remindersSyncResult.imported > 0 && (
                      <span className="sync-stat">+{remindersSyncResult.imported} imported</span>
                    )}
                    {remindersSyncResult.exported > 0 && (
                      <span className="sync-stat">+{remindersSyncResult.exported} exported</span>
                    )}
                    {remindersSyncResult.updated > 0 && (
                      <span className="sync-stat">{remindersSyncResult.updated} updated</span>
                    )}
                    {remindersSyncResult.deleted > 0 && (
                      <span className="sync-stat">{remindersSyncResult.deleted} deleted</span>
                    )}
                    {remindersSyncResult.imported === 0 &&
                      remindersSyncResult.exported === 0 &&
                      remindersSyncResult.updated === 0 &&
                      remindersSyncResult.deleted === 0 &&
                      remindersSyncResult.errors.length === 0 && (
                        <span className="sync-stat">Everything up to date</span>
                      )}
                    {remindersSyncResult.errors.map((err, i) => (
                      <p key={i} className="error" style={{ marginTop: "0.5rem" }}>
                        {err}
                      </p>
                    ))}
                  </div>
                )}

                <button
                  className="btn-link"
                  onClick={() => void handleDisconnectReminders()}
                  style={{ marginTop: "1rem" }}
                >
                  Disconnect Apple Reminders
                </button>
              </div>
            )}
          </section>

          {/* Account Section */}
          <section className="settings-section">
            <h2>Account</h2>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-label">Signed in as</span>
                <span className="settings-value">@{username}</span>
              </div>
              <button
                className="btn-link"
                onClick={() => void handleLogout()}
                style={{ marginTop: "0.5rem" }}
              >
                Sign out
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ── Main screen ──
  const activeTodos = data?.todos.filter((t) => t.status === "active") ?? [];
  const doneTodos = data?.todos.filter((t) => t.status === "done") ?? [];
  const activeHabits = data?.habits.filter((h) => h.status === "active") ?? [];
  const pendingPredictions = data?.predictions.filter((p) => p.outcome === "pending") ?? [];
  const resolvedPredictions = data?.predictions.filter((p) => p.outcome !== "pending") ?? [];

  return (
    <div className="screen main-screen">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1>SlayTheList</h1>
          <span className="gold-badge">{data?.gold.gold ?? 0} gold</span>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={() => void handleRefresh()} disabled={busy} title="Pull from vault">
            &#x21bb;
          </button>
          <button className="btn-icon" onClick={() => void handleSync()} disabled={busy} title="Push to vault">
            &#x2191;
          </button>
          <button className="btn-icon" onClick={() => setScreen("settings")} title="Settings">
            &#x2699;
          </button>
          <button className="btn-icon" onClick={() => void handleLogout()} title="Sign out">
            &#x2715;
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {lastSyncAt && (
        <p className="sync-info">
          Last sync: {new Date(lastSyncAt).toLocaleString()} &middot; v{vaultVersion}
        </p>
      )}

      {/* Tabs */}
      <nav className="tabs">
        <button className={tab === "todos" ? "active" : ""} onClick={() => setTab("todos")}>
          Todos ({activeTodos.length})
        </button>
        <button className={tab === "habits" ? "active" : ""} onClick={() => setTab("habits")}>
          Habits ({activeHabits.length})
        </button>
        <button className={tab === "predictions" ? "active" : ""} onClick={() => setTab("predictions")}>
          Predictions ({pendingPredictions.length})
        </button>
      </nav>

      {/* Content */}
      <div className="content">
        {tab === "todos" && (
          <>
            <section>
              <h2>Active</h2>
              {activeTodos.length === 0 && <p className="empty">No active todos</p>}
              {activeTodos.map((todo) => (
                <div key={todo.id} className="todo-item">
                  <button className="check" onClick={() => toggleTodo(todo.id)}>&#x25cb;</button>
                  <div className="todo-text">
                    <span>{todo.title}</span>
                    {todo.deadlineAt && (
                      <span className="deadline">{new Date(todo.deadlineAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </section>
            {doneTodos.length > 0 && (
              <details>
                <summary className="section-summary">Completed ({doneTodos.length})</summary>
                {doneTodos.map((todo) => (
                  <div key={todo.id} className="todo-item done">
                    <button className="check checked" onClick={() => toggleTodo(todo.id)}>&#x2713;</button>
                    <span className="todo-title-done">{todo.title}</span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}

        {tab === "habits" && (
          <section>
            <h2>Today&apos;s Habits</h2>
            {activeHabits.length === 0 && <p className="empty">No active habits</p>}
            {activeHabits.map((habit) => {
              const checked = habit.checks.some((c) => c.date === today && c.done);
              return (
                <div key={habit.id} className="habit-item">
                  <button
                    className={`check ${checked ? "checked" : ""}`}
                    onClick={() => toggleHabitCheck(habit.id)}
                  >
                    {checked ? "\u2713" : "\u25cb"}
                  </button>
                  <span>{habit.name}</span>
                </div>
              );
            })}
          </section>
        )}

        {tab === "predictions" && (
          <>
            <section>
              <h2>Pending</h2>
              {pendingPredictions.length === 0 && <p className="empty">No pending predictions</p>}
              {pendingPredictions.map((p) => (
                <div key={p.id} className="prediction-item">
                  <span className="confidence">{p.confidence}%</span>
                  <span>{p.title}</span>
                </div>
              ))}
            </section>
            {resolvedPredictions.length > 0 && (
              <details>
                <summary className="section-summary">Resolved ({resolvedPredictions.length})</summary>
                {resolvedPredictions.map((p) => (
                  <div key={p.id} className={`prediction-item ${p.outcome}`}>
                    <span className="confidence">{p.confidence}%</span>
                    <span className="outcome-icon">{p.outcome === "hit" ? "\u2713" : "\u2717"}</span>
                    <span>{p.title}</span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
