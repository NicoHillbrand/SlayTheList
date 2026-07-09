"use client";

import { useEffect, useRef } from "react";
import type { BaseSnapshot } from "@slaythelist/contracts";
import type { BaseScene } from "./BaseScene";

interface PhaserGameProps {
  onSceneReady?: (scene: BaseScene) => void;
  /** Render in read-only mode — disables shop, placement, save calls. */
  readOnly?: boolean;
  /** Snapshot to render in read-only mode (replaces the local API fetch). */
  externalSnapshot?: BaseSnapshot | null;
  /** Optional HUD label shown when read-only (e.g. "@alice's base"). */
  viewerLabel?: string;
}

export default function PhaserGame({
  onSceneReady,
  readOnly = false,
  externalSnapshot = null,
  viewerLabel,
}: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const onSceneReadyRef = useRef(onSceneReady);
  onSceneReadyRef.current = onSceneReady;

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    let destroyed = false;

    const init = async () => {
      const Phaser = (await import("phaser")).default;
      const { BaseScene } = await import("./BaseScene");

      if (destroyed) return;

      // Create scene instance so we can attach the callback before create() runs
      const sceneInstance = new BaseScene();
      // Configure read-only / external state BEFORE create() runs.
      sceneInstance.readOnly = readOnly;
      sceneInstance.externalSnapshot = externalSnapshot;
      sceneInstance.viewerLabel = viewerLabel ?? null;
      sceneInstance.onReady = () => {
        if (!destroyed) {
          onSceneReadyRef.current?.(sceneInstance);
        }
      };

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current!,
        width: containerRef.current!.clientWidth,
        height: containerRef.current!.clientHeight,
        backgroundColor: "#1a1a2e",
        scene: sceneInstance,
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        input: {
          mouse: {
            preventDefaultWheel: true,
          },
        },
      });

      gameRef.current = game;
    };

    init();

    return () => {
      destroyed = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // The Phaser scene reads readOnly/externalSnapshot/viewerLabel once, before
    // create() runs. Re-running this effect would tear down and recreate the
    // game, so we deliberately keep the dependency array empty — callers
    // should remount the component to switch modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "400px" }}
    />
  );
}
