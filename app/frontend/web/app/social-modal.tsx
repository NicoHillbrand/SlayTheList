"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type {
  CloudConnectionStatus,
  EncouragementEntryType,
  EncouragementKind,
  FriendRelationship,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  GoldActivityDay,
  GoldState,
  Habit,
  Prediction,
  SharedProfile,
  SocialSettings,
  SocialVisibility,
} from "@slaythelist/contracts";
import {
  FEED_WINDOW_SETTING_KEY,
  acceptCloudFriendRequest,
  cancelCloudFriendRequest,
  declineCloudFriendRequest,
  disconnectCloudConnect,
  getAppSetting,
  getCloudConnectionStatus,
  getCloudSharedProfile,
  getCloudSocialSettings,
  getGoldState,
  listCloudFriendRequests,
  listCloudFriends,
  listGoldActivity,
  listHabits,
  listPredictions,
  updateGoldActivityDate,
  updatePrediction,
  pollCloudConnect,
  saveCloudSocialSettings,
  searchCloudSocialUsers,
  setAppSetting,
  removeCloudFriend,
  sendCloudFriendRequest,
  sendEncouragement,
  startCloudConnect,
  syncCloudSnapshot,
  updateCloudUsername,
} from "../lib/api";
import { AchievementSummary, PeriodSelector, defaultLogPeriod } from "./daily-log";

// Read-only viewer for a friend's base (the lane defense). Client-only: the
// theater animates with timers that must not run during SSR.
const FriendBaseView = dynamic(
  () => import("./base/FriendBaseView").then((m) => m.FriendBaseView),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "#888" }}>
        Loading base...
      </div>
    ),
  },
);

type Props = {
  open?: boolean;
  onClose?: () => void;
  embedded?: boolean;
  showSettings?: boolean;
  onCloseSettings?: () => void;
};

const DEFAULT_SETTINGS: SocialSettings = {
  habitsVisibility: "friends",
  predictionsVisibility: "friends",
  goldVisibility: "friends",
  walkthroughsVisibility: "private",
  baseVisibility: "friends",
  dailyLogVisibility: "friends",
};


function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

// Local predictions minus private ones — mirrors what the cloud snapshot
// shares, so the self-profile card looks the same either way.
async function listShareablePredictions() {
  const result = await listPredictions();
  return result.items.filter((p) => p.visibility !== "private");
}

// Local habits minus private ones — same idea, so the self-profile habit grid
// reflects live local checks instead of the last-synced cloud snapshot.
async function listShareableHabits() {
  const result = await listHabits();
  return result.items.filter((h) => h.visibility !== "private");
}

// Stale-while-revalidate cache for shared profiles: the last-seen profile is
// shown instantly on open (own profile especially — the data barely changes
// between visits) while the fresh copy loads in the background.
const PROFILE_CACHE_PREFIX = "slaythelist:social-profile:";

function readCachedProfile(username: string): SharedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + username.toLowerCase());
    return raw ? (JSON.parse(raw) as SharedProfile) : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(username: string, profile: SharedProfile) {
  try {
    localStorage.setItem(PROFILE_CACHE_PREFIX + username.toLowerCase(), JSON.stringify(profile));
  } catch {
    // Quota/serialization failures just mean no cache — never block the UI.
  }
}

const FRIEND_ORDER_KEY = "slaythelist.friendOrder";

function readFriendOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FRIEND_ORDER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeFriendOrder(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FRIEND_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be unavailable (private mode); ordering is best-effort.
  }
}

// Sort friends by the locally-saved drag order. Unknown ids (new friends) fall
// to the end, preserving the server's ordering among them.
function applyFriendOrder(items: FriendSummary[]): FriendSummary[] {
  const order = readFriendOrder();
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((friend, index) => ({ friend, index }))
    .sort((a, b) => {
      const ra = rank.get(a.friend.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.friend.id) ?? Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map(({ friend }) => friend);
}

function relationshipLabel(relationship: FriendRelationship) {
  switch (relationship) {
    case "friend":
      return "Friends";
    case "incoming_request":
      return "Incoming request";
    case "outgoing_request":
      return "Request sent";
    case "self":
      return "You";
    default:
      return "Not connected";
  }
}

function recentPredictionsByDay(predictions: Prediction[]) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = predictions.filter((p) => p.createdAt >= sevenDaysAgo);
  recent.sort((a, b) => b.createdAt - a.createdAt);

  const grouped: { label: string; items: Prediction[] }[] = [];
  for (const prediction of recent) {
    const date = new Date(prediction.createdAt);
    const label = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) {
      last.items.push(prediction);
    } else {
      grouped.push({ label, items: [prediction] });
    }
  }
  return grouped;
}

function outcomeIcon(outcome: string) {
  if (outcome === "hit") return "\u2713";
  if (outcome === "miss") return "\u2717";
  return "\u2022";
}

function outcomeClass(outcome: string) {
  if (outcome === "hit") return "social-outcome-hit";
  if (outcome === "miss") return "social-outcome-miss";
  return "social-outcome-pending";
}

function syncLabel(status: CloudConnectionStatus | null) {
  if (!status) return "idle";
  if (!status.connected) return status.pendingAuth ? "connect pending" : "not connected";
  if (status.lastSyncState === "success" && status.lastSyncAt) {
    return `synced ${new Date(status.lastSyncAt).toLocaleTimeString()}`;
  }
  return status.lastSyncState;
}

export default function SocialModal({ open = false, onClose, embedded = false, showSettings = false, onCloseSettings }: Props) {
  const isVisible = embedded || open;
  const [status, setStatus] = useState<CloudConnectionStatus | null>(null);
  const [settings, setSettings] = useState<SocialSettings>(DEFAULT_SETTINGS);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<SharedProfile | null>(null);
  const [ownLogDays, setOwnLogDays] = useState<GoldActivityDay[] | null>(null);
  const [ownPredictions, setOwnPredictions] = useState<Prediction[] | null>(null);
  const [ownHabits, setOwnHabits] = useState<Habit[] | null>(null);
  const [ownGold, setOwnGold] = useState<GoldState | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);

  // Collapse the inline base viewer whenever the selected profile changes.
  useEffect(() => {
    setBaseOpen(false);
  }, [selectedUsername]);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [encouragedIds, setEncouragedIds] = useState<Set<string>>(new Set());
  const [encouragementsRemaining, setEncouragementsRemaining] = useState<number | null>(null);
  const [logPeriod, setLogPeriod] = useState<string>(defaultLogPeriod());
  const [draggingFriendId, setDraggingFriendId] = useState<string | null>(null);
  const [feedWindowMinutes, setFeedWindowMinutes] = useState(60);
  const closeSettings = onCloseSettings ?? (() => {});

  // The overlay's friends-feed window lives in local app settings (not the
  // cloud visibility settings) so the overlay window can read it directly.
  useEffect(() => {
    if (!showSettings) return;
    void getAppSetting(FEED_WINDOW_SETTING_KEY)
      .then((setting) => {
        const parsed = Number(setting.value);
        if (Number.isFinite(parsed) && parsed > 0) setFeedWindowMinutes(Math.round(parsed));
      })
      .catch(() => {
        // Local API down — keep the default; the select still renders.
      });
  }, [showSettings]);

  async function onChangeFeedWindow(minutes: number) {
    setFeedWindowMinutes(minutes);
    try {
      await setAppSetting(FEED_WINDOW_SETTING_KEY, String(minutes));
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }

  const refreshConnectedData = useCallback(async (currentStatus?: CloudConnectionStatus | null) => {
    const nextStatus = currentStatus ?? (await getCloudConnectionStatus());
    const nextSettings = await getCloudSocialSettings();
    setStatus(nextStatus);
    setSettings(nextSettings);
    setUsernameDraft(nextStatus.user?.username ?? "");

    if (nextStatus.connected) {
      // Default to your own profile right away — your username comes from the
      // local status call, so selection (and the cached profile render) never
      // waits on the cloud friends fetch below.
      if (nextStatus.user?.username) {
        const ownUsername = nextStatus.user.username;
        setSelectedUsername((current) => current ?? ownUsername);
      }
      const [friendsResponse, requestsResponse] = await Promise.all([listCloudFriends(), listCloudFriendRequests()]);
      const orderedFriends = applyFriendOrder(friendsResponse.items);
      setFriends(orderedFriends);
      setIncomingRequests(requestsResponse.incoming);
      setOutgoingRequests(requestsResponse.outgoing);
      // Fall back to the top friend if the account somehow has no username yet.
      if (orderedFriends.length > 0) {
        setSelectedUsername((current) => current ?? orderedFriends[0].username);
      }
      return;
    }

    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
    setSearchResults([]);
    setSelectedUsername(null);
    setSelectedProfile(null);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getCloudConnectionStatus()
      .then(async (nextStatus) => {
        if (cancelled) return;
        await refreshConnectedData(nextStatus);
      })
      .catch(async (nextError) => {
        if (cancelled) return;
        setError(toErrorMessage(nextError));
        try {
          const recheck = await getCloudConnectionStatus();
          if (!cancelled) setStatus(recheck);
        } catch {
          // status endpoint is local-only and shouldn't fail; ignore
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, refreshConnectedData]);

  useEffect(() => {
    if (!isVisible || !status?.connected) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchCloudSocialUsers(query)
        .then((response) => {
          if (!cancelled) setSearchResults(response.items);
        })
        .catch((nextError) => {
          if (!cancelled) setError(toErrorMessage(nextError));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isVisible, searchQuery, status?.connected]);

  useEffect(() => {
    if (!isVisible || !status?.connected || !selectedUsername) {
      setSelectedProfile(null);
      return;
    }
    let cancelled = false;
    // Render the cached copy immediately (or clear a previous user's profile),
    // then revalidate from the cloud in the background.
    const cached = readCachedProfile(selectedUsername);
    setSelectedProfile(cached);
    if (cached) {
      setEncouragedIds(new Set(cached.encouragedEntryIds ?? []));
      setEncouragementsRemaining(cached.encouragementsRemainingToday ?? null);
    }
    setBusyAction(`profile:${selectedUsername}`);
    void getCloudSharedProfile(selectedUsername)
      .then((profile) => {
        if (!cancelled) {
          setSelectedProfile(profile);
          setEncouragedIds(new Set(profile.encouragedEntryIds ?? []));
          setEncouragementsRemaining(profile.encouragementsRemainingToday ?? null);
        }
        writeCachedProfile(selectedUsername, profile);
      })
      .catch((nextError) => {
        if (!cancelled) setError(toErrorMessage(nextError));
      })
      .finally(() => {
        if (!cancelled) setBusyAction((current) => (current === `profile:${selectedUsername}` ? null : current));
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, selectedUsername, status?.connected]);

  // Own profile: pull the log from the local ledger instead of the cloud
  // snapshot — local entries carry ids, which enables moving an entry to the
  // day it actually happened (hover date picker on log rows).
  const isSelfProfile = !!selectedUsername && selectedUsername === status?.user?.username;

  useEffect(() => {
    if (!isVisible || !isSelfProfile) {
      setOwnLogDays(null);
      setOwnPredictions(null);
      setOwnHabits(null);
      setOwnGold(null);
      return;
    }
    let cancelled = false;
    void getGoldState()
      .then((state) => {
        if (!cancelled) setOwnGold(state);
      })
      .catch(() => {
        // Fall back to the cloud snapshot's gold if the local API is down.
        if (!cancelled) setOwnGold(null);
      });
    void listGoldActivity(30)
      .then((result) => {
        if (!cancelled) setOwnLogDays(result.days);
      })
      .catch(() => {
        // Fall back to the cloud snapshot (read-only) if the local API is down.
        if (!cancelled) setOwnLogDays(null);
      });
    void listShareablePredictions()
      .then((items) => {
        if (!cancelled) setOwnPredictions(items);
      })
      .catch(() => {
        if (!cancelled) setOwnPredictions(null);
      });
    void listShareableHabits()
      .then((items) => {
        if (!cancelled) setOwnHabits(items);
      })
      .catch(() => {
        // Fall back to the cloud snapshot if the local API is down.
        if (!cancelled) setOwnHabits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, isSelfProfile]);

  async function handleMoveLogEntry(entryId: string, date: string) {
    setError(null);
    try {
      await updateGoldActivityDate(entryId, date);
      const result = await listGoldActivity(30);
      setOwnLogDays(result.days);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }

  // Move a prediction to the day it belongs in the log. Sets only the logDate
  // grouping override — createdAt ("Made …") and resolvedAt stay as recorded.
  async function handleMovePrediction(predictionId: string, date: string) {
    setError(null);
    try {
      await updatePrediction(predictionId, { logDate: date });
      setOwnPredictions(await listShareablePredictions());
      // The main page keeps the whole predictions array in memory and
      // autosaves it wholesale — tell it to reload, or its next autosave
      // would write the stale copy back and silently revert this move.
      window.dispatchEvent(new Event("slaythelist:accountability-changed"));
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }

  const outgoingByUsername = useMemo(
    () => new Map(outgoingRequests.map((request) => [request.receiver.username.toLowerCase(), request])),
    [outgoingRequests],
  );

  const incomingByUsername = useMemo(
    () => new Map(incomingRequests.map((request) => [request.sender.username.toLowerCase(), request])),
    [incomingRequests],
  );

  async function withBusyAction<T>(key: string, action: () => Promise<T>) {
    setBusyAction(key);
    setError(null);
    try {
      return await action();
    } finally {
      setBusyAction((current) => (current === key ? null : current));
    }
  }

  const refreshAfterMutation = useCallback(
    async (nextStatus?: CloudConnectionStatus | null) => {
      await refreshConnectedData(nextStatus ?? undefined);
      if (searchQuery.trim() && (nextStatus?.connected ?? status?.connected)) {
        const results = await searchCloudSocialUsers(searchQuery.trim());
        setSearchResults(results.items);
      }
    },
    [refreshConnectedData, searchQuery, status?.connected],
  );

  useEffect(() => {
    if (!isVisible || !status?.pendingAuth || status.connected) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void pollCloudConnect()
        .then(async (nextStatus) => {
          if (cancelled) return;
          await refreshAfterMutation(nextStatus);
        })
        .catch((nextError) => {
          if (!cancelled) setError(toErrorMessage(nextError));
        });
    }, Math.max(1000, (status.pendingAuth.intervalSeconds ?? 2) * 1000));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isVisible, refreshAfterMutation, status?.connected, status?.pendingAuth]);

  async function onStartConnect() {
    await withBusyAction("connect-start", async () => {
      const nextStatus = await startCloudConnect("google");
      setStatus(nextStatus);
      const authorizationUrl = nextStatus.pendingAuth?.authorizationUrl;
      if (authorizationUrl) {
        window.open(authorizationUrl, "_blank", "noopener,noreferrer");
      }
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onPollConnect() {
    await withBusyAction("connect-poll", async () => {
      const nextStatus = await pollCloudConnect();
      await refreshAfterMutation(nextStatus);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onDisconnect() {
    await withBusyAction("disconnect", async () => {
      const nextStatus = await disconnectCloudConnect();
      await refreshAfterMutation(nextStatus);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSyncNow() {
    await withBusyAction("sync-now", async () => {
      const nextStatus = await syncCloudSnapshot();
      await refreshAfterMutation(nextStatus);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSaveSettings() {
    await withBusyAction("save-settings", async () => {
      const saved = await saveCloudSocialSettings(settings);
      setSettings(saved);
      const nextStatus = await getCloudConnectionStatus();
      setStatus(nextStatus);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSaveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withBusyAction("save-username", async () => {
      const nextStatus = await updateCloudUsername(usernameDraft);
      setStatus(nextStatus);
      setUsernameDraft(nextStatus.user?.username ?? usernameDraft);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSendFriendRequest(username: string) {
    await withBusyAction(`request:${username}`, async () => {
      await sendCloudFriendRequest(username);
      await refreshAfterMutation();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onAcceptRequest(requestId: string) {
    await withBusyAction(`accept:${requestId}`, async () => {
      await acceptCloudFriendRequest(requestId);
      await refreshAfterMutation();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onDeclineRequest(requestId: string) {
    await withBusyAction(`decline:${requestId}`, async () => {
      await declineCloudFriendRequest(requestId);
      await refreshAfterMutation();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onCancelRequest(requestId: string) {
    await withBusyAction(`cancel:${requestId}`, async () => {
      await cancelCloudFriendRequest(requestId);
      await refreshAfterMutation();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onRemoveFriend(friendUserId: string) {
    await withBusyAction(`remove:${friendUserId}`, async () => {
      await removeCloudFriend(friendUserId);
      if (selectedUsername) {
        const removed = friends.find((f) => f.id === friendUserId);
        if (removed && removed.username === selectedUsername) {
          setSelectedUsername(null);
        }
      }
      await refreshAfterMutation();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  function reorderFriend(targetId: string) {
    const sourceId = draggingFriendId;
    setDraggingFriendId(null);
    if (!sourceId || sourceId === targetId) return;
    setFriends((current) => {
      const from = current.findIndex((f) => f.id === sourceId);
      const to = current.findIndex((f) => f.id === targetId);
      if (from === -1 || to === -1) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      writeFriendOrder(next.map((f) => f.id));
      return next;
    });
  }

  async function onEncourage(entryType: EncouragementEntryType, entryId: string, kind: EncouragementKind) {
    if (!selectedProfile || encouragedIds.has(entryId)) return;
    if (encouragementsRemaining !== null && encouragementsRemaining <= 0) return;
    // Optimistic update
    setEncouragedIds((prev) => new Set(prev).add(entryId));
    setEncouragementsRemaining((prev) => (prev !== null ? Math.max(0, prev - 1) : prev));
    try {
      const result = await sendEncouragement(selectedProfile.user.id, entryType, entryId, kind);
      setEncouragementsRemaining(result.remainingToday);
    } catch (nextError) {
      // Revert optimistic update
      setEncouragedIds((prev) => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
      setEncouragementsRemaining((prev) => (prev !== null ? prev + 1 : prev));
      setError(toErrorMessage(nextError));
    }
  }

  if (!embedded && !open) return null;

  /* ── Not configured ── */
  const notConfiguredContent = (
    <section className="social-card">
      <p className="settings-section-title">Cloud sync unavailable</p>
      <p className="settings-section-copy">
        The cloud service URL has been explicitly unset. Remove the <code>CLOUD_SOCIAL_BASE_URL</code> override to restore the default server.
      </p>
    </section>
  );

  /* ── Not connected (login page) ── */
  const notConnectedContent = (
    <div className="social-login-page">
      <div className="social-login-hero">
        <h3>Connect to Social</h3>
        <p className="settings-section-copy">
          Sign in with Google to sync habits, predictions, and gold — and connect with friends.
        </p>
        {!status?.pendingAuth ? (
          <button
            type="button"
            className="social-connect-button"
            onClick={() => void onStartConnect()}
            disabled={busyAction === "connect-start"}
          >
            {busyAction === "connect-start" ? "Starting..." : "Connect with Google"}
          </button>
        ) : (
          <div className="social-form">
            <p className="settings-section-copy">
              Finish Google sign-in in the browser window. This page will keep checking automatically.
            </p>
            <div className="social-inline-actions">
              <a
                className="social-connect-button"
                href={status.pendingAuth.authorizationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Google sign-in
              </a>
              <button type="button" onClick={() => void onPollConnect()} disabled={busyAction === "connect-poll"}>
                {busyAction === "connect-poll" ? "Checking..." : "Check now"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* ── Connected: Friends tab ── */
  const friendsTabContent = (
    <div className="social-friends-layout">
      {/* Profile panel */}
      <div className="social-profile-panel">
        {!selectedUsername ? (
          <div className="social-empty-state">
            <p className="settings-section-copy">Select a friend or search for someone to view their profile.</p>
          </div>
        ) : busyAction === `profile:${selectedUsername}` && !selectedProfile ? (
          <div className="social-empty-state">
            <p className="settings-hint">Loading @{selectedUsername}...</p>
          </div>
        ) : !selectedProfile ? (
          <div className="social-empty-state">
            <p className="settings-hint">Could not load profile.</p>
          </div>
        ) : (
          <div className="social-profile-content">
            {(() => {
              const hasLog =
                selectedProfile.habits.canView ||
                selectedProfile.dailyLog?.canView ||
                selectedProfile.predictions.canView;
              return (
                <>
                  <div className="social-profile-top">
                    <h4>@{selectedProfile.user.username}</h4>
                    {(selectedProfile.gold.canView || (isSelfProfile && ownGold)) && (
                      <span className="social-gold-value">
                        {(isSelfProfile && ownGold ? ownGold.gold : selectedProfile.gold.state?.gold) ?? 0} gold
                      </span>
                    )}
                    <div className="social-profile-top-actions">
                      {hasLog && <PeriodSelector selected={logPeriod} onSelect={setLogPeriod} />}
                      {selectedProfile.base?.canView && (
                        <button
                          type="button"
                          className={`achievement-period-pill ${baseOpen ? "active" : ""}`}
                          onClick={() => setBaseOpen((open) => !open)}
                        >
                          {baseOpen ? "Hide base" : "View base"}
                        </button>
                      )}
                    </div>
                  </div>

                  {baseOpen && selectedProfile.base?.canView && (
                    selectedProfile.base.snapshot ? (
                      <div style={{ position: "relative", flex: "none", marginBottom: 12 }}>
                        <FriendBaseView base={selectedProfile.base.snapshot} />
                        <a
                          href={`/base/view/${encodeURIComponent(selectedProfile.user.username)}`}
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            padding: "3px 10px",
                            borderRadius: 999,
                            background: "rgba(22, 22, 42, 0.85)",
                            border: "1px solid #444",
                            color: "#ccc",
                            fontSize: 12,
                            textDecoration: "none",
                          }}
                        >
                          Fullscreen
                        </a>
                      </div>
                    ) : (
                      <p className="settings-hint">
                        @{selectedProfile.user.username} hasn&apos;t synced their base yet. It shows up here
                        once they open the app.
                      </p>
                    )
                  )}

                  {hasLog ? (
                    <AchievementSummary
                      days={
                        isSelfProfile && ownLogDays
                          ? ownLogDays
                          : selectedProfile.dailyLog?.canView
                            ? selectedProfile.dailyLog.days
                            : []
                      }
                      habits={
                        isSelfProfile && ownHabits
                          ? ownHabits
                          : selectedProfile.habits.canView
                            ? selectedProfile.habits.items
                            : []
                      }
                      predictions={
                        isSelfProfile && ownPredictions
                          ? ownPredictions
                          : selectedProfile.predictions.canView
                            ? selectedProfile.predictions.items
                            : []
                      }
                      selected={logPeriod}
                      showHabits={(isSelfProfile && !!ownHabits) || selectedProfile.habits.canView}
                      compact
                      onMoveEntry={isSelfProfile && ownLogDays ? handleMoveLogEntry : undefined}
                      onMovePrediction={isSelfProfile && ownPredictions ? handleMovePrediction : undefined}
                    />
                  ) : (
                    <p className="settings-hint">Nothing shared.</p>
                  )}
                </>
              );
            })()}

          </div>
        )}
      </div>

      <div className="social-friends-sidebar">
        {/* Search */}
        <div className="social-search-box">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search users..."
          />
        </div>

        {/* Search results */}
        {searchQuery.trim() && (
          <div className="social-search-results">
            {searchResults.length === 0 ? (
              <p className="settings-hint">No results found.</p>
            ) : (
              searchResults.map((result) => {
                const outgoingRequest = outgoingByUsername.get(result.user.username.toLowerCase());
                const incomingRequest = incomingByUsername.get(result.user.username.toLowerCase());
                return (
                  <div key={result.user.id} className="social-user-row">
                    <button
                      type="button"
                      className="social-user-name"
                      onClick={() => setSelectedUsername(result.user.username)}
                    >
                      @{result.user.username}
                    </button>
                    <div className="social-user-actions">
                      <span className="social-pill social-pill-sm">{relationshipLabel(result.relationship)}</span>
                      {result.relationship === "none" && (
                        <button
                          type="button"
                          className="social-action-btn"
                          onClick={() => void onSendFriendRequest(result.user.username)}
                          disabled={busyAction === `request:${result.user.username}`}
                        >
                          {busyAction === `request:${result.user.username}` ? "..." : "Add"}
                        </button>
                      )}
                      {result.relationship === "outgoing_request" && outgoingRequest && (
                        <button
                          type="button"
                          className="social-action-btn social-action-btn-muted"
                          onClick={() => void onCancelRequest(outgoingRequest.id)}
                          disabled={busyAction === `cancel:${outgoingRequest.id}`}
                        >
                          Cancel
                        </button>
                      )}
                      {result.relationship === "incoming_request" && incomingRequest && (
                        <button
                          type="button"
                          className="social-action-btn"
                          onClick={() => void onAcceptRequest(incomingRequest.id)}
                          disabled={busyAction === `accept:${incomingRequest.id}`}
                        >
                          Accept
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Incoming friend requests */}
        {incomingRequests.length > 0 && (
          <div className="social-requests-section">
            <p className="social-section-label">Requests</p>
            {incomingRequests.map((request) => (
              <div key={request.id} className="social-user-row">
                <span className="social-user-name-text">@{request.sender.username}</span>
                <div className="social-user-actions">
                  <button
                    type="button"
                    className="social-action-btn"
                    onClick={() => void onAcceptRequest(request.id)}
                    disabled={busyAction === `accept:${request.id}`}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="social-action-btn social-action-btn-muted"
                    onClick={() => void onDeclineRequest(request.id)}
                    disabled={busyAction === `decline:${request.id}`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Outgoing requests */}
        {outgoingRequests.length > 0 && (
          <div className="social-requests-section">
            <p className="social-section-label">Sent</p>
            {outgoingRequests.map((request) => (
              <div key={request.id} className="social-user-row">
                <span className="social-user-name-text">@{request.receiver.username}</span>
                <button
                  type="button"
                  className="social-action-btn social-action-btn-muted"
                  onClick={() => void onCancelRequest(request.id)}
                  disabled={busyAction === `cancel:${request.id}`}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Self preview */}
        {status?.user?.username && (
          <div className="social-friends-list">
            <p className="social-section-label">You</p>
            <div
              className={`social-friend-item ${
                selectedUsername === status.user.username ? "active" : ""
              }`}
            >
              <span className="social-friend-drag-handle" aria-hidden="true">
                ★
              </span>
              <button
                type="button"
                className="social-friend-item-name"
                onClick={() => setSelectedUsername(status.user!.username)}
                title="Your profile as friends see it"
              >
                @{status.user.username}
              </button>
            </div>
          </div>
        )}

        {/* Friends list */}
        <div className="social-friends-list">
          <p className="social-section-label">Friends</p>
          {friends.length === 0 ? (
            <p className="settings-hint">No friends yet. Search above to add someone.</p>
          ) : (
            friends.map((friend) => (
              <div
                key={friend.id}
                className={`social-friend-item ${selectedUsername === friend.username ? "active" : ""} ${
                  draggingFriendId === friend.id ? "dragging" : ""
                }`}
                draggable
                onDragStart={(event) => {
                  setDraggingFriendId(friend.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (draggingFriendId && draggingFriendId !== friend.id) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderFriend(friend.id);
                }}
                onDragEnd={() => setDraggingFriendId(null)}
              >
                <span className="social-friend-drag-handle" aria-hidden="true" title="Drag to reorder">
                  ⠿
                </span>
                <button
                  type="button"
                  className="social-friend-item-name"
                  onClick={() => setSelectedUsername(friend.username)}
                >
                  @{friend.username}
                </button>
                <button
                  type="button"
                  className="social-friend-remove"
                  title="Remove friend"
                  onClick={() => void onRemoveFriend(friend.id)}
                  disabled={busyAction === `remove:${friend.id}`}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  /* ── Connected: Settings tab ── */
  const settingsTabContent = (
    <div className="social-settings-grid">
      <section className="social-card">
        <p className="settings-section-title">Public username</p>
        <p className="settings-section-copy">
          This is the name other people search for and see on your shared profile.
        </p>
        <form className="social-form" onSubmit={onSaveUsername}>
          <input value={usernameDraft} onChange={(event) => setUsernameDraft(event.target.value)} />
          <button type="submit" disabled={busyAction === "save-username"}>
            {busyAction === "save-username" ? "Saving..." : "Save username"}
          </button>
        </form>
      </section>

      <section className="social-card">
        <p className="settings-section-title">Visibility</p>
        <p className="settings-section-copy">
          Control who can see your habits, predictions, and gold on your profile.
        </p>
        <div className="social-visibility-grid">
          <label className="social-visibility-row">
            <span>Habits</span>
            <select
              value={settings.habitsVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  habitsVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="social-visibility-row">
            <span>Predictions</span>
            <select
              value={settings.predictionsVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  predictionsVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="social-visibility-row">
            <span>Gold</span>
            <select
              value={settings.goldVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  goldVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="social-visibility-row">
            <span>Walkthroughs</span>
            <select
              value={settings.walkthroughsVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  walkthroughsVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="social-visibility-row">
            <span>Base</span>
            <select
              value={settings.baseVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  baseVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="social-visibility-row">
            <span>Daily log</span>
            <select
              value={settings.dailyLogVisibility}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  dailyLogVisibility: event.target.value as SocialVisibility,
                }))
              }
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={() => void onSaveSettings()} disabled={busyAction === "save-settings"}>
          {busyAction === "save-settings" ? "Saving..." : "Save visibility"}
        </button>
      </section>

      <section className="social-card">
        <p className="settings-section-title">Friends activity feed</p>
        <p className="settings-section-copy">
          How far back the overlay&apos;s feed of things your friends got done looks.
        </p>
        <div className="social-visibility-grid">
          <label className="social-visibility-row">
            <span>Time window</span>
            <select
              value={String(feedWindowMinutes)}
              onChange={(event) => void onChangeFeedWindow(Number(event.target.value))}
            >
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="240">4 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </label>
        </div>
      </section>

      <section className="social-card">
        <p className="settings-section-title">Sync</p>
        <div className="social-sync-status">
          <span className="social-pill">Cloud: connected</span>
          <span className="social-pill">Sync: {syncLabel(status)}</span>
        </div>
        <p className="settings-section-copy">
          Your local app stays authoritative. Syncing pushes a snapshot of your shared data to the cloud.
        </p>
        <button type="button" onClick={() => void onSyncNow()} disabled={busyAction === "sync-now"}>
          {busyAction === "sync-now" ? "Syncing..." : "Sync now"}
        </button>
      </section>

      <section className="social-card social-card-danger">
        <p className="settings-section-title">Disconnect</p>
        <p className="settings-section-copy">
          Disconnect your cloud account. Your local data stays intact.
        </p>
        <button
          type="button"
          className="social-disconnect-btn"
          onClick={() => void onDisconnect()}
          disabled={busyAction === "disconnect"}
        >
          {busyAction === "disconnect" ? "Disconnecting..." : "Disconnect account"}
        </button>
      </section>
    </div>
  );

  /* ── Connected: full layout ── */
  const connectedContent = (
    <>
      {friendsTabContent}

      {/* Settings overlay */}
      {showSettings && (
        <div className="social-settings-overlay-backdrop" role="presentation" onClick={closeSettings}>
          <div className="social-settings-overlay" onClick={(event) => event.stopPropagation()}>
            <div className="social-settings-overlay-header">
              <h3>Social Settings</h3>
              <button type="button" className="social-settings-close" onClick={closeSettings}>
                &times;
              </button>
            </div>
            {settingsTabContent}
          </div>
        </div>
      )}
    </>
  );

  const content = (
    <>
      {error && <p className="social-error">{error}</p>}
      {isLoading && <p className="settings-hint">Loading...</p>}

      {!status?.configured
        ? notConfiguredContent
        : !status.connected
          ? notConnectedContent
          : connectedContent}
    </>
  );

  if (embedded) {
    return <div className="social-inline-shell">{content}</div>;
  }

  return (
    <div className="todo-edit-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="todo-edit-modal social-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Social sync"
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
}
