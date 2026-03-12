"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { LockZone, OverlayState, Todo } from "@slaythelist/contracts";
import {
  createTodo,
  createZone,
  deleteZone,
  getOverlayState,
  listTodos,
  listZones,
  overlayWebSocketUrl,
  setTodoStatus,
  setZoneRequirements,
  updateZone,
} from "../lib/api";

type LoadState = "idle" | "loading" | "error";
type ZoneRectKey = "x" | "y" | "width" | "height";
type DragState = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};
type MoveState = {
  zoneId: string;
  startPointerX: number;
  startPointerY: number;
  startZoneX: number;
  startZoneY: number;
};

const TEMPLATE_WIDTH = 1280;
const TEMPLATE_HEIGHT = 720;
const CANVAS_MAX_WIDTH = 720;

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unexpected error";
}

export default function Page() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [zones, setZones] = useState<LockZone[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null);
  const [title, setTitle] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [applyZonesToTestArea, setApplyZonesToTestArea] = useState(true);
  const [testClicks, setTestClicks] = useState(0);
  const templateRef = useRef<HTMLDivElement | null>(null);
  const templateHostRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoadState("loading");
    try {
      const [todoData, zoneData, overlayData] = await Promise.all([
        listTodos(),
        listZones(),
        getOverlayState(),
      ]);
      setTodos(todoData.items);
      setZones(zoneData.items);
      setOverlayState(overlayData);
      setLoadState("idle");
    } catch (err) {
      setLoadState("error");
      setError(toErrorMessage(err));
    }
  }

  async function runAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const ws = new WebSocket(overlayWebSocketUrl());
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: string };
        if (parsed.type === "overlay_state") {
          void refresh();
        }
      } catch {
        // ignore non-json payloads
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsCanvasFullscreen(document.fullscreenElement === templateHostRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete") return;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        return;
      }
      if (selectedZoneIds.length === 0) return;
      event.preventDefault();
      onDeleteSelectedZone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedZoneIds]);

  async function onCreateTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    void runAction(async () => {
      await createTodo(nextTitle);
      setTitle("");
      await refresh();
    });
  }

  async function onCreateZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = zoneName.trim();
    if (!nextName) return;
    void runAction(async () => {
      await createZone({ name: nextName });
      setZoneName("");
      await refresh();
    });
  }

  function toggleTodo(todo: Todo) {
    const next = todo.status === "done" ? "pending" : "done";
    void runAction(async () => {
      await setTodoStatus(todo.id, next);
      await refresh();
    });
  }

  function patchZone(zoneId: string, patch: Partial<LockZone>) {
    void runAction(async () => {
      await updateZone(zoneId, patch);
      await refresh();
    });
  }

  function toggleZoneRequirement(zoneId: string, todoId: string) {
    if (!overlayState) return;
    const current =
      overlayState.zones.find((zoneState) => zoneState.zone.id === zoneId)?.requiredTodoIds ?? [];
    const set = new Set(current);
    if (set.has(todoId)) {
      set.delete(todoId);
    } else {
      set.add(todoId);
    }
    void runAction(async () => {
      await setZoneRequirements(zoneId, [...set]);
      await refresh();
    });
  }

  function updateDraftZone(zoneId: string, key: "name" | ZoneRectKey, value: string | number) {
    setZones((prev) => prev.map((item) => (item.id === zoneId ? { ...item, [key]: value } : item)));
  }

  function commitZoneField(zoneId: string, key: "name" | ZoneRectKey) {
    const latest = zones.find((zone) => zone.id === zoneId);
    if (!latest) return;
    if (key === "name") {
      patchZone(zoneId, { name: latest.name.trim() || latest.name });
      return;
    }
    patchZone(zoneId, { [key]: latest[key] } as Partial<LockZone>);
  }

  function getRelativePointFromClient(clientX: number, clientY: number) {
    const rect = templateRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(TEMPLATE_WIDTH, Math.round(normalizedX * TEMPLATE_WIDTH))),
      y: Math.max(0, Math.min(TEMPLATE_HEIGHT, Math.round(normalizedY * TEMPLATE_HEIGHT))),
    };
  }

  function getRelativePoint(event: PointerEvent<HTMLDivElement>) {
    return getRelativePointFromClient(event.clientX, event.clientY);
  }

  function selectZone(zoneId: string, multiSelect: boolean) {
    setSelectedZoneIds((previous) => {
      if (!multiSelect) return [zoneId];
      return previous.includes(zoneId)
        ? previous.filter((id) => id !== zoneId)
        : [...previous, zoneId];
    });
  }

  function onTemplatePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    setSelectedZoneIds([]);
    const point = getRelativePoint(event);
    setDrag({
      active: true,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onTemplatePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (move) {
      const point = getRelativePoint(event);
      const dx = point.x - move.startPointerX;
      const dy = point.y - move.startPointerY;
      setZones((prev) =>
        prev.map((zone) =>
          zone.id === move.zoneId
            ? {
                ...zone,
                x: Math.max(0, Math.min(TEMPLATE_WIDTH - zone.width, move.startZoneX + dx)),
                y: Math.max(0, Math.min(TEMPLATE_HEIGHT - zone.height, move.startZoneY + dy)),
              }
            : zone,
        ),
      );
      return;
    }
    if (!drag?.active) return;
    const point = getRelativePoint(event);
    setDrag((prev) =>
      prev
        ? {
            ...prev,
            currentX: point.x,
            currentY: point.y,
          }
        : prev,
    );
  }

  function onTemplatePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (move) {
      const movedZone = zones.find((zone) => zone.id === move.zoneId);
      setMove(null);
      if (movedZone) {
        patchZone(movedZone.id, { x: movedZone.x, y: movedZone.y });
      }
      return;
    }
    if (!drag?.active) return;
    const point = getRelativePoint(event);
    const x = Math.min(drag.startX, point.x);
    const y = Math.min(drag.startY, point.y);
    const width = Math.abs(drag.startX - point.x);
    const height = Math.abs(drag.startY - point.y);
    setDrag(null);
    if (width < 12 || height < 12) return;

    const name = zoneName.trim() || `Zone ${zones.length + 1}`;
    void runAction(async () => {
      await createZone({ name, x, y, width, height, enabled: true });
      await refresh();
    });
  }

  function onZonePointerDown(zone: LockZone, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const multiSelect = event.shiftKey || event.ctrlKey || event.metaKey;
    selectZone(zone.id, multiSelect);
    if (multiSelect) return;
    const point = getRelativePointFromClient(event.clientX, event.clientY);
    setMove({
      zoneId: zone.id,
      startPointerX: point.x,
      startPointerY: point.y,
      startZoneX: zone.x,
      startZoneY: zone.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDeleteSelectedZone() {
    if (selectedZoneIds.length === 0) return;
    const idsToDelete = [...selectedZoneIds];
    void runAction(async () => {
      const results = await Promise.allSettled(idsToDelete.map((zoneId) => deleteZone(zoneId)));
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failedCount = results.length - successCount;
      if (successCount === 0) {
        throw new Error("Failed to delete selected area(s).");
      }
      setZones((prev) => prev.filter((zone) => !idsToDelete.includes(zone.id)));
      setSelectedZoneIds([]);
      await refresh();
      if (failedCount > 0) {
        setError(`Deleted ${successCount} area(s), but ${failedCount} failed.`);
      }
    });
  }

  async function toggleCanvasFullscreen() {
    if (!templateHostRef.current) return;
    if (document.fullscreenElement === templateHostRef.current) {
      await document.exitFullscreen();
      return;
    }
    await templateHostRef.current.requestFullscreen();
  }

  function computedDragRect() {
    if (!drag?.active) return null;
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.startX - drag.currentX);
    const height = Math.abs(drag.startY - drag.currentY);
    return { x, y, width, height };
  }

  const dragRect = computedDragRect();
  const canvasZones = useMemo(() => {
    if (selectedZoneIds.length === 0) return zones;
    const selectedSet = new Set(selectedZoneIds);
    const selected = zones.filter((zone) => selectedSet.has(zone.id));
    const others = zones.filter((zone) => !selectedSet.has(zone.id));
    return [...others, ...selected];
  }, [zones, selectedZoneIds]);
  const lockedZones = useMemo(
    () =>
      (overlayState?.zones ?? [])
        .filter((zoneState) => zoneState.isLocked && zoneState.zone.enabled)
        .map((zoneState) => zoneState.zone),
    [overlayState],
  );

  const progress = useMemo(() => {
    if (todos.length === 0) return 0;
    const done = todos.filter((todo) => todo.status === "done").length;
    return Math.round((done / todos.length) * 100);
  }, [todos]);

  const requiredByZone = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const zoneState of overlayState?.zones ?? []) {
      map.set(zoneState.zone.id, new Set(zoneState.requiredTodoIds));
    }
    return map;
  }, [overlayState]);

  return (
    <main>
      <h1>SlayTheList MVP</h1>
      <p>
        Complete todos to unlock blocked game regions. Configure lock zones and todo
        requirements below.
      </p>

      <div className="grid">
        <section className="panel">
          <h2>Create Todo</h2>
          <form onSubmit={onCreateTodo} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Clean desk for 5 minutes"
              style={{ flex: 1 }}
            />
            <button type="submit">Add</button>
          </form>

          <h2 style={{ marginTop: "1rem" }}>Todos</h2>
          <p>Progress: {progress}% done</p>
          {loadState === "loading" && <p>Loading…</p>}
          {error && <p style={{ color: "#fda4af" }}>{error}</p>}
          {todos.length === 0 ? (
            <p>No todos yet.</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: "0.5rem",
              }}
            >
              {todos.map((todo) => (
                <li
                  key={todo.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    padding: "0.65rem 0.75rem",
                  }}
                >
                  <span style={{ textDecoration: todo.status === "done" ? "line-through" : "none" }}>
                    {todo.title}
                  </span>
                  <button type="button" onClick={() => toggleTodo(todo)}>
                    Mark {todo.status === "done" ? "pending" : "done"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Create Lock Zone</h2>
          <form onSubmit={onCreateZone} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={zoneName}
              onChange={(event) => setZoneName(event.target.value)}
              placeholder="e.g. Top center card zone"
              style={{ flex: 1 }}
            />
            <button type="submit">Add Zone</button>
          </form>
          <p style={{ marginTop: "0.75rem", marginBottom: "0.5rem", opacity: 0.85 }}>
            Drag empty space to create. Click a block to select and drag it to rearrange.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <button type="button" onClick={() => void toggleCanvasFullscreen()}>
              {isCanvasFullscreen ? "Exit fullscreen" : "Fullscreen canvas"}
            </button>
            <button type="button" onClick={onDeleteSelectedZone} disabled={selectedZoneIds.length === 0}>
              Delete selected area(s)
            </button>
            <small style={{ alignSelf: "center", opacity: 0.75 }}>
              {selectedZoneIds.length > 0
                ? `${selectedZoneIds.length} selected`
                : "No area selected"}
            </small>
          </div>
          <div
            ref={templateHostRef}
            style={{
              width: "100%",
              background: isCanvasFullscreen ? "#0b1220" : "transparent",
              padding: isCanvasFullscreen ? "1rem" : 0,
            }}
          >
          <div
            ref={templateRef}
            onPointerDown={onTemplatePointerDown}
            onPointerMove={onTemplatePointerMove}
            onPointerUp={onTemplatePointerUp}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: isCanvasFullscreen ? "100%" : CANVAS_MAX_WIDTH,
              aspectRatio: `${TEMPLATE_WIDTH} / ${TEMPLATE_HEIGHT}`,
              borderRadius: "8px",
              border: "1px dashed #4b5563",
              background:
                "linear-gradient(180deg, rgba(17,24,39,0.7) 0%, rgba(11,18,32,0.9) 100%)",
              overflow: "hidden",
              marginBottom: "1rem",
            }}
          >
            {canvasZones.map((zone) => {
              const zoneState = overlayState?.zones.find((entry) => entry.zone.id === zone.id);
              const isSelected = selectedZoneIds.includes(zone.id);
              const isLocked = !!zoneState?.isLocked;
              return (
                <div
                  key={`template:${zone.id}`}
                  onPointerDown={(event) => onZonePointerDown(zone, event)}
                  onPointerMove={onTemplatePointerMove}
                  onPointerUp={onTemplatePointerUp}
                  style={{
                    position: "absolute",
                    left: `${(zone.x / TEMPLATE_WIDTH) * 100}%`,
                    top: `${(zone.y / TEMPLATE_HEIGHT) * 100}%`,
                    width: `${(zone.width / TEMPLATE_WIDTH) * 100}%`,
                    height: `${(zone.height / TEMPLATE_HEIGHT) * 100}%`,
                    border: `2px solid ${
                      isSelected ? "#60a5fa" : isLocked ? "#fca5a5" : "#86efac"
                    }`,
                    background: isLocked ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.2)",
                    pointerEvents: "auto",
                    cursor: "move",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: "0.25rem",
                    fontSize: 11,
                    color: "#fee2e2",
                    fontWeight: 600,
                  }}
                >
                  {isLocked ? "This area is blocked" : ""}
                </div>
              );
            })}
            {dragRect && (
              <div
                style={{
                  position: "absolute",
                  left: `${(dragRect.x / TEMPLATE_WIDTH) * 100}%`,
                  top: `${(dragRect.y / TEMPLATE_HEIGHT) * 100}%`,
                  width: `${(dragRect.width / TEMPLATE_WIDTH) * 100}%`,
                  height: `${(dragRect.height / TEMPLATE_HEIGHT) * 100}%`,
                  border: "1px solid #60a5fa",
                  background: "rgba(96,165,250,0.2)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
          </div>

          <h2 style={{ marginTop: "1rem" }}>Lock Zones</h2>
          {zones.length === 0 ? (
            <p>No lock zones yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {zones.map((zone) => {
                const required = requiredByZone.get(zone.id) ?? new Set<string>();
                const zoneState = overlayState?.zones.find((entry) => entry.zone.id === zone.id);
                return (
                  <article
                    key={zone.id}
                    onClick={(event) => selectZone(zone.id, event.shiftKey || event.ctrlKey || event.metaKey)}
                    style={{
                      border: selectedZoneIds.includes(zone.id)
                        ? "1px solid #60a5fa"
                        : "1px solid #374151",
                      borderRadius: "10px",
                      padding: "0.75rem",
                      display: "grid",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        value={zone.name}
                        onChange={(event) => updateDraftZone(zone.id, "name", event.target.value)}
                        onBlur={() => commitZoneField(zone.id, "name")}
                        style={{ flex: 1 }}
                      />
                      <button type="button" onClick={() => patchZone(zone.id, { enabled: !zone.enabled })}>
                        {zone.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.35rem" }}>
                      {(["x", "y", "width", "height"] as const).map((key) => (
                        <label key={key} style={{ display: "grid", gap: "0.2rem" }}>
                          <small>{key}</small>
                          <input
                            type="number"
                            value={zone[key]}
                            onChange={(event) => {
                              const numeric = Number(event.target.value);
                              updateDraftZone(zone.id, key, Number.isFinite(numeric) ? numeric : 0);
                            }}
                            onBlur={() => commitZoneField(zone.id, key)}
                          />
                        </label>
                      ))}
                    </div>

                    <p style={{ margin: 0, color: zoneState?.isLocked ? "#fca5a5" : "#86efac" }}>
                      {zoneState?.isLocked ? "Locked in game" : "Unlocked in game"}
                    </p>

                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>Required todos</strong>
                      {todos.length === 0 ? (
                        <small>Create todos first.</small>
                      ) : (
                        todos.map((todo) => (
                          <label key={`${zone.id}:${todo.id}`} style={{ display: "flex", gap: "0.4rem" }}>
                            <input
                              type="checkbox"
                              checked={required.has(todo.id)}
                              onChange={() => void toggleZoneRequirement(zone.id, todo.id)}
                            />
                            <span>{todo.title}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <h2 style={{ marginTop: "1rem" }}>Test Arena</h2>
          <p style={{ marginTop: "0.35rem", opacity: 0.85 }}>
            Simulates the game surface so you can test click blocking without launching Slay the Spire 2.
          </p>
          <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", marginBottom: "0.5rem" }}>
            <input
              type="checkbox"
              checked={applyZonesToTestArea}
              onChange={(event) => setApplyZonesToTestArea(event.target.checked)}
            />
            <span>Apply locked zones to test arena</span>
          </label>
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: CANVAS_MAX_WIDTH,
              aspectRatio: `${TEMPLATE_WIDTH} / ${TEMPLATE_HEIGHT}`,
              borderRadius: "8px",
              border: "1px solid #374151",
              background:
                "radial-gradient(circle at center, rgba(59,130,246,0.18) 0%, rgba(17,24,39,0.9) 70%)",
              overflow: "hidden",
              marginBottom: "0.5rem",
            }}
          >
            <button
              type="button"
              onClick={() => setTestClicks((value) => value + 1)}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 2,
                padding: "0.75rem 1rem",
              }}
            >
              Test button (click me)
            </button>

            {applyZonesToTestArea &&
              lockedZones.map((zone) => (
                <div
                  key={`test-overlay:${zone.id}`}
                  title={`Blocked by ${zone.name}`}
                  style={{
                    position: "absolute",
                    left: `${(zone.x / TEMPLATE_WIDTH) * 100}%`,
                    top: `${(zone.y / TEMPLATE_HEIGHT) * 100}%`,
                    width: `${(zone.width / TEMPLATE_WIDTH) * 100}%`,
                    height: `${(zone.height / TEMPLATE_HEIGHT) * 100}%`,
                    border: "2px dashed rgba(252,165,165,1)",
                    boxShadow: "0 0 0 1px rgba(239,68,68,0.95) inset",
                    background: "rgba(239,68,68,0.18)",
                    zIndex: 3,
                    pointerEvents: "auto",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: "0.5rem",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fecaca",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      fontSize: 10,
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: "rgba(127,29,29,0.9)",
                      color: "#fecaca",
                    }}
                  >
                    LOCKED
                  </span>
                  <span>This area is blocked</span>
                </div>
              ))}
          </div>
          <small style={{ opacity: 0.8 }}>Test button clicks: {testClicks}</small>
        </section>
      </div>
    </main>
  );
}
