"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  FriendRelationship,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  SessionUser,
  SharedProfile,
  SocialSettings,
  SocialVisibility,
} from "@slaythelist/contracts";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getCurrentUser,
  getSharedProfile,
  getSocialSettings,
  listFriendRequests,
  listFriends,
  saveSocialSettings,
  searchSocialUsers,
  sendFriendRequest,
  signIn,
  signOut,
  signUp,
} from "../lib/api";

type Props = {
  open?: boolean;
  onClose?: () => void;
  embedded?: boolean;
};

type AuthMode = "signin" | "signup";

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

export default function SocialModal({ open = false, onClose, embedded = false }: Props) {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<SocialSettings>(DEFAULT_SETTINGS);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<SharedProfile | null>(null);
  const [signinLogin, setSigninLogin] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuthenticatedState = useCallback(async () => {
    const [settingsResponse, friendsResponse, requestResponse] = await Promise.all([
      getSocialSettings(),
      listFriends(),
      listFriendRequests(),
    ]);
    setSettings(settingsResponse);
    setFriends(friendsResponse.items);
    setIncomingRequests(requestResponse.incoming);
    setOutgoingRequests(requestResponse.outgoing);
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    const me = await getCurrentUser();
    setCurrentUser(me.user);
    if (me.user) {
      await refreshAuthenticatedState();
    } else {
      setSettings(DEFAULT_SETTINGS);
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setSearchResults([]);
      setSelectedUsername(null);
      setSelectedProfile(null);
    }
  }, [refreshAuthenticatedState]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void refreshCurrentUser()
      .catch((nextError) => {
        if (!cancelled) setError(toErrorMessage(nextError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshCurrentUser]);

  useEffect(() => {
    if (!open || !currentUser) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchSocialUsers(query)
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
  }, [currentUser, open, searchQuery]);

  useEffect(() => {
    if (!open || !currentUser || !selectedUsername) {
      setSelectedProfile(null);
      return;
    }
    let cancelled = false;
    setBusyAction(`profile:${selectedUsername}`);
    void getSharedProfile(selectedUsername)
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
  }, [currentUser, open, selectedUsername]);

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

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withBusyAction("signin", async () => {
      await signIn({ login: signinLogin, password: signinPassword });
      setSigninPassword("");
      await refreshCurrentUser();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withBusyAction("signup", async () => {
      await signUp({ username: signupUsername, email: signupEmail, password: signupPassword });
      setSignupPassword("");
      await refreshCurrentUser();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSaveSettings() {
    await withBusyAction("save-settings", async () => {
      const saved = await saveSocialSettings(settings);
      setSettings(saved);
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSendFriendRequest(username: string) {
    await withBusyAction(`request:${username}`, async () => {
      await sendFriendRequest(username);
      await refreshAuthenticatedState();
      if (searchQuery.trim()) {
        const results = await searchSocialUsers(searchQuery.trim());
        setSearchResults(results.items);
      }
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onAcceptRequest(requestId: string) {
    await withBusyAction(`accept:${requestId}`, async () => {
      await acceptFriendRequest(requestId);
      await refreshAuthenticatedState();
      if (selectedUsername) {
        setSelectedUsername(selectedUsername);
      }
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onDeclineRequest(requestId: string) {
    await withBusyAction(`decline:${requestId}`, async () => {
      await declineFriendRequest(requestId);
      await refreshAuthenticatedState();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onCancelRequest(requestId: string) {
    await withBusyAction(`cancel:${requestId}`, async () => {
      await cancelFriendRequest(requestId);
      await refreshAuthenticatedState();
      if (searchQuery.trim()) {
        const results = await searchSocialUsers(searchQuery.trim());
        setSearchResults(results.items);
      }
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  async function onSignOut() {
    await withBusyAction("signout", async () => {
      await signOut();
      await refreshCurrentUser();
    }).catch((nextError) => setError(toErrorMessage(nextError)));
  }

  if (!embedded && !open) return null;

  const content = (
    <>
        <div className="social-modal-header">
          <div>
            <h3>Social sharing</h3>
            <p className="settings-section-copy">Friends can see the sections you choose, and you can browse theirs.</p>
          </div>
          {!embedded && onClose && (
            <button type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        {error && <p className="social-error">{error}</p>}
        {isLoading && <p className="settings-hint">Loading social data...</p>}

        {!currentUser ? (
          <div className="social-auth-grid">
            <section className="social-card">
              <div className="view-tabs">
                <button
                  type="button"
                  className={`view-tab ${authMode === "signin" ? "active" : ""}`}
                  onClick={() => setAuthMode("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`view-tab ${authMode === "signup" ? "active" : ""}`}
                  onClick={() => setAuthMode("signup")}
                >
                  Create account
                </button>
              </div>

              {authMode === "signin" ? (
                <form className="social-form" onSubmit={onSignIn}>
                  <label>
                    Username or email
                    <input value={signinLogin} onChange={(event) => setSigninLogin(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={signinPassword}
                      onChange={(event) => setSigninPassword(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={busyAction === "signin"}>
                    {busyAction === "signin" ? "Signing in..." : "Sign in"}
                  </button>
                </form>
              ) : (
                <form className="social-form" onSubmit={onSignUp}>
                  <label>
                    Username
                    <input value={signupUsername} onChange={(event) => setSignupUsername(event.target.value)} />
                  </label>
                  <label>
                    Email
                    <input value={signupEmail} onChange={(event) => setSignupEmail(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={signupPassword}
                      onChange={(event) => setSignupPassword(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={busyAction === "signup"}>
                    {busyAction === "signup" ? "Creating..." : "Create account"}
                  </button>
                </form>
              )}
            </section>
            <section className="social-card">
              <p className="settings-section-title">What you get</p>
              <ul className="social-list">
                <li>Search for other users by username.</li>
                <li>Send and accept friend requests.</li>
                <li>Set habits, predictions, and gold to private, friends, or public.</li>
                <li>Open a friend profile to compare shared progress.</li>
              </ul>
            </section>
          </div>
        ) : (
          <div className="social-layout">
            <aside className="social-sidebar">
              <section className="social-card">
                <div className="social-account-row">
                  <div>
                    <p className="settings-section-title">@{currentUser.username}</p>
                    <p className="settings-section-copy">{currentUser.email}</p>
                  </div>
                  <button type="button" onClick={() => void onSignOut()} disabled={busyAction === "signout"}>
                    {busyAction === "signout" ? "Signing out..." : "Sign out"}
                  </button>
                </div>
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
                  <p className="settings-section-copy">Pick a friend or search result to see shared habits, predictions, and gold.</p>
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
        aria-label="Social sharing"
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
}
