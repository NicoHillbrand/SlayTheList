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
import type {
  Habit,
  HabitStatus,
  LockZone,
  OverlayState,
  Prediction,
  PredictionOutcome,
  ReflectionEntry,
  Todo,
} from "@slaythelist/contracts";
import {
  createTodo,
  createZone,
  deleteTodo,
  deleteZone,
  getAccountabilityState,
  getOverlayState,
  listTodos,
  listZones,
  overlayWebSocketUrl,
  reorderTodos,
  saveAccountabilityState,
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
type ViewTab = "goals" | "habits" | "predictions" | "reflection" | "blocks";
type TodoFilter = "active" | "completed" | "archived" | "all";
type TodoRange = "daily" | "weekly" | "monthly" | "all" | "top";
type TodoMode = "list" | "calendar";
type HabitsView = "week" | "month";
type ReflectionView = "today" | "history";
type ReflectionQuestion = {
  key: string;
  label: string;
  placeholder: string;
  isMulti: boolean;
};
type ExpandProvider = "gemini-flash" | "openai-gpt-4o-mini";
type GoldSoundStep = {
  src: string;
  delayMs: number;
  volume: number;
  playbackRate?: number;
  startAtSec?: number;
  durationMs?: number;
};
type GoldSoundOption = {
  id: string;
  label: string;
  description: string;
  steps: GoldSoundStep[];
};

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

const DEFAULT_CORE_REFLECTION_QUESTIONS: ReflectionQuestion[] = [
  { key: "wins", label: "What went well today?", placeholder: "Add a win...", isMulti: true },
  { key: "problems", label: "What problems did you encounter?", placeholder: "Add a challenge...", isMulti: true },
  {
    key: "goalProgress",
    label: "How did you get closer to your goals?",
    placeholder: "Add progress...",
    isMulti: true,
  },
];

const DEFAULT_OPTIONAL_REFLECTION_QUESTIONS: ReflectionQuestion[] = [
  { key: "learnings", label: "What did you learn today?", placeholder: "Add a learning...", isMulti: true },
  { key: "gratitude", label: "What are you grateful for?", placeholder: "Add gratitude...", isMulti: true },
  {
    key: "outsideView",
    label: "Outside-view advice for tomorrow",
    placeholder: "If you were advising yourself...",
    isMulti: true,
  },
  {
    key: "fasterNext",
    label: "How could you have done something faster?",
    placeholder: "Add optimization idea...",
    isMulti: true,
  },
];

const GOLD_PER_TODO = 5;
const GOLD_STORAGE_KEY = "slaythelist.gold";
const REWARDED_TODOS_STORAGE_KEY = "slaythelist.gold.rewardedTodoIds";
const DEFAULT_GOLD_SOUND_ID = "sack-shift";
const GOLD_SOUND_OPTIONS: GoldSoundOption[] = [
  {
    id: "sack-drop",
    label: "Sack Drop",
    description: "A real bag-of-coins hit with a quick rich jingle after it lands.",
    steps: [
      { src: "/sfx/gold-sack.wav", delayMs: 0, volume: 0.72, startAtSec: 0, durationMs: 950 },
    ],
  },
  {
    id: "sack-shift",
    label: "Sack Shift",
    description: "More bag movement and coin shuffle, less impact at the start.",
    steps: [
      { src: "/sfx/gold-sack.wav", delayMs: 0, volume: 0.72, startAtSec: 0.22, durationMs: 1450 },
    ],
  },
  {
    id: "coin-rush",
    label: "Coin Rush",
    description: "A fast burst of many loose coins clinking together.",
    steps: [
      { src: "/sfx/coin-jingle.ogg", delayMs: 0, volume: 0.62, startAtSec: 0, durationMs: 900 },
    ],
  },
  {
    id: "tight-clink",
    label: "Tight Clink",
    description: "A short stacked clink burst made from smaller coin hits.",
    steps: [
      { src: "/sfx/starninjas/coin.3.ogg", delayMs: 0, volume: 0.3, playbackRate: 0.96 },
      { src: "/sfx/starninjas/coin.8.ogg", delayMs: 75, volume: 0.24, playbackRate: 1.02 },
      { src: "/sfx/starninjas/coin.11.ogg", delayMs: 145, volume: 0.2, playbackRate: 0.92 },
    ],
  },
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

function tomorrowDateInputValue(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = `${tomorrow.getMonth() + 1}`.padStart(2, "0");
  const day = `${tomorrow.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractJsonArray(text: string): string[] {
  function parseNestedArray(raw: string, depth = 0): string[] {
    if (depth > 3) return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const direct = JSON.parse(trimmed) as unknown;
      if (Array.isArray(direct)) {
        return direct
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim());
      }
      if (typeof direct === "string") {
        return parseNestedArray(direct, depth + 1);
      }
    } catch {
      // keep trying other strategies
    }
    const matched = trimmed.match(/\[[\s\S]*\]/);
    if (!matched) return [];
    if (matched[0] === trimmed) return [];
    return parseNestedArray(matched[0], depth + 1);
  }

  const parsedNested = parseNestedArray(text);
  if (parsedNested.length > 0) {
    return parsedNested;
  }

  const unescaped = text.replace(/\\"/g, "\"");
  const quotedItems = [...unescaped.matchAll(/"\[(?:2m|5m)\][^"\r\n]*"/gi)].map((match) =>
    match[0].slice(1, -1).trim(),
  );
  if (quotedItems.length > 0) {
    return quotedItems;
  }

  const lineBased = unescaped
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^[\-\*\d\.\)\s]+/, ""))
    .map((line) => line.replace(/^["'`]|["'`,]$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("[") && !line.startsWith("]"));
  return lineBased;
}

function normalizeSubtasks(raw: string[]): string[] {
  return [...new Set(raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
    .map((entry) => (/^\[(2m|5m)\]\s/i.test(entry) ? entry : `[5m] ${entry}`))
    .slice(0, 5);
}

function extractBracketTasks(text: string): string[] {
  const unescaped = text.replace(/\\"/g, "\"");
  return [...unescaped.matchAll(/\[(?:2m|5m)\]\s*[^"\r\n]+/gi)].map((match) => match[0].trim());
}

function shortPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function fallbackSubtasksForTodo(todo: Todo): string[] {
  const goal = todo.title.trim() || "this goal";
  return [
    `[2m] Define the concrete done-state for "${goal}" in one sentence.`,
    `[5m] List the next physical action needed to move "${goal}" forward right now.`,
    `[2m] Start that action and log one blocker or next step.`,
  ];
}

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLastNDays(n: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (n - 1 - index));
    return {
      key: getDateKey(date),
      label: index === n - 1 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" }),
      subLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

function getLastNWeeks(n: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - day);
  return Array.from({ length: n }).map((_, index) => {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() - (n - 1 - index) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      start,
      end,
      label: index === n - 1 ? "This week" : `${start.getMonth() + 1}/${start.getDate()}`,
    };
  });
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
  const [habitsView, setHabitsView] = useState<HabitsView>("week");
  const [habits, setHabits] = useState<Habit[]>([]);
  const [newHabitName, setNewHabitName] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [newPredictionTitle, setNewPredictionTitle] = useState("");
  const [newPredictionConfidence, setNewPredictionConfidence] = useState(70);
  const [reflections, setReflections] = useState<ReflectionEntry[]>([]);
  const [selectedReflectionDate, setSelectedReflectionDate] = useState(getDateKey(new Date()));
  const [reflectionView, setReflectionView] = useState<ReflectionView>("today");
  const [showOptionalReflectionQuestions, setShowOptionalReflectionQuestions] = useState(false);
  const [expandedReflectionId, setExpandedReflectionId] = useState<string | null>(null);
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [expandingTodoId, setExpandingTodoId] = useState<string | null>(null);
  const [showAiSettingsModal, setShowAiSettingsModal] = useState(false);
  const [expandProvider, setExpandProvider] = useState<ExpandProvider>("gemini-flash");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [expandContextByTodoId, setExpandContextByTodoId] = useState<Record<string, string>>({});
  const [expansionContextTodoId, setExpansionContextTodoId] = useState<string | null>(null);
  const [expansionContextDraft, setExpansionContextDraft] = useState("");
  const [todoDrafts, setTodoDrafts] = useState<Record<string, string>>({});
  const [zoneImageOverrides, setZoneImageOverrides] = useState<Record<string, string>>({});
  const [blockedImages, setBlockedImages] = useState<string[]>([]);
  const [gold, setGold] = useState(0);
  const [rewardedTodoIds, setRewardedTodoIds] = useState<string[]>([]);
  const templateRef = useRef<HTMLDivElement | null>(null);
  const templateHostRef = useRef<HTMLDivElement | null>(null);
  const todoInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const goldAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const goldSoundTimeoutsRef = useRef<number[]>([]);
  const activeGoldAudioRef = useRef<HTMLAudioElement[]>([]);
  const goldCounterRef = useRef<HTMLDivElement | null>(null);
  const activeFlyingCoinNodesRef = useRef<HTMLSpanElement[]>([]);
  const accountabilityLoadedRef = useRef(false);
  const accountabilitySaveTimerRef = useRef<number | null>(null);
  const [focusTodoId, setFocusTodoId] = useState<string | null>(null);

  function stopGoldSoundPlayback() {
    goldSoundTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    goldSoundTimeoutsRef.current = [];
    activeGoldAudioRef.current.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    activeGoldAudioRef.current = [];
  }

  function goldSoundById(id: string) {
    return GOLD_SOUND_OPTIONS.find((option) => option.id === id) ?? GOLD_SOUND_OPTIONS[0];
  }

  function playGoldSound() {
    if (typeof window === "undefined") return;
    stopGoldSoundPlayback();
    const option = goldSoundById(DEFAULT_GOLD_SOUND_ID);
    option.steps.forEach((step) => {
      const timeoutId = window.setTimeout(() => {
        const baseAudio = goldAudioRefs.current.get(step.src) ?? new Audio(step.src);
        goldAudioRefs.current.set(step.src, baseAudio);
        const audio = baseAudio.cloneNode(true) as HTMLAudioElement;
        audio.volume = step.volume;
        audio.playbackRate = step.playbackRate ?? 1;
        audio.currentTime = step.startAtSec ?? 0;
        activeGoldAudioRef.current.push(audio);
        audio.addEventListener(
          "ended",
          () => {
            activeGoldAudioRef.current = activeGoldAudioRef.current.filter((entry) => entry !== audio);
          },
          { once: true },
        );
        void audio.play().catch(() => {});
        if (step.durationMs) {
          const stopTimeoutId = window.setTimeout(() => {
            audio.pause();
            activeGoldAudioRef.current = activeGoldAudioRef.current.filter((entry) => entry !== audio);
          }, step.durationMs);
          goldSoundTimeoutsRef.current.push(stopTimeoutId);
        }
      }, step.delayMs);
      goldSoundTimeoutsRef.current.push(timeoutId);
    });
  }

  function clearFlyingCoins() {
    activeFlyingCoinNodesRef.current.forEach((coin) => coin.remove());
    activeFlyingCoinNodesRef.current = [];
  }

  function launchFlyingCoins(sourceElement: HTMLInputElement | null) {
    if (typeof window === "undefined" || !sourceElement || !goldCounterRef.current) return;
    clearFlyingCoins();
    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = goldCounterRef.current.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    const counter = goldCounterRef.current;
    const coinConfigs = Array.from({ length: 5 }, (_, index) => ({
      left: startX + (index - 2) * 4,
      top: startY - index * 3,
      dx: endX - startX + (index - 2) * 10,
      dy: endY - startY - 10 - index * 4,
      delay: index * 55,
      duration: 760 + index * 35,
      rotation: (index % 2 === 0 ? 1 : -1) * (120 + index * 24),
      scale: 0.82 + index * 0.06,
    }));

    coinConfigs.forEach((coinConfig) => {
      const coin = document.createElement("span");
      coin.className = "gold-flight-coin";
      coin.textContent = "🪙";
      coin.style.left = `${coinConfig.left}px`;
      coin.style.top = `${coinConfig.top}px`;
      document.body.appendChild(coin);
      activeFlyingCoinNodesRef.current.push(coin);

      const animation = coin.animate(
        [
          {
            opacity: 0,
            transform: "translate(-50%, -50%) translate(0px, 0px) scale(0.4) rotate(0deg)",
            offset: 0,
          },
          {
            opacity: 1,
            transform: `translate(-50%, -50%) translate(0px, 0px) scale(${coinConfig.scale * 1.08}) rotate(${coinConfig.rotation * 0.12}deg)`,
            offset: 0.12,
          },
          {
            opacity: 1,
            transform: `translate(-50%, -50%) translate(${coinConfig.dx * 0.45}px, ${coinConfig.dy * 0.38 - 56}px) scale(${coinConfig.scale}) rotate(${coinConfig.rotation * 0.62}deg)`,
            offset: 0.55,
          },
          {
            opacity: 0,
            transform: `translate(-50%, -50%) translate(${coinConfig.dx}px, ${coinConfig.dy}px) scale(0.52) rotate(${coinConfig.rotation}deg)`,
            offset: 1,
          },
        ],
        {
          duration: coinConfig.duration,
          delay: coinConfig.delay,
          easing: "cubic-bezier(0.18, 0.82, 0.2, 1)",
          fill: "forwards",
        },
      );

      void animation.finished.finally(() => {
        coin.remove();
        activeFlyingCoinNodesRef.current = activeFlyingCoinNodesRef.current.filter((entry) => entry !== coin);
      });
    });

    void counter.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.08)" },
        { transform: "scale(1)" },
      ],
      {
        duration: 360,
        delay: 520,
        easing: "ease-out",
      },
    );
  }

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
      try {
        const rawRewarded = window.localStorage.getItem(REWARDED_TODOS_STORAGE_KEY);
        if (!rawRewarded) {
          const seededRewardedIds = todoData.items
            .filter((todo) => todo.status === "done")
            .map((todo) => todo.id);
          window.localStorage.setItem(REWARDED_TODOS_STORAGE_KEY, JSON.stringify(seededRewardedIds));
          setRewardedTodoIds(seededRewardedIds);
        }
      } catch {
        // ignore invalid local storage values
      }
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
    const uniqueSources = [...new Set(GOLD_SOUND_OPTIONS.flatMap((option) => option.steps.map((step) => step.src)))];
    goldAudioRefs.current = new Map(uniqueSources.map((source) => {
      const audio = new Audio(source);
      audio.preload = "auto";
      return [source, audio] as const;
    }));
    return () => {
      stopGoldSoundPlayback();
      goldAudioRefs.current.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      goldAudioRefs.current = new Map();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearFlyingCoins();
    };
  }, []);

  useEffect(() => {
    try {
      const rawGold = window.localStorage.getItem(GOLD_STORAGE_KEY);
      const parsedGold = rawGold ? Number(rawGold) : 0;
      if (Number.isFinite(parsedGold) && parsedGold >= 0) {
        setGold(Math.floor(parsedGold));
      }

      const rawRewarded = window.localStorage.getItem(REWARDED_TODOS_STORAGE_KEY);
      if (!rawRewarded) return;
      const parsedRewarded = JSON.parse(rawRewarded) as unknown;
      if (!Array.isArray(parsedRewarded)) return;
      setRewardedTodoIds(parsedRewarded.filter((value): value is string => typeof value === "string"));
    } catch {
      // ignore invalid local storage values
    }
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
    window.localStorage.setItem(GOLD_STORAGE_KEY, String(gold));
  }, [gold]);

  useEffect(() => {
    window.localStorage.setItem(REWARDED_TODOS_STORAGE_KEY, JSON.stringify(rewardedTodoIds));
  }, [rewardedTodoIds]);

  useEffect(() => {
    void runAction(async () => {
      const state = await getAccountabilityState();
      let nextHabits = state.habits;
      let nextPredictions = state.predictions;
      let nextReflections = state.reflections;

      const isApiEmpty =
        nextHabits.length === 0 && nextPredictions.length === 0 && nextReflections.length === 0;
      if (isApiEmpty) {
        try {
          const rawHabits = window.localStorage.getItem("slaythelist.habits");
          const rawPredictions = window.localStorage.getItem("slaythelist.predictions");
          const rawReflections = window.localStorage.getItem("slaythelist.reflections");
          if (rawHabits) {
            const parsed = JSON.parse(rawHabits) as Habit[];
            if (Array.isArray(parsed)) nextHabits = parsed;
          }
          if (rawPredictions) {
            const parsed = JSON.parse(rawPredictions) as Prediction[];
            if (Array.isArray(parsed)) nextPredictions = parsed;
          }
          if (rawReflections) {
            const parsed = JSON.parse(rawReflections) as ReflectionEntry[];
            if (Array.isArray(parsed)) nextReflections = parsed;
          }
          if (
            nextHabits.length > 0 ||
            nextPredictions.length > 0 ||
            nextReflections.length > 0
          ) {
            await saveAccountabilityState({
              habits: nextHabits,
              predictions: nextPredictions,
              reflections: nextReflections,
            });
          }
        } catch {
          // ignore invalid local storage migration values
        }
      }

      setHabits(nextHabits.map((habit) => ({ ...habit, status: habit.status ?? "active" })));
      setPredictions(nextPredictions);
      setReflections(nextReflections);
      accountabilityLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!accountabilityLoadedRef.current) return;
    if (accountabilitySaveTimerRef.current !== null) {
      window.clearTimeout(accountabilitySaveTimerRef.current);
    }
    accountabilitySaveTimerRef.current = window.setTimeout(() => {
      void runAction(async () => {
        await saveAccountabilityState({ habits, predictions, reflections });
      });
    }, 450);
    return () => {
      if (accountabilitySaveTimerRef.current !== null) {
        window.clearTimeout(accountabilitySaveTimerRef.current);
      }
    };
  }, [habits, predictions, reflections]);

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

  function toggleTodo(todo: Todo, sourceElement: HTMLInputElement | null = null) {
    const next = todo.status === "done" ? "active" : "done";
    const nowIso = new Date().toISOString();
    const shouldCelebrateCompletion = next === "done";
    const shouldAwardGold = shouldCelebrateCompletion && !rewardedTodoIds.includes(todo.id);
    if (shouldCelebrateCompletion) {
      playGoldSound();
      launchFlyingCoins(sourceElement);
    }
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
      if (shouldAwardGold) {
        setGold((previous) => previous + GOLD_PER_TODO);
        setRewardedTodoIds((previous) =>
          previous.includes(todo.id) ? previous : [...previous, todo.id],
        );
      }
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

  function saveAiSettings() {
    try {
      window.localStorage.setItem("slaythelist.ai.expandProvider", expandProvider);
      window.localStorage.setItem("slaythelist.ai.geminiApiKey", geminiApiKey.trim());
      window.localStorage.setItem("slaythelist.ai.openAiApiKey", openAiApiKey.trim());
      setError(null);
      setShowAiSettingsModal(false);
    } catch {
      setError("Failed to save AI settings.");
    }
  }

  function openExpansionContextModal(todo: Todo) {
    setExpansionContextTodoId(todo.id);
    setExpansionContextDraft(expandContextByTodoId[todo.id] ?? "");
  }

  function closeExpansionContextModal() {
    setExpansionContextTodoId(null);
    setExpansionContextDraft("");
  }

  function saveExpansionContextModal() {
    if (!expansionContextTodoId) return;
    const trimmed = expansionContextDraft.trim();
    setExpandContextByTodoId((previous) => {
      const next = { ...previous };
      if (trimmed) {
        next[expansionContextTodoId] = trimmed;
      } else {
        delete next[expansionContextTodoId];
      }
      return next;
    });
    closeExpansionContextModal();
  }

  function expansionPromptForTodo(todo: Todo, index: number): string {
    const parentContext: string[] = [];
    const siblingContext: string[] = [];
    for (let i = index - 1; i >= 0; i -= 1) {
      const previous = todos[i];
      if (previous.indent < todo.indent) {
        parentContext.unshift(previous.title.trim());
      } else if (previous.indent === todo.indent && previous.id !== todo.id) {
        siblingContext.unshift(previous.title.trim());
      }
    }
    const cleanParents = parentContext.filter((entry) => entry.length > 0);
    const cleanSiblings = siblingContext.filter((entry) => entry.length > 0).slice(-8);
    const userExpansionContext = expandContextByTodoId[todo.id]?.trim();
    return [
      "You are an execution coach for breaking one goal into tiny immediate actions.",
      "",
      `Goal to expand: "${todo.title.trim()}"`,
      todo.context ? `Goal context: ${todo.context}` : "",
      userExpansionContext ? `User-provided expansion context: ${userExpansionContext}` : "",
      cleanParents.length > 0 ? `Higher-level parent goals: ${cleanParents.join(" > ")}` : "",
      cleanSiblings.length > 0 ? `Sibling goals nearby: ${cleanSiblings.join(", ")}` : "",
      "",
      "Task design requirements:",
      "1) Think through end state, intermediate states, and real physical actions needed.",
      "2) Generate 3 to 5 subtasks that can each be done in 2 or 5 minutes.",
      "3) Start each subtask with either [2m] or [5m].",
      "4) Keep wording concrete and immediate (open, write, list, test, send, etc.).",
      "5) Avoid abstract planning language.",
      "",
      "Output format is STRICT:",
      "- Return ONLY a valid JSON array of strings",
      "- No markdown, no code fences, no commentary",
      "- If uncertain, still return exactly 3 strings in a JSON array",
      "Example:",
      "[\"[2m] Open the project and list the exact deliverable\", \"[5m] Draft the first tiny action and run it\"]",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async function generateSubtodosWithGemini(todo: Todo): Promise<string[]> {
    const apiKey = geminiApiKey.trim();
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Add it in AI settings.");
    }
    const index = todos.findIndex((entry) => entry.id === todo.id);
    if (index < 0) {
      throw new Error("Could not find todo to expand.");
    }
    const prompt = expansionPromptForTodo(todo, index);
    async function requestGemini(promptText: string) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0.45,
              maxOutputTokens: 900,
            },
          }),
        },
      );
      const payloadText = await response.text();
      let data: {
        error?: { message?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      } = {};
      try {
        data = JSON.parse(payloadText) as typeof data;
      } catch {
        // handled by checks below
      }
      if (!response.ok) {
        throw new Error(
          `Gemini API failed (${response.status}). ${data.error?.message ?? "Unknown API error."}`,
        );
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    const firstText = await requestGemini(prompt);
    if (!firstText.trim()) {
      throw new Error("Gemini returned an empty response body.");
    }
    let normalized = normalizeSubtasks(extractJsonArray(firstText));
    if (normalized.length < 3) {
      normalized = normalizeSubtasks(extractBracketTasks(firstText));
    }
    if (normalized.length >= 3) {
      return normalized.slice(0, 5);
    }
    const retryText = await requestGemini(
      `${prompt}\n\nRETRY: Your previous output did not parse. Return ONLY a valid JSON array with 3-5 strings.`,
    );
    let retryNormalized = normalizeSubtasks(extractJsonArray(retryText));
    if (retryNormalized.length < 3) {
      retryNormalized = normalizeSubtasks(extractBracketTasks(retryText));
    }
    const merged = normalizeSubtasks([...normalized, ...retryNormalized]);
    if (merged.length >= 3) {
      return merged.slice(0, 5);
    }
    if (merged.length > 0) {
      const completed = normalizeSubtasks([...merged, ...fallbackSubtasksForTodo(todo)]);
      if (completed.length >= 3) {
        return completed.slice(0, 5);
      }
    }
    if (retryNormalized.length < 3) {
      throw new Error(
        `Gemini parse/format issue. First parse recovered ${normalized.length}; retry recovered ${retryNormalized.length}. ` +
          `First preview: "${shortPreview(firstText)}" | Retry preview: "${shortPreview(retryText)}"`,
      );
    }
    return retryNormalized.slice(0, 5);
  }

  async function generateSubtodosWithOpenAI(todo: Todo): Promise<string[]> {
    const apiKey = openAiApiKey.trim();
    if (!apiKey) {
      throw new Error("OpenAI API key is missing. Add it in AI settings.");
    }
    const index = todos.findIndex((entry) => entry.id === todo.id);
    if (index < 0) {
      throw new Error("Could not find todo to expand.");
    }
    const prompt = expansionPromptForTodo(todo, index);
    async function requestOpenAi(userPrompt: string) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Return only a valid JSON array of 3 to 5 strings. No markdown, no code fences, no explanations.",
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.45,
        }),
      });
      const payloadText = await response.text();
      let data: {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
      } = {};
      try {
        data = JSON.parse(payloadText) as typeof data;
      } catch {
        // handled by checks below
      }
      if (!response.ok) {
        throw new Error(
          `OpenAI API failed (${response.status}). ${data.error?.message ?? "Unknown API error."}`,
        );
      }
      return data.choices?.[0]?.message?.content ?? "";
    }

    const firstText = await requestOpenAi(prompt);
    if (!firstText.trim()) {
      throw new Error("OpenAI returned an empty response body.");
    }
    let normalized = normalizeSubtasks(extractJsonArray(firstText));
    if (normalized.length < 3) {
      normalized = normalizeSubtasks(extractBracketTasks(firstText));
    }
    if (normalized.length >= 3) {
      return normalized.slice(0, 5);
    }
    const retryText = await requestOpenAi(
      `${prompt}\n\nRETRY: Your previous output did not parse. Return ONLY a valid JSON array with 3-5 strings.`,
    );
    let retryNormalized = normalizeSubtasks(extractJsonArray(retryText));
    if (retryNormalized.length < 3) {
      retryNormalized = normalizeSubtasks(extractBracketTasks(retryText));
    }
    const merged = normalizeSubtasks([...normalized, ...retryNormalized]);
    if (merged.length >= 3) {
      return merged.slice(0, 5);
    }
    if (merged.length > 0) {
      const completed = normalizeSubtasks([...merged, ...fallbackSubtasksForTodo(todo)]);
      if (completed.length >= 3) {
        return completed.slice(0, 5);
      }
    }
    if (retryNormalized.length < 3) {
      throw new Error(
        `OpenAI parse/format issue. First parse recovered ${normalized.length}; retry recovered ${retryNormalized.length}. ` +
          `First preview: "${shortPreview(firstText)}" | Retry preview: "${shortPreview(retryText)}"`,
      );
    }
    return retryNormalized.slice(0, 5);
  }

  async function insertExpandedSubtodos(parentTodo: Todo, subtasks: string[]) {
    const latestTodos = (await listTodos()).items;
    const parentIndex = latestTodos.findIndex((entry) => entry.id === parentTodo.id);
    if (parentIndex < 0) return;
    let insertAt = parentIndex + 1;
    while (insertAt < latestTodos.length && latestTodos[insertAt].indent > parentTodo.indent) {
      insertAt += 1;
    }
    const parentDeadline = parentTodo.deadlineAt ?? getDefaultDeadline(todoRange);
    const createdIds: string[] = [];
    for (const title of subtasks) {
      const created = await createTodo(title, { deadlineAt: parentDeadline });
      createdIds.push(created.id);
      await updateTodo(created.id, { indent: parentTodo.indent + 1 });
    }
    const baseOrder = latestTodos.map((entry) => entry.id).filter((id) => !createdIds.includes(id));
    baseOrder.splice(insertAt, 0, ...createdIds);
    const reordered = await reorderTodos(baseOrder);
    setTodos(reordered.items);
  }

  function handleExpandTodo(todo: Todo) {
    if (expandingTodoId) return;
    if (expandProvider === "gemini-flash" && !geminiApiKey.trim()) {
      setShowAiSettingsModal(true);
      setError("Add a Gemini API key in AI settings to use expansion.");
      return;
    }
    if (expandProvider === "openai-gpt-4o-mini" && !openAiApiKey.trim()) {
      setShowAiSettingsModal(true);
      setError("Add an OpenAI API key in AI settings to use expansion.");
      return;
    }
    setExpandingTodoId(todo.id);
    void runAction(async () => {
      const generated =
        expandProvider === "gemini-flash"
          ? await generateSubtodosWithGemini(todo)
          : await generateSubtodosWithOpenAI(todo);
      await insertExpandedSubtodos(todo, generated);
    }).finally(() => {
      setExpandingTodoId(null);
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
    try {
      const providerRaw = window.localStorage.getItem("slaythelist.ai.expandProvider");
      const storedGemini = window.localStorage.getItem("slaythelist.ai.geminiApiKey");
      const storedOpenAi = window.localStorage.getItem("slaythelist.ai.openAiApiKey");
      const storedExpandContext = window.localStorage.getItem("slaythelist.ai.expandContextByTodoId");
      if (providerRaw === "gemini-flash" || providerRaw === "openai-gpt-4o-mini") {
        setExpandProvider(providerRaw);
      }
      if (storedGemini) setGeminiApiKey(storedGemini);
      if (storedOpenAi) setOpenAiApiKey(storedOpenAi);
      if (storedExpandContext) {
        const parsed = JSON.parse(storedExpandContext) as Record<string, unknown>;
        const next: Record<string, string> = {};
        for (const [todoId, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value.trim().length > 0) {
            next[todoId] = value;
          }
        }
        setExpandContextByTodoId(next);
      }
    } catch {
      // ignore local storage access issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "slaythelist.ai.expandContextByTodoId",
        JSON.stringify(expandContextByTodoId),
      );
    } catch {
      // ignore local storage save issues
    }
  }, [expandContextByTodoId]);

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

  const habitDays = useMemo(() => getLastNDays(7), []);
  const habitWeeks = useMemo(() => getLastNWeeks(5), []);
  const todayKey = getDateKey(new Date());

  function addHabit() {
    const nextName = newHabitName.trim();
    if (!nextName) return;
    setHabits((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: nextName,
        checks: [],
        createdAt: Date.now(),
        status: "active",
      },
    ]);
    setNewHabitName("");
  }

  function toggleHabitDay(habitId: string, dateKey: string) {
    setHabits((prev) =>
      prev.map((habit) => {
        if (habit.id !== habitId) return habit;
        const hasCheck = habit.checks.some((check) => check.date === dateKey && check.done);
        return {
          ...habit,
          checks: hasCheck
            ? habit.checks.filter((check) => check.date !== dateKey)
            : [...habit.checks.filter((check) => check.date !== dateKey), { date: dateKey, done: true }],
        };
      }),
    );
  }

  function toggleHabitWeek(habitId: string, weekStart: Date, weekEnd: Date) {
    setHabits((prev) =>
      prev.map((habit) => {
        if (habit.id !== habitId) return habit;
        const doneInWeek = habit.checks.some((check) => {
          if (!check.done) return false;
          const checkDate = new Date(`${check.date}T00:00:00`);
          return checkDate >= weekStart && checkDate <= weekEnd;
        });
        if (doneInWeek) {
          return {
            ...habit,
            checks: habit.checks.filter((check) => {
              const checkDate = new Date(`${check.date}T00:00:00`);
              return checkDate < weekStart || checkDate > weekEnd;
            }),
          };
        }
        return {
          ...habit,
          checks: [...habit.checks, { date: getDateKey(weekEnd), done: true }],
        };
      }),
    );
  }

  function deleteHabit(habitId: string) {
    setHabits((prev) => prev.filter((habit) => habit.id !== habitId));
  }

  function setHabitStatus(habitId: string, status: HabitStatus) {
    setHabits((prev) =>
      prev.map((habit) => (habit.id === habitId ? { ...habit, status } : habit)),
    );
  }

  const activeHabits = useMemo(
    () => habits.filter((habit) => (habit.status ?? "active") === "active"),
    [habits],
  );
  const ideaHabits = useMemo(
    () => habits.filter((habit) => habit.status === "idea"),
    [habits],
  );
  const archivedHabits = useMemo(
    () => habits.filter((habit) => habit.status === "archived"),
    [habits],
  );

  function addPrediction() {
    const title = newPredictionTitle.trim();
    if (!title) return;
    setPredictions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title,
        confidence: Math.max(1, Math.min(99, newPredictionConfidence)),
        outcome: "pending",
        createdAt: Date.now(),
        resolvedAt: null,
      },
    ]);
    setNewPredictionTitle("");
    setNewPredictionConfidence(70);
  }

  function setPredictionOutcome(predictionId: string, outcome: PredictionOutcome) {
    setPredictions((prev) =>
      prev.map((prediction) =>
        prediction.id === predictionId
          ? {
              ...prediction,
              outcome,
              resolvedAt: outcome === "pending" ? null : Date.now(),
            }
          : prediction,
      ),
    );
  }

  function deletePrediction(predictionId: string) {
    setPredictions((prev) => prev.filter((prediction) => prediction.id !== predictionId));
  }

  const resolvedPredictions = useMemo(
    () => predictions.filter((prediction) => prediction.outcome !== "pending"),
    [predictions],
  );
  const calibrationAccuracy = useMemo(() => {
    if (resolvedPredictions.length === 0) return null;
    const total = resolvedPredictions.length;
    const hits = resolvedPredictions.filter((prediction) => prediction.outcome === "hit").length;
    return Math.round((hits / total) * 100);
  }, [resolvedPredictions]);
  const averageConfidence = useMemo(() => {
    if (resolvedPredictions.length === 0) return null;
    const sum = resolvedPredictions.reduce((acc, prediction) => acc + prediction.confidence, 0);
    return Math.round(sum / resolvedPredictions.length);
  }, [resolvedPredictions]);

  const coreReflectionQuestions = DEFAULT_CORE_REFLECTION_QUESTIONS;
  const optionalReflectionQuestions = DEFAULT_OPTIONAL_REFLECTION_QUESTIONS;
  const visibleReflectionQuestions = useMemo(
    () => [
      ...coreReflectionQuestions,
      ...(showOptionalReflectionQuestions ? optionalReflectionQuestions : []),
    ],
    [showOptionalReflectionQuestions],
  );

  const activeReflection = useMemo(() => {
    const existing = reflections.find((entry) => entry.date === selectedReflectionDate);
    if (existing) return existing;
    return {
      id: crypto.randomUUID(),
      date: selectedReflectionDate,
      prompts: {
        wins: "",
        challenges: "",
        learnings: "",
        tomorrow: "",
        gratitude: "",
      },
      items: {},
      wins: "",
      challenges: "",
      notes: "",
      tomorrow: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies ReflectionEntry;
  }, [reflections, selectedReflectionDate]);

  function reflectionPrompt(entry: ReflectionEntry, key: string): string {
    if (entry.prompts?.[key]) return entry.prompts[key] ?? "";
    if (key === "wins") return entry.wins;
    if (key === "challenges" || key === "problems") return entry.challenges;
    if (key === "learnings") return entry.notes;
    if (key === "tomorrow") return entry.tomorrow;
    return "";
  }

  function upsertSelectedReflection(
    updater: (entry: ReflectionEntry) => ReflectionEntry,
  ) {
    setReflections((prev) => {
      const index = prev.findIndex((entry) => entry.date === selectedReflectionDate);
      if (index < 0) {
        return [...prev, updater(activeReflection)];
      }
      const next = [...prev];
      next[index] = updater(next[index]);
      return next;
    });
  }

  function updateReflectionPrompt(key: string, value: string) {
    const now = Date.now();
    upsertSelectedReflection((entry) => {
      const prompts = {
        wins: "",
        challenges: "",
        learnings: "",
        tomorrow: "",
        gratitude: "",
        ...(entry.prompts ?? {}),
        [key]: value,
      };
      return {
        ...entry,
        prompts,
        wins: key === "wins" ? value : entry.wins,
        challenges: key === "challenges" || key === "problems" ? value : entry.challenges,
        notes: key === "learnings" ? value : entry.notes,
        tomorrow: key === "tomorrow" ? value : entry.tomorrow,
        updatedAt: now,
      };
    });
  }

  function reflectionItems(entry: ReflectionEntry, key: string): string[] {
    const fromItems = entry.items?.[key] ?? [];
    if (fromItems.length > 0) return fromItems;
    const fallback = reflectionPrompt(entry, key);
    return fallback ? [fallback] : [];
  }

  function addReflectionItem(questionKey: string) {
    const now = Date.now();
    upsertSelectedReflection((entry) => {
      const existing = reflectionItems(entry, questionKey);
      return {
        ...entry,
        items: {
          ...(entry.items ?? {}),
          [questionKey]: [...existing, ""],
        },
        updatedAt: now,
      };
    });
  }

  function updateReflectionItem(questionKey: string, index: number, value: string) {
    const now = Date.now();
    upsertSelectedReflection((entry) => {
      const existing = reflectionItems(entry, questionKey);
      const nextItems = [...existing];
      nextItems[index] = value;
      const joined = nextItems.filter((item) => item.trim()).join("\n");
      return {
        ...entry,
        items: {
          ...(entry.items ?? {}),
          [questionKey]: nextItems,
        },
        prompts: {
          wins: "",
          challenges: "",
          learnings: "",
          tomorrow: "",
          gratitude: "",
          ...(entry.prompts ?? {}),
          [questionKey]: joined,
        },
        wins: questionKey === "wins" ? joined : entry.wins,
        challenges: questionKey === "challenges" || questionKey === "problems" ? joined : entry.challenges,
        notes: questionKey === "learnings" ? joined : entry.notes,
        tomorrow: questionKey === "tomorrow" ? joined : entry.tomorrow,
        updatedAt: now,
      };
    });
  }

  function removeReflectionItem(questionKey: string, index: number) {
    const now = Date.now();
    upsertSelectedReflection((entry) => {
      const existing = reflectionItems(entry, questionKey);
      const nextItems = existing.filter((_, i) => i !== index);
      const joined = nextItems.filter((item) => item.trim()).join("\n");
      return {
        ...entry,
        items: {
          ...(entry.items ?? {}),
          [questionKey]: nextItems,
        },
        prompts: {
          wins: "",
          challenges: "",
          learnings: "",
          tomorrow: "",
          gratitude: "",
          ...(entry.prompts ?? {}),
          [questionKey]: joined,
        },
        wins: questionKey === "wins" ? joined : entry.wins,
        challenges: questionKey === "challenges" || questionKey === "problems" ? joined : entry.challenges,
        notes: questionKey === "learnings" ? joined : entry.notes,
        tomorrow: questionKey === "tomorrow" ? joined : entry.tomorrow,
        updatedAt: now,
      };
    });
  }

  const sortedReflections = useMemo(
    () =>
      [...reflections]
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .filter((entry) => {
          const promptValues = Object.values(entry.prompts ?? {}).some((value) => value.trim().length > 0);
          const itemValues = Object.values(entry.items ?? {}).some((items) =>
            items.some((item) => item.trim().length > 0),
          );
          return promptValues || itemValues || entry.wins || entry.challenges || entry.notes || entry.tomorrow;
        }),
    [reflections],
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>SlayTheList</h1>
          <p>Complete todos to unlock blocked game regions.</p>
        </div>
        <div ref={goldCounterRef} className="gold-counter" aria-label={`${gold} gold`}>
          <span className="gold-counter-icon" aria-hidden="true">
            🪙
          </span>
          <span className="gold-counter-value">{gold}</span>
          <span className="gold-counter-label">gold</span>
        </div>
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
                <button
                  type="button"
                  className="goals-subtab"
                  onClick={() => setActiveTab("habits")}
                >
                  Habits
                </button>
                <button
                  type="button"
                  className="goals-subtab"
                  onClick={() => setActiveTab("predictions")}
                >
                  Predictions
                </button>
                <button
                  type="button"
                  className="goals-subtab"
                  onClick={() => setActiveTab("reflection")}
                >
                  Reflection
                </button>
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
                <button
                  type="button"
                  className="goals-copy-btn"
                  onClick={() => setShowAiSettingsModal(true)}
                  title="AI settings"
                  aria-label="AI settings"
                >
                  ⚙
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
                        onChange={(event) => toggleTodo(todo, event.currentTarget)}
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
                          <button
                            type="button"
                            className="goal-expand-btn"
                            onClick={() => handleExpandTodo(todo)}
                            disabled={expandingTodoId === todo.id}
                            title="AI expand into 3-5 subtasks"
                            aria-label="AI expand into 3-5 subtasks"
                          >
                            {expandingTodoId === todo.id ? "…" : "+"}
                          </button>
                        )}
                        {!todo.archivedAt && (
                          <button
                            type="button"
                            className={`goal-context-btn ${expandContextByTodoId[todo.id] ? "has-context" : ""}`}
                            onClick={() => openExpansionContextModal(todo)}
                            title="Add expansion context"
                            aria-label="Add expansion context"
                          >
                            🎤
                          </button>
                        )}
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

          {activeTab === "habits" && (
          <section className="tab-pane goals-board">
            <div className="goals-topbar">
              <nav className="goals-subtabs" aria-label="Accountability sections">
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("goals")}>
                  Goals
                </button>
                <button type="button" className="goals-subtab active" onClick={() => setActiveTab("habits")}>
                  Habits
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("predictions")}>
                  Predictions
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("reflection")}>
                  Reflection
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("blocks")}>
                  Block Setup
                </button>
              </nav>
              <div className="goals-filters">
                <button
                  type="button"
                  className={`goals-subtab ${habitsView === "week" ? "active" : ""}`}
                  onClick={() => setHabitsView("week")}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`goals-subtab ${habitsView === "month" ? "active" : ""}`}
                  onClick={() => setHabitsView("month")}
                >
                  Month
                </button>
              </div>
            </div>
            <div className="habits-grid">
              <div className="habits-add">
                <input
                  value={newHabitName}
                  onChange={(event) => setNewHabitName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addHabit();
                    }
                  }}
                  placeholder="Add a habit..."
                />
                <button type="button" onClick={addHabit}>Add</button>
              </div>
              <div className="habits-meta">
                <small>Ideas: {ideaHabits.length}</small>
                <small>Archived: {archivedHabits.length}</small>
              </div>
              {activeHabits.length === 0 ? (
                <p className="goals-empty">No habits yet.</p>
              ) : (
                <table className="habits-table">
                  <thead>
                    <tr>
                      <th>Habit</th>
                      {habitsView === "week"
                        ? habitDays.map((day) => (
                            <th key={day.key}>
                              <div>{day.label}</div>
                              <small>{day.subLabel}</small>
                            </th>
                          ))
                        : habitWeeks.map((week) => (
                            <th key={week.start.toISOString()}>{week.label}</th>
                          ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeHabits.map((habit) => (
                      <tr key={habit.id}>
                        <td>
                          <div className="habit-name-cell">
                            <input
                              value={habit.name}
                              onChange={(event) =>
                                setHabits((prev) =>
                                  prev.map((h) => (h.id === habit.id ? { ...h, name: event.target.value } : h)),
                                )
                              }
                            />
                            <button type="button" onClick={() => setHabitStatus(habit.id, "idea")}>Idea</button>
                            <button type="button" onClick={() => setHabitStatus(habit.id, "archived")}>
                              Archive
                            </button>
                            <button type="button" onClick={() => deleteHabit(habit.id)}>Delete</button>
                          </div>
                        </td>
                        {habitsView === "week"
                          ? habitDays.map((day) => {
                              const done = habit.checks.some((check) => check.date === day.key && check.done);
                              return (
                                <td key={`${habit.id}:${day.key}`}>
                                  <button
                                    type="button"
                                    className={`habit-check ${done ? "done" : ""}`}
                                    onClick={() => toggleHabitDay(habit.id, day.key)}
                                    aria-label={`Mark ${habit.name} for ${day.label}`}
                                  >
                                    {done ? "✓" : ""}
                                  </button>
                                </td>
                              );
                            })
                          : habitWeeks.map((week) => {
                              const done = habit.checks.some((check) => {
                                if (!check.done) return false;
                                const checkDate = new Date(`${check.date}T00:00:00`);
                                return checkDate >= week.start && checkDate <= week.end;
                              });
                              return (
                                <td key={`${habit.id}:${week.start.toISOString()}`}>
                                  <button
                                    type="button"
                                    className={`habit-check ${done ? "done" : ""}`}
                                    onClick={() => toggleHabitWeek(habit.id, week.start, week.end)}
                                  >
                                    {done ? "✓" : ""}
                                  </button>
                                </td>
                              );
                            })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(ideaHabits.length > 0 || archivedHabits.length > 0) && (
                <div className="habits-side-lists">
                  {ideaHabits.length > 0 && (
                    <div>
                      <strong>Ideas</strong>
                      <ul className="goals-list">
                        {ideaHabits.map((habit) => (
                          <li key={`idea:${habit.id}`} className="goal-row">
                            <span>{habit.name}</span>
                            <div className="prediction-actions">
                              <button type="button" onClick={() => setHabitStatus(habit.id, "active")}>
                                Activate
                              </button>
                              <button type="button" onClick={() => deleteHabit(habit.id)}>Delete</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {archivedHabits.length > 0 && (
                    <div>
                      <strong>Archived</strong>
                      <ul className="goals-list">
                        {archivedHabits.map((habit) => (
                          <li key={`archived:${habit.id}`} className="goal-row">
                            <span>{habit.name}</span>
                            <div className="prediction-actions">
                              <button type="button" onClick={() => setHabitStatus(habit.id, "active")}>
                                Restore
                              </button>
                              <button type="button" onClick={() => deleteHabit(habit.id)}>Delete</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          )}

          {activeTab === "predictions" && (
          <section className="tab-pane goals-board">
            <div className="goals-topbar">
              <nav className="goals-subtabs" aria-label="Accountability sections">
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("goals")}>Goals</button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("habits")}>Habits</button>
                <button type="button" className="goals-subtab active" onClick={() => setActiveTab("predictions")}>
                  Predictions
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("reflection")}>
                  Reflection
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("blocks")}>
                  Block Setup
                </button>
              </nav>
            </div>
            <div className="predictions-top">
              <p className="goals-progress">
                Calibration: {calibrationAccuracy ?? "—"}% accuracy / {averageConfidence ?? "—"}% avg confidence
              </p>
              <div className="prediction-add">
                <input
                  value={newPredictionTitle}
                  onChange={(event) => setNewPredictionTitle(event.target.value)}
                  placeholder="Add a prediction..."
                />
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={newPredictionConfidence}
                  onChange={(event) => {
                    const numeric = Number(event.target.value);
                    setNewPredictionConfidence(Number.isFinite(numeric) ? numeric : 70);
                  }}
                />
                <button type="button" onClick={addPrediction}>Add</button>
              </div>
            </div>
            {predictions.length === 0 ? (
              <p className="goals-empty">No predictions yet.</p>
            ) : (
              <ul className="goals-list">
                {predictions.map((prediction) => (
                  <li key={prediction.id} className="goal-row">
                    <div className="prediction-row">
                      <span>{prediction.title}</span>
                      <small>{prediction.confidence}%</small>
                    </div>
                    <div className="prediction-actions">
                      <button type="button" onClick={() => setPredictionOutcome(prediction.id, "hit")}>Hit</button>
                      <button type="button" onClick={() => setPredictionOutcome(prediction.id, "miss")}>Miss</button>
                      <button type="button" onClick={() => setPredictionOutcome(prediction.id, "pending")}>
                        Pending
                      </button>
                      <button type="button" onClick={() => deletePrediction(prediction.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}

          {activeTab === "reflection" && (
          <section className="tab-pane goals-board">
            <div className="goals-topbar">
              <nav className="goals-subtabs" aria-label="Accountability sections">
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("goals")}>Goals</button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("habits")}>Habits</button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("predictions")}>
                  Predictions
                </button>
                <button type="button" className="goals-subtab active" onClick={() => setActiveTab("reflection")}>
                  Reflection
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("blocks")}>
                  Block Setup
                </button>
              </nav>
              <div className="goals-filters">
                <button
                  type="button"
                  className={`goals-subtab ${reflectionView === "today" ? "active" : ""}`}
                  onClick={() => setReflectionView("today")}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`goals-subtab ${reflectionView === "history" ? "active" : ""}`}
                  onClick={() => setReflectionView("history")}
                >
                  History
                </button>
                <input
                  type="date"
                  value={selectedReflectionDate}
                  onChange={(event) => setSelectedReflectionDate(event.target.value || todayKey)}
                />
              </div>
            </div>
            {reflectionView === "today" ? (
              <>
                <div className="reflection-controls">
                  <button
                    type="button"
                    onClick={() => setShowOptionalReflectionQuestions((prev) => !prev)}
                  >
                    {showOptionalReflectionQuestions ? "Hide optional prompts" : "Show optional prompts"}
                  </button>
                </div>
                <div className="reflection-grid">
                  {visibleReflectionQuestions.map((question) => {
                    const items = reflectionItems(activeReflection, question.key);
                    return (
                      <label key={`reflection-question:${question.key}`}>
                        {question.label}
                        {items.length === 0 ? (
                          <textarea
                            value={reflectionPrompt(activeReflection, question.key)}
                            onChange={(event) => updateReflectionPrompt(question.key, event.target.value)}
                            placeholder={question.placeholder}
                          />
                        ) : (
                          <div className="reflection-items">
                            {items.map((item, index) => (
                              <div key={`reflection-item:${question.key}:${index}`} className="reflection-item-row">
                                <textarea
                                  value={item}
                                  onChange={(event) =>
                                    updateReflectionItem(question.key, index, event.target.value)
                                  }
                                  placeholder={question.placeholder}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeReflectionItem(question.key, index)}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button type="button" onClick={() => addReflectionItem(question.key)}>
                          Add item
                        </button>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <h3 className="reflection-history-title">Recent reflections</h3>
                {sortedReflections.length === 0 ? (
                  <p className="goals-empty">No reflections yet.</p>
                ) : (
                  <ul className="goals-list">
                    {sortedReflections.slice(0, 20).map((entry) => {
                      const expanded = expandedReflectionId === entry.id;
                      return (
                        <li key={entry.id} className="goal-row">
                          <div className="prediction-row">
                            <strong>{entry.date}</strong>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReflectionId((prev) => (prev === entry.id ? null : entry.id))
                              }
                            >
                              {expanded ? "Collapse" : "Expand"}
                            </button>
                          </div>
                          {expanded && (
                            <div className="reflection-history-details">
                              {[...coreReflectionQuestions, ...optionalReflectionQuestions].map((question) => {
                                const values = reflectionItems(entry, question.key).filter(
                                  (item) => item.trim().length > 0,
                                );
                                if (values.length === 0) return null;
                                return (
                                  <div key={`reflection-history:${entry.id}:${question.key}`}>
                                    <small>{question.label}</small>
                                    {values.map((value, index) => (
                                      <p key={`reflection-history-value:${entry.id}:${question.key}:${index}`}>
                                        {value}
                                      </p>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
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
              <button
                type="button"
                className="goals-subtab"
                onClick={() => setActiveTab("habits")}
              >
                Habits
              </button>
              <button
                type="button"
                className="goals-subtab"
                onClick={() => setActiveTab("predictions")}
              >
                Predictions
              </button>
              <button
                type="button"
                className="goals-subtab"
                onClick={() => setActiveTab("reflection")}
              >
                Reflection
              </button>
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
              <div className="todo-edit-deadline-row">
                <input
                  type="date"
                  value={editDeadline}
                  onChange={(event) => setEditDeadline(event.target.value)}
                />
                <button
                  type="button"
                  className="todo-edit-deadline-plus"
                  onClick={() => setEditDeadline(tomorrowDateInputValue())}
                  title="Set deadline to tomorrow"
                  aria-label="Set deadline to tomorrow"
                >
                  +
                </button>
              </div>
            </label>
            <div className="todo-edit-modal-actions">
              <button type="button" onClick={closeEditModal}>Cancel</button>
              <button type="button" onClick={saveEditModal}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showAiSettingsModal && (
        <div
          className="todo-edit-modal-backdrop"
          role="presentation"
          onClick={() => setShowAiSettingsModal(false)}
        >
          <div
            className="todo-edit-modal ai-settings-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>AI settings</h3>
            <label>
              Expand provider
              <select
                value={expandProvider}
                onChange={(event) => setExpandProvider(event.target.value as ExpandProvider)}
              >
                <option value="gemini-flash">Gemini Flash (expand)</option>
                <option value="openai-gpt-4o-mini">OpenAI GPT-4o mini (expand)</option>
              </select>
            </label>
            <label>
              Gemini API key
              <input
                type="password"
                value={geminiApiKey}
                onChange={(event) => setGeminiApiKey(event.target.value)}
                placeholder="AIza..."
              />
            </label>
            <label>
              OpenAI API key (optional)
              <input
                type="password"
                value={openAiApiKey}
                onChange={(event) => setOpenAiApiKey(event.target.value)}
                placeholder="sk-..."
              />
            </label>
            <p className="ai-settings-hint">
              Expansion prompt asks for end state, intermediate states, and concrete physical actions, then creates 3-5
              subtasks prefixed with [2m] or [5m].
            </p>
            <div className="todo-edit-modal-actions">
              <button type="button" onClick={() => setShowAiSettingsModal(false)}>Cancel</button>
              <button type="button" onClick={saveAiSettings}>Save</button>
            </div>
          </div>
        </div>
      )}
      {expansionContextTodoId && (
        <div className="todo-edit-modal-backdrop" role="presentation" onClick={closeExpansionContextModal}>
          <div
            className="todo-edit-modal ai-settings-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Expansion context</h3>
            <label>
              Optional context for AI expansion
              <textarea
                className="ai-context-textarea"
                value={expansionContextDraft}
                onChange={(event) => setExpansionContextDraft(event.target.value)}
                placeholder="Add any extra context for the AI, constraints, desired output style, assumptions, etc."
              />
            </label>
            <p className="ai-settings-hint">
              This note is added to the expansion prompt for this specific todo only.
            </p>
            <div className="todo-edit-modal-actions">
              <button type="button" onClick={closeExpansionContextModal}>Cancel</button>
              <button type="button" onClick={saveExpansionContextModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
