"use client";

/**
 * Overlay panels rendered inside the desktop overlay agent's WebView2 windows.
 * The desktop bar is a native pill (Base/Friends buttons); each button opens
 * this route with ?panel=base|friends to show just that panel in its own window.
 *
 * ?panel=crawl is served the same way but is NOT part of that bar: the Crawl is
 * a standalone always-on-top window with its own hotkey, its own drag grip, and
 * its own remembered position, so it is deliberately absent from the buttons
 * below. Reach it with the hotkey, or /crawl in a browser.
 *
 * With no ?panel (direct browser view) this falls back to the original full bar
 * (gold + buttons). Reports its content height to the C# host via
 * window.chrome.webview.postMessage so the host window hugs the content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrentStep, FeedHeart, FriendFeedItem } from "@slaythelist/contracts";
import { currentStepAge } from "@slaythelist/contracts";
import {
  FEED_WINDOW_SETTING_KEY,
  getAppSetting,
  getCloudFriendsFeed,
  getFeedHeartsReceived,
  getGoldState,
  listCloudFriends,
  listGoldActivity,
  overlayWebSocketUrl,
  removeFeedHeart,
  sendFeedHeart,
} from "../../lib/api";
import { CoinIcon } from "../../lib/combat/icons";
import { CrawlView } from "../../lib/crawl/CrawlView";
import { BaseOverlayMini } from "../base/OverlayMini";
import styles from "../base/base.module.css";

const GOLD_POLL_MS = 30_000;
const FRIENDS_POLL_MS = 60_000;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type WebViewHost = { chrome?: { webview?: { postMessage: (message: unknown) => void } } };

const FEED_WINDOW_DEFAULT_MINUTES = 60;

function feedWindowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return minutes === 60 ? "hour" : `${minutes / 60} h`;
  return `${(minutes / 60).toFixed(1)} h`;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function FeedRow({ item, onToggleHeart }: { item: FriendFeedItem; onToggleHeart: (item: FriendFeedItem) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "4px 0", borderBottom: "1px solid #1e1e3a" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#e5e7eb", whiteSpace: "nowrap" }}>
        @{item.user.username}
      </span>
      <span style={{ fontSize: 11, color: "#b8b8d0", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.label}
      </span>
      <span style={{ fontSize: 10, color: "#f5c542", display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
        <CoinIcon size={9} />+{item.delta}
      </span>
      <span style={{ fontSize: 10, color: "#6a6a88", whiteSpace: "nowrap" }}>{timeAgo(item.createdAt)}</span>
      <button
        type="button"
        onClick={() => onToggleHeart(item)}
        title={item.heartedByMe ? "Un-heart" : "Send a heart"}
        style={{
          font: "inherit",
          fontSize: 11,
          lineHeight: 1,
          padding: "2px 4px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: item.heartedByMe ? "#f472b6" : "#5a5a78",
          whiteSpace: "nowrap",
        }}
      >
        {item.heartedByMe ? "❤" : "♡"}
        {item.hearts > 0 ? ` ${item.hearts}` : ""}
      </button>
    </div>
  );
}

function FriendsPanel() {
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [feed, setFeed] = useState<FriendFeedItem[] | null>(null);
  const [heartsReceived, setHeartsReceived] = useState<FeedHeart[]>([]);
  const [windowMinutes, setWindowMinutes] = useState(FEED_WINDOW_DEFAULT_MINUTES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        // Re-read the window each poll so a settings change lands without a
        // reload (the overlay window has no other channel to the settings UI).
        let minutes = FEED_WINDOW_DEFAULT_MINUTES;
        try {
          const setting = await getAppSetting(FEED_WINDOW_SETTING_KEY);
          const parsed = Number(setting.value);
          if (Number.isFinite(parsed) && parsed > 0) minutes = Math.round(parsed);
        } catch {
          // Settings are cosmetic here — fall back to the default window.
        }
        const since = new Date(Date.now() - minutes * 60_000).toISOString();
        // The friends list only distinguishes "no friends yet" from "friends
        // but a quiet feed" — the panel renders the feed, not the friends.
        const [friendsResult, feedResult, heartsResult] = await Promise.all([
          listCloudFriends(),
          getCloudFriendsFeed(since),
          getFeedHeartsReceived(since),
        ]);
        if (!cancelled) {
          setWindowMinutes(minutes);
          setFriendCount(friendsResult.items.length);
          setFeed(feedResult.items);
          setHeartsReceived(heartsResult.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load friends");
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), FRIENDS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggleHeart = useCallback((item: FriendFeedItem) => {
    const next = !item.heartedByMe;
    const patch = (flip: boolean) => (current: FriendFeedItem[] | null) =>
      current?.map((f) =>
        f.entryId === item.entryId
          ? { ...f, heartedByMe: flip, hearts: Math.max(0, f.hearts + (flip ? 1 : -1)) }
          : f,
      ) ?? current;
    setFeed(patch(next));
    void (next ? sendFeedHeart(item.user.id, item.entryId) : removeFeedHeart(item.entryId)).catch(() => {
      setFeed(patch(!next));
    });
  }, []);

  return (
    <div style={{ marginTop: 8 }}>
      {error && <div style={{ fontSize: 11, color: "#e46a6a" }}>Cloud unavailable: {error}</div>}
      {!error && friendCount === null && <div style={{ fontSize: 11, color: "#8a89a6" }}>Loading friends…</div>}
      {friendCount === 0 && (
        <div style={{ fontSize: 11, color: "#8a89a6" }}>No friends yet — add some in the social tab.</div>
      )}

      {heartsReceived.length > 0 && (
        <div style={{ borderBottom: "1px solid #2a2a4a", paddingBottom: 6, marginBottom: 6 }}>
          {heartsReceived.map((heart) => (
            <div key={heart.id} style={{ fontSize: 11, color: "#f472b6", padding: "2px 0" }}>
              ❤ @{heart.sender.username}{" "}
              <span style={{ color: "#b8b8d0" }}>loved “{heart.entryLabel}”</span>{" "}
              <span style={{ color: "#6a6a88" }}>· {timeAgo(heart.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {friendCount !== null && friendCount > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#8a89a6", marginBottom: 2 }}>
            Friends got done — last {feedWindowLabel(windowMinutes)}
          </div>
          {feed !== null && feed.length === 0 && (
            <div style={{ fontSize: 11, color: "#6a6a88" }}>Nothing in the last {feedWindowLabel(windowMinutes)}.</div>
          )}
          {feed?.map((item) => (
            <FeedRow key={item.entryId} item={item} onToggleHeart={toggleHeart} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The agent's "do this now" line.
 *
 * There is deliberately no dismiss control. A step the user can swat away says
 * nothing about whether the work happened, so retiring it belongs to the agent
 * that set it: `complete_current_step` (or the next step replacing it) is what
 * takes it off screen. The server withholds a completed step from this surface
 * entirely, so anything that arrives here is still outstanding.
 *
 * Ageing is the backstop for an agent that forgets: an instruction from three
 * hours ago is worse than none, so it dims and then stops rendering.
 */
function CurrentStepLine({ step }: { step: CurrentStep }) {
  // Recomputed on render, which the overlay-state push already triggers — no
  // timer here, nothing in the overlay is allowed to tick on its own.
  const age = currentStepAge(step.setAt, Date.now());
  if (age === "expired") return null;

  const dim = age === "stale";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        marginBottom: 8,
        minWidth: 0,
        padding: "7px 9px 7px 10px",
        borderRadius: 7,
        // A card, not a footnote: this is the instruction the panel exists to
        // carry, so it earns a surface and a gold edge. Same lightness step and
        // hairline ring as the enemy plate and the cards, so it belongs to the
        // same object family — and the same blue-black, since a violet tint here
        // made it the loudest block on screen by hue alone. No lift: it is the
        // one element up there that is never clicked.
        background: dim ? "#191930" : "linear-gradient(180deg, #1f1f36 0%, #1a1a2e 100%)",
        borderLeft: `2px solid ${dim ? "#4a4a68" : "#b8942f"}`,
        boxShadow: `inset 0 0 0 1px rgba(44,44,72,${dim ? 0.5 : 0.85})`,
        fontSize: 11,
        lineHeight: 1.4,
        color: dim ? "#6a6a88" : "#8a89a6",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            fontSize: 9,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: dim ? "#5a5a78" : "#b8942f",
          }}
        >
          {/* Once it is stale the age REPLACES the label rather than joining it:
              "Now · 1h ago" contradicts itself, and the age is the honest word. */}
          {dim ? <span style={{ letterSpacing: 0 }}>{timeAgo(step.setAt)} ago</span> : <span>Now</span>}
        </div>
        <div
          title={step.subtitle ? `${step.text}\n${step.subtitle}` : step.text}
          style={{
            marginTop: 1,
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: dim ? "#8a89a6" : "#e8e6f0",
          }}
        >
          {step.text}
        </div>
        {step.subtitle && (
          <div
            style={{
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {step.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OverlayTaskbarPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"none" | "base" | "friends">("none");
  const [gold, setGold] = useState<number | null>(null);
  const [goldToday, setGoldToday] = useState(0);
  const [currentStep, setCurrentStep] = useState<CurrentStep | null>(null);
  // The desktop bar hosts each panel in its own window via ?panel=base|friends|crawl.
  // `undefined` = not yet read (first client render); `null` = no param (browser).
  const [panelParam, setPanelParam] = useState<"base" | "friends" | "crawl" | null | undefined>(
    undefined,
  );
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("panel");
    setPanelParam(value === "base" || value === "friends" || value === "crawl" ? value : null);
  }, []);

  // Drop the app's background artwork on this route — see body.overlay-surface.
  // Without it the window's leftover pixels show the main app's image.
  useEffect(() => {
    document.body.classList.add("overlay-surface");
    return () => document.body.classList.remove("overlay-surface");
  }, []);

  // Keep the hosting window sized to the content.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const post = () => {
      const host = window as unknown as WebViewHost;
      host.chrome?.webview?.postMessage({ type: "resize", height: Math.ceil(el.getBoundingClientRect().height) });
    };
    const observer = new ResizeObserver(post);
    observer.observe(el);
    post();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [state, activity] = await Promise.all([getGoldState(), listGoldActivity(1)]);
        if (cancelled) return;
        setGold(state.gold);
        const today = activity.days.find((d) => d.date === localToday());
        // Only count earnings toward "+N today", not spending.
        setGoldToday(today ? today.entries.reduce((sum, e) => sum + Math.max(0, e.delta), 0) : 0);
      } catch {
        // API not up yet — keep polling.
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), GOLD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // The current step arrives by push, never by poll: the API broadcasts overlay
  // state on every mutation AND immediately on connect, so this listener alone
  // covers both the first paint and every later change. `currentStep` is already
  // null in the payload when the user has the display switched off, so there is
  // nothing to check here.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;
    let backoffMs = 1000;

    function connect() {
      if (stopped) return;
      try {
        socket = new WebSocket(overlayWebSocketUrl());
      } catch {
        return; // Bad URL; nothing to retry against.
      }
      socket.onopen = () => {
        backoffMs = 1000;
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            payload?: { currentStep?: CurrentStep | null };
          };
          if (parsed.type === "overlay_state") {
            setCurrentStep(parsed.payload?.currentStep ?? null);
          }
        } catch {
          // Ignore non-JSON frames.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, 16_000);
          connect();
        }, backoffMs);
      };
    }
    connect();

    return () => {
      stopped = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socket?.close();
    };
  }, []);

  const barButton = (key: "base" | "friends", label: string) => (
    <button
      type="button"
      onClick={() => setPanel((prev) => (prev === key ? "none" : key))}
      style={{
        font: "inherit",
        fontSize: 12,
        padding: "3px 12px",
        borderRadius: 6,
        border: "1px solid " + (panel === key ? "#d4aa47" : "#3a3a5a"),
        background: panel === key ? "#2a2a4a" : "#1e1e3a",
        color: panel === key ? "#f5c542" : "#ccc",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label} {panel === key ? "▴" : "▾"}
    </button>
  );

  return (
    // minHeight: 0 overrides the module's 100vh so the reported height is the
    // actual content height (the host window hugs the content).
    <div ref={rootRef} className={styles.root} style={{ padding: 8, overflow: "hidden", minHeight: 0 }}>
      {/* Only on the surfaces that are open while working: the always-on-top
          crawl window and the browser bar. The base/friends windows are
          transient popups, and repeating the step in each one is the clutter
          this feature is most likely to die of. */}
      {currentStep !== null && (panelParam === "crawl" || panelParam === null) && (
        <CurrentStepLine step={currentStep} />
      )}

      {/* Desktop bar: a single panel per window. */}
      {panelParam === "base" && <BaseOverlayMini />}
      {panelParam === "friends" && <FriendsPanel />}
      {panelParam === "crawl" && <CrawlView compact />}

      {/* Direct browser view (no ?panel): the original full bar. */}
      {panelParam === null && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              title="Your gold — earned by real work"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "#f5c542" }}
            >
              <CoinIcon size={14} />
              {gold === null ? "—" : gold.toLocaleString()}
              {goldToday > 0 && (
                <span style={{ fontSize: 11, fontWeight: 500, color: "#7fd88f" }}>+{goldToday} today</span>
              )}
            </span>
            <span style={{ flex: 1 }} />
            {barButton("base", "Base")}
            {barButton("friends", "Friends")}
          </div>
          {panel === "base" && (
            <div style={{ marginTop: 8 }}>
              <BaseOverlayMini />
            </div>
          )}
          {panel === "friends" && <FriendsPanel />}
        </>
      )}
    </div>
  );
}
