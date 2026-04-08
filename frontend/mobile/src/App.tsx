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

type Screen = "login" | "unlock" | "main";
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
