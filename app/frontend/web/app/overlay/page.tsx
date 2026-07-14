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
import type { FriendTodaySummary, SharedStatus, StatusChip } from "@slaythelist/contracts";
import {
  getCloudFriendsSummary,
  getGoldState,
  getSocialStatus,
  listGoldActivity,
  saveSocialStatus,
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

function FriendCard({ friend }: { friend: FriendTodaySummary }) {
  const entries = friend.today?.entries.filter((e) => e.label !== null).slice(0, 4) ?? [];
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid #1e1e3a" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>@{friend.user.username}</span>
        {friend.base && (
          <span style={{ fontSize: 10, color: "#f5c542" }}>
            ⚔ T{friend.base.tier}
            {friend.base.bestTier > friend.base.tier ? `/${friend.base.bestTier}` : ""}
          </span>
        )}
        {friend.today && friend.today.total !== 0 && (
          <span style={{ fontSize: 10, color: "#f5c542", display: "inline-flex", alignItems: "center", gap: 2 }}>
            <CoinIcon size={10} />
            {friend.today.total > 0 ? `+${friend.today.total}` : friend.today.total} today
          </span>
        )}
        {friend.status?.chips.map((chip) => <StatusChipPill key={chip.id} chip={chip} />)}
      </div>
      {friend.today ? (
        entries.length > 0 ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "#b8b8d0" }}>
            {entries.map((entry, i) => (
              <li key={i}>{entry.label}</li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 11, color: "#6a6a88", marginTop: 2 }}>Quiet so far today.</div>
        )
      ) : null}
    </div>
  );
}

function FriendsPanel() {
  const [friends, setFriends] = useState<FriendTodaySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const result = await getCloudFriendsSummary(localToday());
        if (!cancelled) {
          setFriends(result.items);
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

  return (
    <div style={{ marginTop: 8 }}>
      <OwnStatusEditor />
      {error && <div style={{ fontSize: 11, color: "#e46a6a" }}>Cloud unavailable: {error}</div>}
      {!error && friends === null && <div style={{ fontSize: 11, color: "#8a89a6" }}>Loading friends…</div>}
      {friends !== null && friends.length === 0 && (
        <div style={{ fontSize: 11, color: "#8a89a6" }}>No friends yet — add some in the social tab.</div>
      )}
      {friends?.map((friend) => <FriendCard key={friend.user.id} friend={friend} />)}
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
