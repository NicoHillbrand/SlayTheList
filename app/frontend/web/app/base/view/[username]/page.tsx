"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { BaseSnapshot, SharedProfile } from "@slaythelist/contracts";
import type { BaseScene } from "../../../../lib/game/BaseScene";
import { getCloudSharedProfile } from "../../../../lib/api";

const PhaserGame = dynamic(() => import("../../../../lib/game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
      Loading base...
    </div>
  ),
});

type LoadState =
  | { status: "loading" }
  | { status: "ready"; profile: SharedProfile; snapshot: BaseSnapshot }
  | { status: "hidden"; profile: SharedProfile }
  | { status: "unsynced"; profile: SharedProfile }
  | { status: "error"; message: string };

export default function ViewBasePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params?.username ?? "");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const handleSceneReady = useCallback((_scene: BaseScene) => {
    // No state subscription needed — read-only.
  }, []);

  useEffect(() => {
    if (!username) {
      setState({ status: "error", message: "missing username" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void getCloudSharedProfile(username)
      .then((profile) => {
        if (cancelled) return;
        // `base` may be absent if the cloud server is on an older build.
        if (!profile.base?.canView) {
          setState({ status: "hidden", profile });
          return;
        }
        // canView but no snapshot yet — friend hasn't synced base data after
        // the feature rolled out. Distinct from an empty-but-synced base.
        if (!profile.base.snapshot) {
          setState({ status: "unsynced", profile });
          return;
        }
        // Empty snapshots (no placements) are still "ready" — render the
        // empty grid rather than blocking with a message.
        setState({ status: "ready", profile, snapshot: profile.base.snapshot });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load base",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  function goBack() {
    // Prefer browser history so we land back on whatever opened the view
    // (typically the social modal). Fall back to home if there's no history.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0e0e1a", color: "#e0e0e0", fontFamily: "system-ui, sans-serif" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: "1px solid #333", background: "#16162a",
      }}>
        <button
          onClick={goBack}
          style={{
            padding: "6px 14px", background: "#2a2a4a", color: "#ccc", border: "1px solid #444",
            borderRadius: 6, cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <span style={{ fontSize: 18 }}>&larr;</span> Back
        </button>
        <h2 style={{ margin: 0, fontSize: 16, color: "#ffd700" }}>
          @{username}&apos;s base
        </h2>
        <span style={{
          marginLeft: "auto",
          fontSize: 12, color: "#888",
          padding: "3px 8px", borderRadius: 999, background: "#1e1e3a", border: "1px solid #333",
        }}>
          read-only
        </span>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        {state.status === "loading" && (
          <CenteredMessage>Loading @{username}&apos;s base...</CenteredMessage>
        )}
        {state.status === "hidden" && (
          <CenteredMessage>
            @{username} hasn&apos;t shared their base with you.
          </CenteredMessage>
        )}
        {state.status === "unsynced" && (
          <CenteredMessage>
            @{username} hasn&apos;t synced their base yet. Check back once they&apos;ve opened the app.
          </CenteredMessage>
        )}
        {state.status === "error" && (
          <CenteredMessage tone="error">{state.message}</CenteredMessage>
        )}
        {state.status === "ready" && (
          <div style={{ position: "absolute", inset: 0 }}>
            <PhaserGame
              onSceneReady={handleSceneReady}
              readOnly
              externalSnapshot={state.snapshot}
              viewerLabel={`@${username}'s base`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredMessage({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: tone === "error" ? "#ff8888" : "#888",
      fontSize: 14,
      textAlign: "center",
      padding: 24,
    }}>
      {children}
    </div>
  );
}
