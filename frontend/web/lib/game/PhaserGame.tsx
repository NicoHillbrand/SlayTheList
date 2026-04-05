"use client";

import { useEffect, useRef } from "react";
import type { BaseScene } from "./BaseScene";

interface PhaserGameProps {
  onSceneReady?: (scene: BaseScene) => void;
}

export default function PhaserGame({ onSceneReady }: PhaserGameProps) {
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
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "400px" }}
    />
  );
}
