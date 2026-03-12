"use client";

import {
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LockZone, OverlayState, Todo } from "@slaythelist/contracts";
import {
  createTodo,
  createZone,
  deleteTodo,
  deleteZone,
  getOverlayState,
  listTodos,
  listZones,
  overlayWebSocketUrl,
  reorderTodos,
  setTodoStatus,
  setZoneRequirements,
  updateTodo,
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
type ViewTab = "goals" | "blocks";
type TodoFilter = "active" | "completed" | "archived" | "all";
type TodoRange = "daily" | "weekly" | "monthly" | "all" | "top";
type TodoMode = "list" | "calendar";

const TEMPLATE_WIDTH = 1280;
const TEMPLATE_HEIGHT = 720;
const CANVAS_MAX_WIDTH = 720;
const BLOCKED_IMAGE_CANDIDATES = [
  "/blocked-overlays/blocked-1.jpg",
  "/blocked-overlays/blocked-2.jpg",
  "/blocked-overlays/blocked-3.jpg",
  "/blocked-overlays/Locked2.png",
  "/blocked-overlays/locked2.png",
  "/blocked-overlays/Locked2.jpg",
  "/blocked-overlays/Locked2.jpeg",
  "/blocked-overlays/Locked2.webp",
  "/blocked-overlays/Locked3.png",
  "/blocked-overlays/locked3.png",
  "/blocked-overlays/Locked3.jpg",
  "/blocked-overlays/Locked3.jpeg",
  "/blocked-overlays/Locked3.webp",
];

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unexpected error";
}

function blockedImageForZone(zoneId: string, imagePool: string[]) {
  if (imagePool.length === 0) return undefined;
  let hash = 0;
  for (let i = 0; i < zoneId.length; i += 1) {
    hash = (hash * 31 + zoneId.charCodeAt(i)) >>> 0;
  }
  return imagePool[hash % imagePool.length];
}

function imageLabel(src: string) {
  const fileName = src.split("/").pop() ?? src;
  return fileName;
}

function truncateText(input: string, max = 40) {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function lockMessage(requiredTodoTitles: string[]) {
  if (requiredTodoTitles.length === 0) {
    return "Unlock via\n\nto-do";
  }
  if (requiredTodoTitles.length === 1) {
    return `Unlock via\n\n${truncateText(requiredTodoTitles[0])}`;
  }
  return `Unlock via\n\n${requiredTodoTitles.length} to-dos`;
}

function lockTextStyleForZone(zoneWidth: number, zoneHeight: number): CSSProperties {
  const minDim = Math.max(1, Math.min(zoneWidth, zoneHeight));
  const aspectRatio = zoneWidth / Math.max(1, zoneHeight);
  const narrowScale = Math.max(0.68, Math.min(1, aspectRatio * 1.2));
  const fontSize = Math.max(6, Math.min(11, minDim * 0.043 * narrowScale));
  const horizontalPadding = Math.max(2, Math.min(8, minDim * 0.04));
  const verticalPadding = Math.max(1, Math.min(5, minDim * 0.02));

  return {
    textAlign: "center",
    maxWidth: "92%",
    fontFamily: "Georgia, \"Times New Roman\", serif",
    fontSize,
    lineHeight: 1.15,
    fontWeight: 800,
    color: "#f8fafc",
    padding: `${verticalPadding}px ${horizontalPadding}px`,
    whiteSpace: "pre-line",
    textShadow: "0 1px 7px rgba(15,23,42,0.95), 0 0 14px rgba(15,23,42,0.75)",
  };
}

function lockTextTopPadding(zoneWidth: number, zoneHeight: number): string {
  const minDim = Math.max(1, Math.min(zoneWidth, zoneHeight));
  const topPadding = Math.max(6, Math.min(30, minDim * 0.18));
  return `${topPadding}px`;
}

function getDefaultDeadline(range: TodoRange): string {
  const now = new Date();
  if (range === "daily" || range === "top") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  }
  if (range === "weekly") {
    const dayOfWeek = now.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + daysUntilSunday,
      23,
      59,
      59,
    ).toISOString();
  }
  if (range === "monthly") {
    return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  }
  return new Date(2100, 0, 1).toISOString();
}

function getViewForDeadline(deadlineAt: string | null): TodoRange {
  if (!deadlineAt) return "all";
  const now = new Date();
  const deadlineDate = new Date(deadlineAt);
  if (!Number.isFinite(deadlineDate.getTime())) return "all";
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (deadlineDate <= endOfToday) return "daily";
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday, 23, 59, 59);
  if (deadlineDate <= endOfWeek) return "weekly";
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (deadlineDate <= endOfMonth) return "monthly";
  return "all";
}

function deadlineToDateInput(deadlineAt: string | null): string {
  if (!deadlineAt) return "";
  const date = new Date(deadlineAt);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToDeadline(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export default function Page() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [zones, setZones] = useState<LockZone[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null);
  const [zoneName, setZoneName] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("goals");
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("active");
  const [todoRange, setTodoRange] = useState<TodoRange>("daily");
  const [todoMode, setTodoMode] = useState<TodoMode>("list");
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [todoDrafts, setTodoDrafts] = useState<Record<string, string>>({});
  const [zoneImageOverrides, setZoneImageOverrides] = useState<Record<string, string>>({});
  const [blockedImages, setBlockedImages] = useState<string[]>([]);
  const templateRef = useRef<HTMLDivElement | null>(null);
  const templateHostRef = useRef<HTMLDivElement | null>(null);
  const todoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [focusTodoId, setFocusTodoId] = useState<string | null>(null);

  async function refresh(showLoader = false) {
    if (showLoader) {
      setLoadState("loading");
    }
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
    void refresh(true);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(overlayWebSocketUrl());
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: string };
        if (parsed.type === "overlay_state") {
          void refresh(false);
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
    let disposed = false;
    async function probeImages() {
      const checks = await Promise.all(
        BLOCKED_IMAGE_CANDIDATES.map(
          (src) =>
            new Promise<{ src: string; ok: boolean }>((resolve) => {
              const image = new window.Image();
              image.onload = () => resolve({ src, ok: true });
              image.onerror = () => resolve({ src, ok: false });
              image.src = src;
            }),
        ),
      );
      if (disposed) return;
      const found = checks.filter((entry) => entry.ok).map((entry) => entry.src);
      const uniqueByFileName = new Map<string, string>();
      for (const src of found) {
        const key = imageLabel(src).toLowerCase();
        if (!uniqueByFileName.has(key)) {
          uniqueByFileName.set(key, src);
        }
      }
      setBlockedImages([...uniqueByFileName.values()]);
    }
    void probeImages();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const storageKey = "slaythelist.zoneImageOverrides";
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const restored: Record<string, string> = {};
      for (const [zoneId, value] of Object.entries(parsed)) {
        if (typeof value === "string") restored[zoneId] = value;
      }
      setZoneImageOverrides(restored);
    } catch {
      // ignore invalid local storage values
    }
  }, []);

  useEffect(() => {
    const allowedImages = new Set(blockedImages);
    const knownZoneIds = new Set(zones.map((zone) => zone.id));
    setZoneImageOverrides((prev) => {
      const next: Record<string, string> = {};
      for (const [zoneId, src] of Object.entries(prev)) {
        if (knownZoneIds.has(zoneId) && allowedImages.has(src)) {
          next[zoneId] = src;
        }
      }
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      if (
        prevEntries.length === nextEntries.length &&
        prevEntries.every(([zoneId, src]) => next[zoneId] === src)
      ) {
        return prev;
      }
      return next;
    });
  }, [blockedImages, zones]);

  useEffect(() => {
    const storageKey = "slaythelist.zoneImageOverrides";
    window.localStorage.setItem(storageKey, JSON.stringify(zoneImageOverrides));
  }, [zoneImageOverrides]);

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
    const next = todo.status === "done" ? "active" : "done";
    const nowIso = new Date().toISOString();
    setTodos((previous) =>
      previous.map((item) =>
        item.id === todo.id
          ? {
              ...item,
              status: next,
              completedAt: next === "done" ? (item.completedAt ?? nowIso) : null,
              updatedAt: nowIso,
            }
          : item,
      ),
    );
    void runAction(async () => {
      const updated = await setTodoStatus(todo.id, next);
      setTodos((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    });
  }

  function commitTodoTitle(todo: Todo) {
    const draft = todoDrafts[todo.id] ?? todo.title;
    if (draft === todo.title) return;
    const nowIso = new Date().toISOString();
    setTodos((previous) =>
      previous.map((item) => (item.id === todo.id ? { ...item, title: draft, updatedAt: nowIso } : item)),
    );
    void runAction(async () => {
      const updated = await updateTodo(todo.id, { title: draft });
      setTodos((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    });
  }

  function removeTodo(todoId: string) {
    const previousTodos = [...todos];
    setTodos((previous) => previous.filter((item) => item.id !== todoId));
    void (async () => {
      try {
        await deleteTodo(todoId);
      } catch (err) {
        setTodos(previousTodos);
        setError(toErrorMessage(err));
      }
    })();
  }

  function setTodoArchived(todo: Todo, archived: boolean) {
    const nowIso = new Date().toISOString();
    setTodos((previous) =>
      previous.map((item) =>
        item.id === todo.id
          ? { ...item, archivedAt: archived ? nowIso : null, updatedAt: nowIso }
          : item,
      ),
    );
    void runAction(async () => {
      const updated = await updateTodo(todo.id, { archived });
      setTodos((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    });
  }

  function applyVisibleReorder(newVisibleIds: string[]) {
    const visibleSet = new Set(filteredTodos.map((todo) => todo.id));
    const fullOrder = todos.map((todo) => todo.id);
    let nextVisibleIndex = 0;
    const mergedIds = fullOrder.map((id) => {
      if (!visibleSet.has(id)) return id;
      const replacement = newVisibleIds[nextVisibleIndex];
      nextVisibleIndex += 1;
      return replacement;
    });
    const map = new Map(todos.map((todo) => [todo.id, todo] as const));
    const optimistic = mergedIds.map((id) => map.get(id)).filter((todo): todo is Todo => !!todo);
    setTodos(optimistic);
    void runAction(async () => {
      const reordered = await reorderTodos(mergedIds);
      setTodos(reordered.items);
    });
  }

  function onTodoDragStart(todoId: string, event: ReactDragEvent<HTMLButtonElement>) {
    setDraggingTodoId(todoId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", todoId);
  }

  function onTodoDrop(targetTodoId: string, event: ReactDragEvent<HTMLLIElement>) {
    const draggedId = draggingTodoId || event.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetTodoId) {
      setDraggingTodoId(null);
      return;
    }
    const visibleIds = filteredTodos.map((todo) => todo.id);
    const fromIndex = visibleIds.indexOf(draggedId);
    const toIndex = visibleIds.indexOf(targetTodoId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingTodoId(null);
      return;
    }
    const reorderedVisibleIds = [...visibleIds];
    const [moved] = reorderedVisibleIds.splice(fromIndex, 1);
    reorderedVisibleIds.splice(toIndex, 0, moved);
    setDraggingTodoId(null);
    applyVisibleReorder(reorderedVisibleIds);
  }

  function copyVisibleGoalsToClipboard() {
    const lines = filteredTodos
      .map((todo) => `${"  ".repeat(todo.indent)}- [${todo.status === "done" ? "x" : " "}] ${todo.title}`)
      .join("\n");
    void navigator.clipboard.writeText(lines);
    setJustCopied(true);
    window.setTimeout(() => setJustCopied(false), 1400);
  }

  function openEditModal(todo: Todo) {
    setEditingTodoId(todo.id);
    setEditTitle(todo.title);
    setEditDeadline(deadlineToDateInput(todo.deadlineAt));
  }

  function closeEditModal() {
    setEditingTodoId(null);
    setEditTitle("");
    setEditDeadline("");
  }

  function saveEditModal() {
    if (!editingTodoId) return;
    const nextTitle = editTitle;
    void runAction(async () => {
      await updateTodo(editingTodoId, {
        title: nextTitle,
        deadlineAt: dateInputToDeadline(editDeadline),
      });
      closeEditModal();
      await refresh();
    });
  }

  function addItemBelowList() {
    void runAction(async () => {
      const created = await createTodo("", { deadlineAt: getDefaultDeadline(todoRange) });
      const orderedIds = todos.map((item) => item.id).filter((id) => id !== created.id);
      const lastVisibleId = filteredTodos[filteredTodos.length - 1]?.id;
      const insertAfterIndex = lastVisibleId ? orderedIds.indexOf(lastVisibleId) : orderedIds.length - 1;
      orderedIds.splice(insertAfterIndex + 1, 0, created.id);
      const map = new Map([...todos, created].map((todo) => [todo.id, todo] as const));
      const optimistic = orderedIds.map((id) => map.get(id)).filter((todo): todo is Todo => !!todo);
      setTodos(optimistic);
      const reordered = await reorderTodos(orderedIds);
      setTodos(reordered.items);
      setFocusTodoId(created.id);
    });
  }

  function updateTodoIndent(todo: Todo, direction: -1 | 1) {
    const index = todos.findIndex((item) => item.id === todo.id);
    if (index < 0) return;
    const previous = index > 0 ? todos[index - 1] : null;
    const maxIndent = previous ? previous.indent + 1 : 0;
    const nextIndent = Math.max(0, Math.min(maxIndent, todo.indent + direction));
    if (nextIndent === todo.indent) return;
    void runAction(async () => {
      await updateTodo(todo.id, { indent: nextIndent });
      await refresh();
    });
  }

  function onTodoTitleKeyDown(todo: Todo, event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      updateTodoIndent(todo, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const input = event.currentTarget;
      const currentValue = input.value;
      const cursor = input.selectionStart ?? currentValue.length;
      const prefix = currentValue.slice(0, cursor);
      const suffix = currentValue.slice(cursor);
      void runAction(async () => {
        if (prefix !== todo.title) {
          await updateTodo(todo.id, { title: prefix });
        }
        const created = await createTodo(suffix, {
          deadlineAt: todo.deadlineAt ?? getDefaultDeadline(todoRange),
        });
        if (todo.indent > 0) {
          await updateTodo(created.id, { indent: todo.indent });
        }
        const orderedIds = todos.map((item) => item.id).filter((id) => id !== created.id);
        const todoIndex = orderedIds.indexOf(todo.id);
        const insertionIndex = todoIndex >= 0 ? todoIndex + 1 : orderedIds.length;
        orderedIds.splice(insertionIndex, 0, created.id);
        const map = new Map(
          todos
            .map((item) => (item.id === todo.id ? { ...item, title: prefix } : item))
            .concat(created)
            .map((item) => [item.id, item] as const),
        );
        const optimistic = orderedIds.map((id) => map.get(id)).filter((item): item is Todo => !!item);
        setTodos(optimistic);
        const reordered = await reorderTodos(orderedIds);
        setTodos(reordered.items);
        setFocusTodoId(created.id);
      });
      return;
    }
    if (event.key === "Backspace") {
      const input = event.currentTarget;
      if ((input.selectionStart ?? 0) !== 0 || (input.selectionEnd ?? 0) !== 0) return;
      const todoIndex = todos.findIndex((item) => item.id === todo.id);
      if (todoIndex <= 0) return;
      event.preventDefault();
      const previousTodo = todos[todoIndex - 1];
      const mergedTitle = previousTodo.title + (todoDrafts[todo.id] ?? todo.title);
      void runAction(async () => {
        await updateTodo(previousTodo.id, { title: mergedTitle });
        await deleteTodo(todo.id);
        setFocusTodoId(previousTodo.id);
        await refresh();
      });
    }
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
  const progress = useMemo(() => {
    const activeTodos = todos.filter((todo) => !todo.archivedAt);
    if (activeTodos.length === 0) return 0;
    const done = activeTodos.filter((todo) => todo.status === "done").length;
    return Math.round((done / activeTodos.length) * 100);
  }, [todos]);

  const filteredTodos = useMemo(() => {
    const statusFiltered = todos.filter((todo) => {
      if (todoFilter === "archived") return !!todo.archivedAt;
      if (todoFilter === "active") return !todo.archivedAt && todo.status === "active";
      if (todoFilter === "completed") return !todo.archivedAt && todo.status === "done";
      return true;
    });
    const rangeFiltered = statusFiltered.filter((todo) => {
      if (todoFilter === "completed" || todoFilter === "archived" || todoRange === "all") {
        return true;
      }
      if (todoRange === "top") return true;
      const view = getViewForDeadline(todo.deadlineAt);
      if (todoRange === "monthly") return view === "daily" || view === "weekly" || view === "monthly";
      if (todoRange === "weekly") return view === "daily" || view === "weekly";
      if (todoRange === "daily") return view === "daily";
      return true;
    });
    if (todoRange === "top" && (todoFilter === "active" || todoFilter === "all") && rangeFiltered.length > 0) {
      const firstTopLevelIndex = rangeFiltered.findIndex((todo) => todo.indent === 0);
      if (firstTopLevelIndex >= 0) {
        const topSlice: Todo[] = [rangeFiltered[firstTopLevelIndex]];
        for (let i = firstTopLevelIndex + 1; i < rangeFiltered.length; i += 1) {
          const next = rangeFiltered[i];
          if (next.indent === 0) break;
          topSlice.push(next);
        }
        return topSlice;
      }
    }
    return rangeFiltered;
  }, [todoFilter, todoRange, todos]);

  useEffect(() => {
    setTodoDrafts((previous) => {
      const next: Record<string, string> = {};
      for (const todo of todos) {
        next[todo.id] = previous[todo.id] ?? todo.title;
      }
      return next;
    });
  }, [todos]);

  useEffect(() => {
    if (!focusTodoId) return;
    const input = todoInputRefs.current.get(focusTodoId);
    if (!input) return;
    window.setTimeout(() => {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
      setFocusTodoId(null);
    }, 0);
  }, [focusTodoId, todos]);

  const requiredByZone = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const zoneState of overlayState?.zones ?? []) {
      map.set(zoneState.zone.id, new Set(zoneState.requiredTodoIds));
    }
    return map;
  }, [overlayState]);
  const lockableTodos = useMemo(
    () => todos.filter((todo) => !todo.archivedAt && todo.title.trim().length > 0),
    [todos],
  );
  const titleByTodoId = useMemo(
    () => new Map(lockableTodos.map((todo) => [todo.id, todo.title] as const)),
    [lockableTodos],
  );
  const statusByTodoId = useMemo(
    () => new Map(lockableTodos.map((todo) => [todo.id, todo.status] as const)),
    [lockableTodos],
  );

  const selectedImageValue = useMemo(() => {
    if (selectedZoneIds.length === 0) return "__auto__";
    const values = selectedZoneIds.map((zoneId) => zoneImageOverrides[zoneId] ?? "__auto__");
    const first = values[0];
    return values.every((value) => value === first) ? first : "__mixed__";
  }, [selectedZoneIds, zoneImageOverrides]);

  function applyImageToSelectedZones(imageSrc: string | null) {
    if (selectedZoneIds.length === 0) return;
    setZoneImageOverrides((previous) => {
      const next = { ...previous };
      for (const zoneId of selectedZoneIds) {
        if (imageSrc === null) {
          delete next[zoneId];
        } else {
          next[zoneId] = imageSrc;
        }
      }
      return next;
    });
  }

  function imageForZone(zoneId: string): string | undefined {
    return zoneImageOverrides[zoneId] ?? blockedImageForZone(zoneId, blockedImages);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>SlayTheList</h1>
        <p>
        Complete todos to unlock blocked game regions.
        </p>
      </header>
      <div className="grid single-column">
        <section className="panel tab-stage">
          <div className="tab-stage-body">
          {activeTab === "goals" && (
          <section className="tab-pane goals-board">
            <div className="goals-topbar">
              <nav className="goals-subtabs" aria-label="Accountability sections">
                <button
                  type="button"
                  className={`goals-subtab ${activeTab === "goals" ? "active" : ""}`}
                  onClick={() => setActiveTab("goals")}
                >
                  Goals
                </button>
                <button type="button" className="goals-subtab" disabled>Habits</button>
                <button type="button" className="goals-subtab" disabled>Predictions</button>
                <button type="button" className="goals-subtab" disabled>Reflection</button>
                <button
                  type="button"
                  className="goals-subtab"
                  onClick={() => setActiveTab("blocks")}
                >
                  Block Setup
                </button>
              </nav>
              <div className="goals-filters">
                <button
                  type="button"
                  className={`goals-copy-btn ${justCopied ? "copied" : ""}`}
                  onClick={copyVisibleGoalsToClipboard}
                  title={justCopied ? "Copied" : "Copy visible goals"}
                >
                  {justCopied ? "✓" : "📋"}
                </button>
                <select value={todoFilter} onChange={(event) => setTodoFilter(event.target.value as TodoFilter)}>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="all">All</option>
                  <option value="archived">Archived</option>
                </select>
                <select value={todoRange} onChange={(event) => setTodoRange(event.target.value as TodoRange)}>
                  <option value="top">Top</option>
                  <option value="daily">Day</option>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                  <option value="all">All time</option>
                </select>
                <select value={todoMode} onChange={(event) => setTodoMode(event.target.value as TodoMode)}>
                  <option value="list">List</option>
                  <option value="calendar">Calendar</option>
                </select>
              </div>
            </div>

            <p className="goals-progress">Progress: {progress}% complete</p>
            {loadState === "loading" && <p>Loading…</p>}
            {error && <p style={{ color: "#fda4af" }}>{error}</p>}

            {todoMode === "calendar" ? (
              <p className="goals-empty">Calendar view is coming soon.</p>
            ) : filteredTodos.length === 0 ? (
              <p className="goals-empty">No goals yet.</p>
            ) : (
              <ul className="goals-list" onDragOver={(event) => event.preventDefault()}>
                {filteredTodos.map((todo) => (
                  <li
                    key={todo.id}
                    className={`goal-row ${todo.status === "done" ? "done" : ""}`}
                    style={{ marginLeft: `${todo.indent * 18}px` }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => onTodoDrop(todo.id, event)}
                  >
                    <div className="goal-main">
                      <button
                        type="button"
                        className="goal-drag-handle"
                        draggable
                        onDragStart={(event) => onTodoDragStart(todo.id, event)}
                        onDragEnd={() => setDraggingTodoId(null)}
                        aria-label="Drag to reorder"
                      >
                        ⋮⋮
                      </button>
                      <input
                        type="checkbox"
                        checked={todo.status === "done"}
                        onChange={() => toggleTodo(todo)}
                        aria-label={`Toggle ${todo.title}`}
                      />
                      <input
                        ref={(node) => {
                          if (node) {
                            todoInputRefs.current.set(todo.id, node);
                          } else {
                            todoInputRefs.current.delete(todo.id);
                          }
                        }}
                        value={todoDrafts[todo.id] ?? todo.title}
                        onChange={(event) =>
                          setTodoDrafts((prev) => ({ ...prev, [todo.id]: event.target.value }))
                        }
                        onKeyDown={(event) => onTodoTitleKeyDown(todo, event)}
                        onBlur={() => commitTodoTitle(todo)}
                        placeholder={
                          todo.title === ""
                            ? todoRange === "all"
                              ? "Add an item..."
                              : `Add a ${todoRange} item...`
                            : undefined
                        }
                        className="goal-title-input"
                      />
                      <div className="goal-actions">
                        {!todo.archivedAt && (
                          <button type="button" onClick={() => openEditModal(todo)}>Edit</button>
                        )}
                        {todo.archivedAt ? (
                          <>
                            <button type="button" onClick={() => setTodoArchived(todo, false)}>Restore</button>
                            <button type="button" onClick={() => removeTodo(todo.id)}>Delete</button>
                          </>
                        ) : todo.status === "done" || todoFilter === "completed" ? (
                          <button type="button" onClick={() => setTodoArchived(todo, true)}>Archive</button>
                        ) : (
                          <button type="button" onClick={() => removeTodo(todo.id)}>Delete</button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {todoMode === "list" &&
              todoFilter !== "completed" &&
              todoFilter !== "archived" &&
              todoRange !== "top" && (
              <button type="button" className="goals-add-item-btn" onClick={addItemBelowList}>
                <span>+</span> New item
              </button>
              )}
          </section>
          )}

          {activeTab === "blocks" && (
          <section className="tab-pane goals-board">
          <div className="goals-topbar">
            <nav className="goals-subtabs" aria-label="Accountability sections">
              <button
                type="button"
                className="goals-subtab"
                onClick={() => setActiveTab("goals")}
              >
                Goals
              </button>
              <button type="button" className="goals-subtab" disabled>Habits</button>
              <button type="button" className="goals-subtab" disabled>Predictions</button>
              <button type="button" className="goals-subtab" disabled>Reflection</button>
              <button
                type="button"
                className={`goals-subtab ${activeTab === "blocks" ? "active" : ""}`}
                onClick={() => setActiveTab("blocks")}
              >
                Block Setup
              </button>
            </nav>
          </div>
          <div className="tab-pane">
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
          <label style={{ display: "grid", gap: "0.3rem", marginBottom: "0.5rem" }}>
            <span>Locked area image</span>
            <select
              value={selectedImageValue}
              disabled={blockedImages.length === 0 || selectedZoneIds.length === 0}
              onChange={(event) =>
                applyImageToSelectedZones(
                  event.target.value === "__auto__" || event.target.value === "__mixed__"
                    ? null
                    : event.target.value,
                )
              }
            >
              <option value="__auto__">Auto by zone</option>
              {selectedImageValue === "__mixed__" && <option value="__mixed__">Mixed selection</option>}
              {blockedImages.map((src) => (
                <option key={`blocked-image:${src}`} value={src}>
                  {imageLabel(src)}
                </option>
              ))}
            </select>
            {blockedImages.length === 0 && (
              <small style={{ opacity: 0.8 }}>
                No images found in `frontend/web/public/blocked-overlays`.
              </small>
            )}
            {blockedImages.length > 0 && selectedZoneIds.length === 0 && (
              <small style={{ opacity: 0.8 }}>
                Select one or more lock zones, then choose an image.
              </small>
            )}
          </label>
          <div
            style={{
              display: "flex",
              gap: "0.4rem",
              marginBottom: "0.6rem",
              overflowX: "auto",
              paddingBottom: "0.25rem",
            }}
          >
            {blockedImages.map((src) => {
              const active = selectedImageValue === src;
              return (
                <button
                  key={`image-chip:${src}`}
                  type="button"
                  onClick={() => applyImageToSelectedZones(src)}
                  disabled={selectedZoneIds.length === 0}
                  style={{
                    width: 70,
                    height: 44,
                    border: active ? "2px solid #60a5fa" : "1px solid #4b5563",
                    padding: 0,
                    backgroundImage: `url("${src}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                  title={imageLabel(src)}
                />
              );
            })}
            <button
              type="button"
              onClick={() => applyImageToSelectedZones(null)}
              disabled={selectedZoneIds.length === 0}
              style={{
                minWidth: 78,
                height: 44,
                border: selectedImageValue === "__auto__" ? "2px solid #60a5fa" : "1px solid #4b5563",
                fontSize: 12,
              }}
            >
              Auto
            </button>
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
              const requiredTodoIds = zoneState?.requiredTodoIds ?? [];
              const requiredTitles = requiredTodoIds
                .map((todoId) => titleByTodoId.get(todoId))
                .filter((title): title is string => !!title);
              const isLocked =
                zone.enabled &&
                requiredTodoIds.length > 0 &&
                requiredTodoIds.some((todoId) => statusByTodoId.get(todoId) !== "done");
              const lockText = lockMessage(requiredTitles);
              const lockTextStyle = lockTextStyleForZone(zone.width, zone.height);
              const zoneImage = imageForZone(zone.id);
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
                      isSelected ? "#60a5fa" : isLocked ? "#166534" : "#86efac"
                    }`,
                    backgroundColor: zoneImage
                      ? isLocked
                        ? "rgba(15,23,42,0.16)"
                        : "rgba(15,23,42,0.1)"
                      : isLocked
                        ? "rgba(15,23,42,0.16)"
                        : "rgba(34,197,94,0.2)",
                    backgroundImage: zoneImage ? `url("${zoneImage}")` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: zoneImage ? "multiply" : "normal",
                    pointerEvents: "auto",
                    cursor: "move",
                  }}
                >
                  {isLocked && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "flex-start",
                        pointerEvents: "none",
                        paddingTop: lockTextTopPadding(zone.width, zone.height),
                        paddingLeft: "0.45rem",
                        paddingRight: "0.45rem",
                      }}
                    >
                      <div
                        style={{
                          ...lockTextStyle,
                        }}
                      >
                        {lockText}
                      </div>
                    </div>
                  )}
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
                const isLocked =
                  zone.enabled &&
                  required.size > 0 &&
                  [...required].some((todoId) => statusByTodoId.get(todoId) !== "done");
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

                    <p style={{ margin: 0, color: isLocked ? "#fca5a5" : "#86efac" }}>
                      {isLocked ? "Locked in game" : "Unlocked in game"}
                    </p>

                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>Required todos</strong>
                      {lockableTodos.length === 0 ? (
                        <small>Create todos first.</small>
                      ) : (
                        lockableTodos.map((todo) => (
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
          </div>
          </section>
          )}
          </div>
          </section>
      </div>
      {editingTodoId && (
        <div className="todo-edit-modal-backdrop" role="presentation" onClick={closeEditModal}>
          <div className="todo-edit-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>Edit item</h3>
            <label>
              Title
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} autoFocus />
            </label>
            <label>
              Deadline
              <input type="date" value={editDeadline} onChange={(event) => setEditDeadline(event.target.value)} />
            </label>
            <div className="todo-edit-modal-actions">
              <button type="button" onClick={closeEditModal}>Cancel</button>
              <button type="button" onClick={saveEditModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
