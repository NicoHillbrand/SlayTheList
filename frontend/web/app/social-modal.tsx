"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CloudConnectionStatus,
  FriendRelationship,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  Prediction,
  SharedProfile,
  SocialSettings,
  SocialVisibility,
} from "@slaythelist/contracts";
import {
  acceptCloudFriendRequest,
  cancelCloudFriendRequest,
  declineCloudFriendRequest,
  disconnectCloudConnect,
  getCloudConnectionStatus,
  getCloudSharedProfile,
  getCloudSocialSettings,
  listCloudFriendRequests,
  listCloudFriends,
  pollCloudConnect,
  saveCloudSocialSettings,
  searchCloudSocialUsers,
  sendCloudFriendRequest,
  startCloudConnect,
  syncCloudSnapshot,
  updateCloudUsername,
} from "../lib/api";

type Props = {
  open?: boolean;
  onClose?: () => void;
  embedded?: boolean;
};

const DEFAULT_SETTINGS: SocialSettings = {
  habitsVisibility: "friends",
  predictionsVisibility: "friends",
  goldVisibility: "friends",
};

type SocialTab = "friends" | "settings";

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
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

export default function SocialModal({ open = false, onClose, embedded = false }: Props) {
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
  const [usernameDraft, setUsernameDraft] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SocialTab>("friends");

  const refreshConnectedData = useCallback(async (currentStatus?: CloudConnectionStatus | null) => {
    const nextStatus = currentStatus ?? (await getCloudConnectionStatus());
    const nextSettings = await getCloudSocialSettings();
    setStatus(nextStatus);
    setSettings(nextSettings);
    setUsernameDraft(nextStatus.user?.username ?? "");

    if (nextStatus.connected) {
      const [friendsResponse, requestsResponse] = await Promise.all([listCloudFriends(), listCloudFriendRequests()]);
      setFriends(friendsResponse.items);
      setIncomingRequests(requestsResponse.incoming);
      setOutgoingRequests(requestsResponse.outgoing);
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
      .catch((nextError) => {
        if (!cancelled) setError(toErrorMessage(nextError));
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
    setBusyAction(`profile:${selectedUsername}`);
    void getCloudSharedProfile(selectedUsername)
      .then((profile) => {
        if (!cancelled) setSelectedProfile(profile);
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

  if (!embedded && !open) return null;

  const pendingRequestCount = incomingRequests.length;

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
            <div className="social-profile-top">
              <h4>@{selectedProfile.user.username}</h4>
              {selectedProfile.gold.canView && (
                <span className="social-gold-value">{selectedProfile.gold.state?.gold ?? 0} gold</span>
              )}
            </div>

            <section className="social-profile-section">
              <h5>Habits</h5>
              {!selectedProfile.habits.canView ? (
                <p className="settings-hint">Hidden</p>
              ) : selectedProfile.habits.items.length === 0 ? (
                <p className="settings-hint">No habits shared yet.</p>
              ) : (
                <ul className="social-profile-list">
                  {selectedProfile.habits.items.map((habit) => (
                    <li key={habit.id}>
                      {habit.name} <span className="settings-hint">({habit.status})</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="social-profile-section">
              <h5>Predictions <span className="settings-hint">(last 7 days)</span></h5>
              {!selectedProfile.predictions.canView ? (
                <p className="settings-hint">Hidden</p>
              ) : (() => {
                const days = recentPredictionsByDay(selectedProfile.predictions.items);
                if (days.length === 0) return <p className="settings-hint">No predictions in the last week.</p>;
                const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayLabel = yesterday.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                const recentLabels = new Set([todayLabel, yesterdayLabel]);
                const todayDays = days.filter((d) => recentLabels.has(d.label));
                const pastDays = days.filter((d) => !recentLabels.has(d.label));

                const renderDayItems = (day: { label: string; items: Prediction[] }) => (
                  <div key={day.label} className="social-predictions-day">
                    <p className="social-day-label">{day.label}</p>
                    <div className="social-predictions-day-items">
                      {day.items.map((prediction) => (
                        <div key={prediction.id} className="social-prediction-row">
                          <span className={outcomeClass(prediction.outcome)}>{outcomeIcon(prediction.outcome)}</span>
                          <span className="social-prediction-title">{prediction.title}</span>
                          <span className="social-prediction-confidence">{prediction.confidence}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );

                return (
                  <div className="social-predictions-timeline">
                    {todayDays.map(renderDayItems)}
                    {pastDays.length > 0 && (
                      <details className="social-predictions-past">
                        <summary className="social-day-label">Previous days</summary>
                        {pastDays.map(renderDayItems)}
                      </details>
                    )}
                  </div>
                );
              })()}
            </section>

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

        {/* Friends list */}
        <div className="social-friends-list">
          <p className="social-section-label">Friends</p>
          {friends.length === 0 ? (
            <p className="settings-hint">No friends yet. Search above to add someone.</p>
          ) : (
            friends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                className={`social-friend-item ${selectedUsername === friend.username ? "active" : ""}`}
                onClick={() => setSelectedUsername(friend.username)}
              >
                @{friend.username}
              </button>
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
        </div>
        <button type="button" onClick={() => void onSaveSettings()} disabled={busyAction === "save-settings"}>
          {busyAction === "save-settings" ? "Saving..." : "Save visibility"}
        </button>
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
      {/* Sub-tabs */}
      <div className="social-subtabs">
        <button
          type="button"
          className={`social-subtab ${activeTab === "friends" ? "active" : ""}`}
          onClick={() => setActiveTab("friends")}
        >
          Friends{pendingRequestCount > 0 && <span className="social-badge">{pendingRequestCount}</span>}
        </button>
        <button
          type="button"
          className={`social-subtab ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "friends" ? friendsTabContent : settingsTabContent}
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
