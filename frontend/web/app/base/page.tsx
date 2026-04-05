"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { CATALOG, type CatalogItem } from "../../lib/game/catalog";
import type { BaseScene } from "../../lib/game/BaseScene";

const PhaserGame = dynamic(() => import("../../lib/game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
      Loading game...
    </div>
  ),
});

type ShopTab = "building" | "decoration" | "terrain";

const CURRENCY_COLORS: Record<string, string> = {
  gold: "#ffd700",
  diamonds: "#b9f2ff",
  emeralds: "#50c878",
};

function playPurchaseSound() {
  const audio = new Audio("/sfx/gold-sack.wav");
  audio.volume = 0.72;
  audio.currentTime = 0.22;
  audio.play().catch(() => {});
  setTimeout(() => { audio.pause(); audio.currentTime = 0; }, 1450);
}

export default function BasePage() {
  const [scene, setScene] = useState<BaseScene | null>(null);
  const [activeTab, setActiveTab] = useState<ShopTab>("building");
  const [shopOpen, setShopOpen] = useState(true);
  const [, setRenderTick] = useState(0);

  const handleSceneReady = useCallback((s: BaseScene) => {
    s.onStateChange = () => setRenderTick((t) => t + 1);
    s.onPurchaseSound = playPurchaseSound;
    setScene(s);
  }, []);

  const progression = scene?.getProgression() ?? null;
  const inventory = scene?.getInventory() ?? {};

  const filteredItems = CATALOG.filter((item) => item.category === activeTab);

  function canAfford(item: CatalogItem): boolean {
    if (!progression) return false;
    const balance = item.currency === "diamonds" ? progression.diamonds
      : item.currency === "emeralds" ? progression.emeralds
      : progression.gold;
    return balance >= item.cost;
  }

  function meetsRequirement(item: CatalogItem): boolean {
    if (!item.unlockRequirement) return true;
    if (!progression) return false;
    return (progression[item.unlockRequirement.stat] ?? 0) >= item.unlockRequirement.value;
  }

  async function handleBuy(item: CatalogItem) {
    if (!scene) return;
    await scene.buyItem(item.id, item.cost, item.currency);
  }

  function handlePlace(item: CatalogItem) {
    scene?.startPlacement(item.id);
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0e0e1a", color: "#e0e0e0", fontFamily: "system-ui, sans-serif" }}>
      {/* Game canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <PhaserGame onSceneReady={handleSceneReady} />
        </div>
        <button
          onClick={() => window.location.href = "/"}
          style={{
            position: "absolute", top: 16, left: 16, padding: "6px 14px",
            background: "#2a2a4a", color: "#ccc", border: "1px solid #444",
            borderRadius: 6, cursor: "pointer", fontSize: 14, zIndex: 20,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <span style={{ fontSize: 18 }}>&larr;</span> Back
        </button>
        {!shopOpen && (
          <button
            onClick={() => setShopOpen(true)}
            style={{
              position: "absolute", top: 16, right: 16, padding: "8px 16px",
              background: "#2a2a4a", color: "#ffd700", border: "1px solid #444",
              borderRadius: 6, cursor: "pointer", fontSize: 14, zIndex: 20,
            }}
          >
            Shop
          </button>
        )}
      </div>

      {/* Shop sidebar */}
      {shopOpen && (
        <div style={{
          width: 280, background: "#16162a", borderLeft: "1px solid #333",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #333", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "#ffd700" }}>Shop</h2>
            <button
              onClick={() => setShopOpen(false)}
              style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18 }}
            >
              x
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #333" }}>
            {(["building", "decoration", "terrain"] as ShopTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: "8px 4px", background: activeTab === tab ? "#2a2a4a" : "transparent",
                  color: activeTab === tab ? "#ffd700" : "#888", border: "none",
                  borderBottom: activeTab === tab ? "2px solid #ffd700" : "2px solid transparent",
                  cursor: "pointer", fontSize: 12, textTransform: "capitalize",
                }}
              >
                {tab}s
              </button>
            ))}
          </div>

          {/* Items list */}
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {filteredItems.map((item) => {
              const meetsReq = meetsRequirement(item);
              const affordable = canAfford(item);
              const stock = inventory[item.id] ?? 0;

              return (
                <div
                  key={item.id}
                  style={{
                    padding: "10px 12px", marginBottom: 6, borderRadius: 6,
                    background: "#1e1e3a", border: "1px solid #333",
                    opacity: meetsReq ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 4,
                      background: item.color, flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {item.name}
                        {stock > 0 && <span style={{ color: "#88ff88", fontWeight: 400, marginLeft: 6 }}>x{stock}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {item.footprint[0]}x{item.footprint[1]}
                        {item.cost > 0 && (
                          <> {"\u2022"} <span style={{ color: CURRENCY_COLORS[item.currency] ?? "#888" }}>{item.cost} {item.currency}</span></>
                        )}
                      </div>
                    </div>
                  </div>

                  {!meetsReq && item.unlockRequirement && (
                    <div style={{ fontSize: 11, color: "#ff6b6b", marginBottom: 4 }}>
                      Requires: {item.unlockRequirement.stat.replace(/([A-Z])/g, " $1").toLowerCase()} {">="} {item.unlockRequirement.value}
                    </div>
                  )}

                  {meetsReq && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleBuy(item)}
                      disabled={!affordable}
                      style={{
                        flex: 1, padding: "6px 0",
                        background: affordable ? "#5a4a2d" : "#333",
                        color: affordable ? (CURRENCY_COLORS[item.currency] ?? "#ffd700") : "#666",
                        border: `1px solid ${affordable ? "#7a6a3a" : "#444"}`,
                        borderRadius: 4, cursor: affordable ? "pointer" : "not-allowed", fontSize: 12,
                      }}
                    >
                      {item.cost === 0 ? "Get (free)" : `Buy (${item.cost} ${item.currency})`}
                    </button>
                    {stock > 0 && (
                      <button
                        onClick={() => handlePlace(item)}
                        style={{
                          flex: 1, padding: "6px 0", background: "#2d5a2d", color: "#88ff88",
                          border: "1px solid #3a7a3a", borderRadius: 4, cursor: "pointer", fontSize: 12,
                        }}
                      >
                        Place
                      </button>
                    )}
                  </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Stats footer */}
          {progression && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid #333", fontSize: 11, color: "#666" }}>
              <div>Todos completed: {progression.totalTodosCompleted}</div>
              <div>Day streak: {progression.currentDayStreak}</div>
              <div>Habit checks: {progression.totalHabitChecks}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
