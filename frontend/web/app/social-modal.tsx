"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CloudConnectionStatus,
  FriendRelationship,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
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

  const content = (
    <>
      <div className="social-modal-header">
        <div>
          <h3>Social sync</h3>
          <p className="settings-section-copy">
            Your local app stays authoritative. When connected, it syncs a shareable copy of habits, predictions, and gold to the cloud.
          </p>
        </div>
        {!embedded && onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {error && <p className="social-error">{error}</p>}
      {isLoading && <p className="settings-hint">Loading social sync...</p>}

      {!status?.configured ? (
        <section className="social-card">
          <p className="settings-section-title">Cloud service not configured</p>
          <p className="settings-section-copy">
            Set `CLOUD_SOCIAL_BASE_URL` on the local API to point at your VPS or a local cloud-social dev server.
          </p>
        </section>
      ) : !status.connected ? (
        <div className="social-auth-grid">
          <section className="social-card">
            <p className="settings-section-title">Connect your account</p>
            <p className="settings-section-copy">
              Connect your account with Google. The local app stays authoritative and syncs only the shared social snapshot to the cloud.
            </p>
            {!status.pendingAuth ? (
              <button type="button" onClick={() => void onStartConnect()} disabled={busyAction === "connect-start"}>
                {busyAction === "connect-start" ? "Starting..." : "Connect with Google"}
              </button>
            ) : (
              <div className="social-form">
                <p className="settings-section-copy">
                  Finish Google sign-in in the browser window. This page will keep checking automatically while the auth is pending.
                </p>
                <div className="social-inline-actions">
                  <a
                    className="social-link-button"
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
          </section>

          <section className="social-card">
            <p className="settings-section-title">Visibility snapshot</p>
            <div className="social-form">
              <label>
                Habits
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
              <label>
                Predictions
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
              <label>
                Gold
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
              <button type="button" onClick={() => void onSaveSettings()} disabled={busyAction === "save-settings"}>
                {busyAction === "save-settings" ? "Saving..." : "Save visibility"}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="social-layout">
          <aside className="social-sidebar">
            <section className="social-card">
              <div className="social-account-row">
                <div>
                  <p className="settings-section-title">@{status.user?.username}</p>
                  <p className="settings-section-copy">{status.user?.email ?? "Cloud-connected account"}</p>
                </div>
                <button type="button" onClick={() => void onDisconnect()} disabled={busyAction === "disconnect"}>
                  {busyAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
              <div className="social-pill-group">
                <span className="social-pill">Cloud: connected</span>
                <span className="social-pill">Sync: {syncLabel(status)}</span>
              </div>
              <button type="button" onClick={() => void onSyncNow()} disabled={busyAction === "sync-now"}>
                {busyAction === "sync-now" ? "Syncing..." : "Sync now"}
              </button>
            </section>

            <section className="social-card">
              <p className="settings-section-title">Public username</p>
              <p className="settings-section-copy">
                This is the name other people search for and see on your shared profile.
              </p>
              <form className="social-form" onSubmit={onSaveUsername}>
                <label>
                  Username
                  <input value={usernameDraft} onChange={(event) => setUsernameDraft(event.target.value)} />
                </label>
                <button type="submit" disabled={busyAction === "save-username"}>
                  {busyAction === "save-username" ? "Saving..." : "Save username"}
                </button>
              </form>
            </section>

            <section className="social-card">
              <p className="settings-section-title">Visibility</p>
              <div className="social-form">
                <label>
                  Habits
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
                <label>
                  Predictions
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
                <label>
                  Gold
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
                <button type="button" onClick={() => void onSaveSettings()} disabled={busyAction === "save-settings"}>
                  {busyAction === "save-settings" ? "Saving..." : "Save visibility"}
                </button>
              </div>
            </section>

            <section className="social-card">
              <p className="settings-section-title">Find people</p>
              <label className="social-form">
                <span className="settings-section-copy">Search by username</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search users..."
                />
              </label>
              <div className="social-list">
                {searchResults.length === 0 ? (
                  <p className="settings-hint">Search to find people.</p>
                ) : (
                  searchResults.map((result) => {
                    const outgoingRequest = outgoingByUsername.get(result.user.username.toLowerCase());
                    const incomingRequest = incomingByUsername.get(result.user.username.toLowerCase());
                    return (
                      <div key={result.user.id} className="social-row">
                        <button
                          type="button"
                          className="social-link-button"
                          onClick={() => setSelectedUsername(result.user.username)}
                        >
                          @{result.user.username}
                        </button>
                        <span className="social-pill">{relationshipLabel(result.relationship)}</span>
                        {result.relationship === "none" && (
                          <button
                            type="button"
                            onClick={() => void onSendFriendRequest(result.user.username)}
                            disabled={busyAction === `request:${result.user.username}`}
                          >
                            {busyAction === `request:${result.user.username}` ? "Sending..." : "Add"}
                          </button>
                        )}
                        {result.relationship === "outgoing_request" && outgoingRequest && (
                          <button
                            type="button"
                            onClick={() => void onCancelRequest(outgoingRequest.id)}
                            disabled={busyAction === `cancel:${outgoingRequest.id}`}
                          >
                            Cancel
                          </button>
                        )}
                        {result.relationship === "incoming_request" && incomingRequest && (
                          <button
                            type="button"
                            onClick={() => void onAcceptRequest(incomingRequest.id)}
                            disabled={busyAction === `accept:${incomingRequest.id}`}
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="social-card">
              <p className="settings-section-title">Friend requests</p>
              <div className="social-list">
                {incomingRequests.length === 0 && outgoingRequests.length === 0 ? (
                  <p className="settings-hint">No pending requests.</p>
                ) : (
                  <>
                    {incomingRequests.map((request) => (
                      <div key={request.id} className="social-row">
                        <span>@{request.sender.username}</span>
                        <div className="social-inline-actions">
                          <button
                            type="button"
                            onClick={() => void onAcceptRequest(request.id)}
                            disabled={busyAction === `accept:${request.id}`}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeclineRequest(request.id)}
                            disabled={busyAction === `decline:${request.id}`}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                    {outgoingRequests.map((request) => (
                      <div key={request.id} className="social-row">
                        <span>@{request.receiver.username}</span>
                        <button
                          type="button"
                          onClick={() => void onCancelRequest(request.id)}
                          disabled={busyAction === `cancel:${request.id}`}
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

            <section className="social-card">
              <p className="settings-section-title">Friends</p>
              <div className="social-list">
                {friends.length === 0 ? (
                  <p className="settings-hint">No friends yet.</p>
                ) : (
                  friends.map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      className={`social-friend-button ${selectedUsername === friend.username ? "active" : ""}`}
                      onClick={() => setSelectedUsername(friend.username)}
                    >
                      @{friend.username}
                    </button>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="social-card social-profile-card">
            {!selectedUsername ? (
              <div className="social-empty-state">
                <p className="settings-section-title">Open a profile</p>
                <p className="settings-section-copy">Pick a friend or search result to see the latest cloud-synced habits, predictions, and gold.</p>
              </div>
            ) : busyAction === `profile:${selectedUsername}` && !selectedProfile ? (
              <p className="settings-hint">Loading @{selectedUsername}...</p>
            ) : !selectedProfile ? (
              <p className="settings-hint">Select a user to load their profile.</p>
            ) : (
              <div className="social-profile-grid">
                <div className="social-profile-header">
                  <div>
                    <h4>@{selectedProfile.user.username}</h4>
                    <p className="settings-section-copy">{relationshipLabel(selectedProfile.relationship)}</p>
                  </div>
                  <div className="social-pill-group">
                    <span className="social-pill">Habits: {selectedProfile.habits.visibility}</span>
                    <span className="social-pill">Predictions: {selectedProfile.predictions.visibility}</span>
                    <span className="social-pill">Gold: {selectedProfile.gold.visibility}</span>
                  </div>
                </div>

                <section className="social-profile-section">
                  <h5>Habits</h5>
                  {!selectedProfile.habits.canView ? (
                    <p className="settings-hint">This section is hidden.</p>
                  ) : selectedProfile.habits.items.length === 0 ? (
                    <p className="settings-hint">No habits shared yet.</p>
                  ) : (
                    <ul className="social-list">
                      {selectedProfile.habits.items.map((habit) => (
                        <li key={habit.id}>
                          {habit.name} <span className="settings-hint">({habit.status})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="social-profile-section">
                  <h5>Predictions</h5>
                  {!selectedProfile.predictions.canView ? (
                    <p className="settings-hint">This section is hidden.</p>
                  ) : selectedProfile.predictions.items.length === 0 ? (
                    <p className="settings-hint">No predictions shared yet.</p>
                  ) : (
                    <ul className="social-list">
                      {selectedProfile.predictions.items.map((prediction) => (
                        <li key={prediction.id}>
                          {prediction.title}{" "}
                          <span className="settings-hint">
                            ({prediction.confidence}% · {prediction.outcome})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="social-profile-section">
                  <h5>Gold</h5>
                  {!selectedProfile.gold.canView ? (
                    <p className="settings-hint">This section is hidden.</p>
                  ) : (
                    <p className="social-gold-value">{selectedProfile.gold.state?.gold ?? 0} gold</p>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      )}
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
