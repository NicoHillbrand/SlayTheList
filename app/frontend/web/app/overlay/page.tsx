"use client";

/**
 * Overlay panels rendered inside the desktop overlay agent's WebView2 windows.
 * The desktop bar is now a native pill (Base/Friends buttons); each button opens
 * this route with ?panel=base|friends to show just that panel in its own window.
 * With no ?panel (direct browser view) it falls back to the original full bar
 * (gold + buttons). Reports its content height to the C# host via
 * window.chrome.webview.postMessage so the host window hugs the content.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedHeart, FriendFeedItem, FriendTodaySummary, SharedStatus, StatusChip } from "@slaythelist/contracts";
import {
  FEED_WINDOW_SETTING_KEY,
  getAppSetting,
  getCloudFriendsFeed,
  getCloudFriendsSummary,
  getFeedHeartsReceived,
  getGoldState,
  getSocialStatus,
  listGoldActivity,
  removeFeedHeart,
  saveSocialStatus,
  sendFeedHeart,
} from "../../lib/api";
import { CoinIcon } from "../../lib/combat/icons";
import { BaseOverlayMini } from "../base/OverlayMini";
import styles from "../base/base.module.css";

const GOLD_POLL_MS = 30_000;
const FRIENDS_POLL_MS = 60_000;

/** Preset chips — energy is mutually exclusive (energy: prefix), the rest toggle. */
const STATUS_PRESETS: StatusChip[] = [
  { id: "energy:high", label: "⚡ High energy", color: "#34d399" },
  { id: "energy:okay", label: "🙂 Doing okay", color: "#fbbf24" },
  { id: "energy:low", label: "🪫 Low energy", color: "#f87171" },
  { id: "avail:call", label: "📞 Up for a short call", color: "#60a5fa" },
  { id: "avail:cowork", label: "🤝 Co-work with me", color: "#a78bfa" },
  { id: "avail:focus", label: "🎯 Deep focus", color: "#94a3b8" },
];

const CUSTOM_COLORS = ["#34d399", "#fbbf24", "#f87171", "#60a5fa", "#a78bfa", "#f472b6"];

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type WebViewHost = { chrome?: { webview?: { postMessage: (message: unknown) => void } } };

function StatusChipPill({ chip, active, onClick }: { chip: StatusChip; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        font: "inherit",
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        cursor: onClick ? "pointer" : "default",
        border: `1px solid ${chip.color}`,
        background: active === false ? "transparent" : `${chip.color}26`,
        color: chip.color,
        opacity: active === false ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {chip.label}
    </button>
  );
}

function OwnStatusEditor() {
  const [status, setStatus] = useState<SharedStatus | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customColor, setCustomColor] = useState(CUSTOM_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSocialStatus().then(setStatus).catch(() => setStatus({ chips: [], updatedAt: "" }));
  }, []);

  const save = useCallback(async (chips: StatusChip[]) => {
    setStatus((prev) => ({ chips, updatedAt: prev?.updatedAt ?? "" }));
    setError(null);
    try {
      setStatus(await saveSocialStatus(chips));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to save status");
    }
  }, []);

  if (!status) return null;
  const chips = status.chips;

  function togglePreset(preset: StatusChip) {
    const has = chips.some((c) => c.id === preset.id);
    let next = chips.filter((c) => c.id !== preset.id);
    if (!has) {
      // Energy levels are one-of — picking one clears the others.
      if (preset.id.startsWith("energy:")) {
        next = next.filter((c) => !c.id.startsWith("energy:"));
      }
      next = [...next, preset];
    }
    void save(next);
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label || chips.length >= 8) return;
    setCustomLabel("");
    void save([...chips, { id: `custom:${crypto.randomUUID()}`, label: label.slice(0, 40), color: customColor }]);
  }

  return (
    <div style={{ borderBottom: "1px solid #2a2a4a", paddingBottom: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#8a89a6", marginBottom: 4 }}>Your status — friends see these</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {STATUS_PRESETS.map((preset) => (
          <StatusChipPill
            key={preset.id}
            chip={preset}
            active={chips.some((c) => c.id === preset.id)}
            onClick={() => togglePreset(preset)}
          />
        ))}
        {chips
          .filter((c) => c.id.startsWith("custom:"))
          .map((chip) => (
            <StatusChipPill key={chip.id} chip={chip} active onClick={() => void save(chips.filter((c) => c.id !== chip.id))} />
          ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <input
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="Custom status…"
          style={{
            font: "inherit",
            fontSize: 11,
            flex: 1,
            minWidth: 0,
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid #2a2a4a",
            background: "#12121f",
            color: "#e5e7eb",
          }}
        />
        {CUSTOM_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setCustomColor(color)}
            aria-label={`color ${color}`}
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: color,
              border: customColor === color ? "2px solid #e5e7eb" : "2px solid transparent",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
        <button
          type="button"
          onClick={addCustom}
          style={{
            font: "inherit",
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 6,
            border: "1px solid #3a3a5a",
            background: "#1e1e3a",
            color: "#ccc",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>
      {error && <div style={{ fontSize: 10, color: "#e46a6a", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

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

/** One friend per line: name, base tier, status chips. The doing-things part
 *  lives in the activity feed below. */
function FriendStatusRow({ friend }: { friend: FriendTodaySummary }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>@{friend.user.username}</span>
      {friend.base && (
        <span style={{ fontSize: 10, color: "#f5c542" }}>
          ⚔ T{friend.base.tier}
          {friend.base.bestTier > friend.base.tier ? `/${friend.base.bestTier}` : ""}
        </span>
      )}
      {friend.status?.chips.map((chip) => <StatusChipPill key={chip.id} chip={chip} />)}
    </div>
  );
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
  const [friends, setFriends] = useState<FriendTodaySummary[] | null>(null);
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
        const [summary, feedResult, heartsResult] = await Promise.all([
          getCloudFriendsSummary(localToday()),
          getCloudFriendsFeed(since),
          getFeedHeartsReceived(since),
        ]);
        if (!cancelled) {
          setWindowMinutes(minutes);
          setFriends(summary.items);
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

  const friendsWithStatus = friends?.filter((f) => (f.status?.chips.length ?? 0) > 0 || f.base) ?? [];

  return (
    <div style={{ marginTop: 8 }}>
      <OwnStatusEditor />
      {error && <div style={{ fontSize: 11, color: "#e46a6a" }}>Cloud unavailable: {error}</div>}
      {!error && friends === null && <div style={{ fontSize: 11, color: "#8a89a6" }}>Loading friends…</div>}
      {friends !== null && friends.length === 0 && (
        <div style={{ fontSize: 11, color: "#8a89a6" }}>No friends yet — add some in the social tab.</div>
      )}

      {friendsWithStatus.length > 0 && (
        <div style={{ borderBottom: "1px solid #2a2a4a", paddingBottom: 6, marginBottom: 6 }}>
          {friendsWithStatus.map((friend) => (
            <FriendStatusRow key={friend.user.id} friend={friend} />
          ))}
        </div>
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

      {friends !== null && friends.length > 0 && (
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

export default function OverlayTaskbarPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"none" | "base" | "friends">("none");
  const [gold, setGold] = useState<number | null>(null);
  const [goldToday, setGoldToday] = useState(0);
  // The desktop bar hosts each panel in its own window via ?panel=base|friends.
  // `undefined` = not yet read (first client render); `null` = no param (browser).
  const [panelParam, setPanelParam] = useState<"base" | "friends" | null | undefined>(undefined);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("panel");
    setPanelParam(value === "base" || value === "friends" ? value : null);
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
      {/* Desktop bar: a single panel per window. */}
      {panelParam === "base" && <BaseOverlayMini />}
      {panelParam === "friends" && <FriendsPanel />}

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
