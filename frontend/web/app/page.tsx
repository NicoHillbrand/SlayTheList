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
  GameState,
  GameStateReferenceImage,
  Habit,
  HabitStatus,
  LockZone,
  LockZoneUnlockMode,
  OverlayState,
  Prediction,
  PredictionOutcome,
  ReflectionEntry,
  Todo,
} from "@slaythelist/contracts";
import {
  createGameState as createGameStateApi,
  createTodo,
  createZone,
  clearZoneGoldUnlock,
  deleteGameState as deleteGameStateApi,
  deleteReferenceImage as deleteReferenceImageApi,
  deleteTodo,
  deleteZone,
  getAccountabilityState,
  getGoldState,
  getOverlayState,
  listReferenceImages,
  listTodos,
  listZones,
  overlayWebSocketUrl,
  purchaseZoneGoldUnlock,
  referenceImageUrl,
  reorderTodos,
  saveGoldState,
  saveAccountabilityState,
  setDetectedGameState as setDetectedGameStateApi,
  testDetection as testDetectionApi,
  type DetectionTestResult,
  setZoneGameStates as setZoneGameStatesApi,
  awardGold as awardGoldApi,
  awardTodoGold as awardTodoGoldApi,
  setTodoStatus,
  setZoneRequirements,
  updateGameState as updateGameStateApi,
  updateTodo,
  updateZone,
  uploadReferenceImage,
} from "../lib/api";
import SocialModal from "./social-modal";

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
type ViewTab = "goals" | "habits" | "predictions" | "reflection" | "blocks" | "social";
type TodoFilter = "active" | "completed" | "archived" | "all";
type TodoRange = "daily" | "weekly" | "monthly" | "all" | "top";
type HabitsView = "week" | "month";
type HabitsSubtab = "ideas" | "week" | "month";
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
const ZONE_IMAGE_OVERRIDES_STORAGE_KEY = "slaythelist.zoneImageOverrides";
const AI_EXPAND_PROVIDER_STORAGE_KEY = "slaythelist.ai.expandProvider";
const AI_GEMINI_API_KEY_STORAGE_KEY = "slaythelist.ai.geminiApiKey";
const AI_OPENAI_API_KEY_STORAGE_KEY = "slaythelist.ai.openAiApiKey";
const AI_EXPAND_CONTEXT_STORAGE_KEY = "slaythelist.ai.expandContextByTodoId";
const LEGACY_HABITS_STORAGE_KEY = "slaythelist.habits";
const LEGACY_PREDICTIONS_STORAGE_KEY = "slaythelist.predictions";
const LEGACY_REFLECTIONS_STORAGE_KEY = "slaythelist.reflections";
const PREDICTION_CALIBRATION_RESET_AT_STORAGE_KEY = "slaythelist.predictions.calibrationResetAt";
const DEFAULT_PREDICTION_CONFIDENCE = 95;
const CALIBRATION_CHART_WIDTH = 320;
const CALIBRATION_CHART_HEIGHT = 190;
const CALIBRATION_CHART_PADDING = { top: 16, right: 18, bottom: 28, left: 34 };
const ZONE_GOLD_UNLOCK_COST = 10;
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

function lockMessage(requiredTodoTitles: string[], unlockMode: LockZoneUnlockMode) {
  if (unlockMode === "gold") {
    return `Unlock for\n\n${ZONE_GOLD_UNLOCK_COST} gold`;
  }
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

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
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

function calculateHabitDayStreak(habit: Habit, endDateKey: string) {
  const doneDates = new Set(habit.checks.filter((check) => check.done).map((check) => check.date));
  let streak = 0;
  const cursor = parseDateKey(endDateKey);
  cursor.setHours(0, 0, 0, 0);
  while (doneDates.has(getDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function calculateHabitWeekStreak(habit: Habit, weekStart: Date, weekEnd: Date) {
  let streak = 0;
  const checks = habit.checks.filter((check) => check.done);
  const currentStart = new Date(weekStart);
  const currentEnd = new Date(weekEnd);
  currentStart.setHours(0, 0, 0, 0);
  currentEnd.setHours(23, 59, 59, 999);

  while (true) {
    const hasCheckInWeek = checks.some((check) => {
      const checkDate = parseDateKey(check.date);
      return checkDate >= currentStart && checkDate <= currentEnd;
    });
    if (!hasCheckInWeek) return streak;
    streak += 1;
    currentStart.setDate(currentStart.getDate() - 7);
    currentEnd.setDate(currentEnd.getDate() - 7);
  }
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
  const [habitsSubtab, setHabitsSubtab] = useState<HabitsSubtab>("week");
  const [habits, setHabits] = useState<Habit[]>([]);
  const [newHabitName, setNewHabitName] = useState("");
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [newPredictionTitle, setNewPredictionTitle] = useState("");
  const [newPredictionConfidence, setNewPredictionConfidence] = useState(DEFAULT_PREDICTION_CONFIDENCE);
  const [goalPredictionConfidences, setGoalPredictionConfidences] = useState<Record<string, number>>({});
  const [predictionCalibrationResetAt, setPredictionCalibrationResetAt] = useState<number | null>(null);
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
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isResettingGold, setIsResettingGold] = useState(false);
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
  const todoInputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const goldAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const goldSoundTimeoutsRef = useRef<number[]>([]);
  const activeGoldAudioRef = useRef<HTMLAudioElement[]>([]);
  const goldCounterRef = useRef<HTMLDivElement | null>(null);
  const activeFlyingCoinNodesRef = useRef<HTMLSpanElement[]>([]);
  const accountabilityLoadedRef = useRef(false);
  const accountabilitySaveTimerRef = useRef<number | null>(null);
  const [focusTodoId, setFocusTodoId] = useState<string | null>(null);
  const [gameStates, setGameStates] = useState<GameState[]>([]);
  const [newGameStateName, setNewGameStateName] = useState("");
  const [selectedGameStateId, setSelectedGameStateId] = useState<string | null>(null);
  const [gameStateRefImages, setGameStateRefImages] = useState<Map<string, GameStateReferenceImage[]>>(new Map());
  const [blockSubtab, setBlockSubtab] = useState<"zones" | "game-states">("zones");
  const [detectionTestResults, setDetectionTestResults] = useState<DetectionTestResult[] | null>(null);
  const [detectionTestImage, setDetectionTestImage] = useState<string | null>(null);
  const [isTestingDetection, setIsTestingDetection] = useState(false);

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

  function launchFlyingCoins(sourceElement: HTMLElement | null) {
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
      const [todoData, zoneData, overlayData, fetchedGoldState] = await Promise.all([
        listTodos(),
        listZones(),
        getOverlayState(),
        getGoldState(),
      ]);
      setTodos(todoData.items);
      let nextGoldState = fetchedGoldState;
      if (fetchedGoldState.gold === 0 && fetchedGoldState.rewardedTodoIds.length === 0) {
        try {
          const rawGold = window.localStorage.getItem(GOLD_STORAGE_KEY);
          const parsedGold = rawGold ? Number(rawGold) : 0;
          const rawRewarded = window.localStorage.getItem(REWARDED_TODOS_STORAGE_KEY);
          const parsedRewarded = rawRewarded ? (JSON.parse(rawRewarded) as unknown) : [];
          const migratedGold = Number.isFinite(parsedGold) && parsedGold >= 0 ? Math.floor(parsedGold) : 0;
          const migratedRewarded = Array.isArray(parsedRewarded)
            ? parsedRewarded.filter((value): value is string => typeof value === "string")
            : [];
          if (migratedGold > 0 || migratedRewarded.length > 0) {
            nextGoldState = await saveGoldState({
              gold: migratedGold,
              rewardedTodoIds: migratedRewarded,
            });
          }
        } catch {
          // ignore invalid legacy local storage values
        }
      }
      setGold(nextGoldState.gold);
      setRewardedTodoIds(nextGoldState.rewardedTodoIds);
      setZones(zoneData.items);
      setOverlayState(overlayData);
      setGameStates(overlayData.gameStates ?? []);
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
    const isDesktopApp = navigator.userAgent.includes("Electron");
    document.body.classList.toggle("desktop-app", isDesktopApp);
    return () => document.body.classList.remove("desktop-app");
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
    const storageKey = ZONE_IMAGE_OVERRIDES_STORAGE_KEY;
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
    const storageKey = ZONE_IMAGE_OVERRIDES_STORAGE_KEY;
    window.localStorage.setItem(storageKey, JSON.stringify(zoneImageOverrides));
  }, [zoneImageOverrides]);

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
          const rawHabits = window.localStorage.getItem(LEGACY_HABITS_STORAGE_KEY);
          const rawPredictions = window.localStorage.getItem(LEGACY_PREDICTIONS_STORAGE_KEY);
          const rawReflections = window.localStorage.getItem(LEGACY_REFLECTIONS_STORAGE_KEY);
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
    if (!selectedGameStateId) return;
    void loadRefImages(selectedGameStateId);
  }, [selectedGameStateId]);

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

  function toggleTodo(todo: Todo, sourceElement: HTMLElement | null = null) {
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
        const result = await awardTodoGoldApi(todo.id, GOLD_PER_TODO);
        setGold(result.state.gold);
        setRewardedTodoIds(result.state.rewardedTodoIds);
      }
    });
  }

  function autoResizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
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

  function saveSettings() {
    try {
      window.localStorage.setItem(AI_EXPAND_PROVIDER_STORAGE_KEY, expandProvider);
      window.localStorage.setItem(AI_GEMINI_API_KEY_STORAGE_KEY, geminiApiKey.trim());
      window.localStorage.setItem(AI_OPENAI_API_KEY_STORAGE_KEY, openAiApiKey.trim());
      setError(null);
      setShowSettingsModal(false);
    } catch {
      setError("Failed to save settings.");
    }
  }

  async function resetGoldProgress() {
    const confirmed = window.confirm(
      "Reset gold for testing? This clears your gold total and completed gold rewards, but keeps the rest of your app data.",
    );
    if (!confirmed) return;

    setIsResettingGold(true);
    setError(null);
    try {
      const nextGoldState = await saveGoldState({ gold: 0, rewardedTodoIds: [] });
      setGold(nextGoldState.gold);
      setRewardedTodoIds(nextGoldState.rewardedTodoIds);
      try {
        [GOLD_STORAGE_KEY, REWARDED_TODOS_STORAGE_KEY].forEach((key) => window.localStorage.removeItem(key));
      } catch {
        // ignore local storage access issues
      }
      setShowSettingsModal(false);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setIsResettingGold(false);
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
      throw new Error("Gemini API key is missing. Add it in Settings.");
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
      throw new Error("OpenAI API key is missing. Add it in Settings.");
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
      setShowSettingsModal(true);
      setError("Add a Gemini API key in Settings to use expansion.");
      return;
    }
    if (expandProvider === "openai-gpt-4o-mini" && !openAiApiKey.trim()) {
      setShowSettingsModal(true);
      setError("Add an OpenAI API key in Settings to use expansion.");
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

  function onTodoTitleKeyDown(todo: Todo, event: ReactKeyboardEvent<HTMLTextAreaElement>) {
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

  function setZoneUnlockMode(zoneId: string, unlockMode: LockZoneUnlockMode) {
    setZones((previous) =>
      previous.map((zone) => (zone.id === zoneId ? { ...zone, unlockMode } : zone)),
    );
    void runAction(async () => {
      await updateZone(zoneId, { unlockMode });
      await refresh();
    });
  }

  function unlockZoneWithGold(zoneId: string) {
    const zoneState = overlayState?.zones.find((entry) => entry.zone.id === zoneId);
    if (!zoneState) return;
    if (!zoneState.isLocked) return;
    if (gold < ZONE_GOLD_UNLOCK_COST) {
      setError(`You need ${ZONE_GOLD_UNLOCK_COST} gold to unlock this block.`);
      return;
    }

    const confirmed = window.confirm(
      `Spend ${ZONE_GOLD_UNLOCK_COST} gold to unlock this block?`,
    );
    if (!confirmed) return;

    void runAction(async () => {
      await purchaseZoneGoldUnlock(zoneId);
      await refresh();
    });
  }

  function relockZone(zoneId: string) {
    void runAction(async () => {
      await clearZoneGoldUnlock(zoneId);
      await refresh();
    });
  }

  function addGameState() {
    const name = newGameStateName.trim();
    if (!name) return;
    void runAction(async () => {
      const created = await createGameStateApi({ name });
      setGameStates((prev) => [...prev, created]);
      setNewGameStateName("");
      setSelectedGameStateId(created.id);
      await refresh();
    });
  }

  function removeGameState(id: string) {
    void runAction(async () => {
      await deleteGameStateApi(id);
      setGameStates((prev) => prev.filter((gs) => gs.id !== id));
      if (selectedGameStateId === id) setSelectedGameStateId(null);
      setGameStateRefImages((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      await refresh();
    });
  }

  function patchGameState(id: string, patch: Partial<{ name: string; enabled: boolean; matchThreshold: number }>) {
    void runAction(async () => {
      const updated = await updateGameStateApi(id, patch);
      setGameStates((prev) => prev.map((gs) => (gs.id === updated.id ? updated : gs)));
    });
  }

  async function loadRefImages(gameStateId: string) {
    const result = await listReferenceImages(gameStateId);
    setGameStateRefImages((prev) => new Map(prev).set(gameStateId, result.items));
  }

  function handleRefImageUpload(gameStateId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    void runAction(async () => {
      for (const file of Array.from(files)) {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
        );
        await uploadReferenceImage(gameStateId, base64, file.name);
      }
      await loadRefImages(gameStateId);
    });
  }

  function removeRefImage(imageId: string, gameStateId: string) {
    void runAction(async () => {
      await deleteReferenceImageApi(imageId);
      await loadRefImages(gameStateId);
    });
  }

  function runDetectionTest(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsTestingDetection(true);
    setDetectionTestResults(null);

    const previewReader = new FileReader();
    previewReader.onload = () => setDetectionTestImage(previewReader.result as string);
    previewReader.readAsDataURL(file);

    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
        );
        const result = await testDetectionApi(base64);
        setDetectionTestResults(result.results);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setIsTestingDetection(false);
      }
    })();
  }

  function runDetectionTestFromUrl(imageUrl: string) {
    setIsTestingDetection(true);
    setDetectionTestResults(null);
    setDetectionTestImage(imageUrl);

    void (async () => {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
        );
        const result = await testDetectionApi(base64);
        setDetectionTestResults(result.results);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setIsTestingDetection(false);
      }
    })();
  }

  function toggleZoneGameState(zoneId: string, gameStateId: string) {
    if (!overlayState) return;
    const zoneState = overlayState.zones.find((zs) => zs.zone.id === zoneId);
    const current = new Set(zoneState?.activeForGameStateIds ?? []);
    if (current.has(gameStateId)) {
      current.delete(gameStateId);
    } else {
      current.add(gameStateId);
    }
    void runAction(async () => {
      await setZoneGameStatesApi(zoneId, [...current]);
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
      const dailyRangeFiltered = statusFiltered.filter((todo) => getViewForDeadline(todo.deadlineAt) === "daily");
      const topSource = dailyRangeFiltered.length > 0 ? dailyRangeFiltered : rangeFiltered;
      const firstTopLevelIndex = topSource.findIndex((todo) => todo.indent === 0);
      if (firstTopLevelIndex >= 0) {
        const topSlice: Todo[] = [topSource[firstTopLevelIndex]];
        for (let i = firstTopLevelIndex + 1; i < topSource.length; i += 1) {
          const next = topSource[i];
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
      const providerRaw = window.localStorage.getItem(AI_EXPAND_PROVIDER_STORAGE_KEY);
      const storedGemini = window.localStorage.getItem(AI_GEMINI_API_KEY_STORAGE_KEY);
      const storedOpenAi = window.localStorage.getItem(AI_OPENAI_API_KEY_STORAGE_KEY);
      const storedExpandContext = window.localStorage.getItem(AI_EXPAND_CONTEXT_STORAGE_KEY);
      const storedPredictionCalibrationResetAt = window.localStorage.getItem(PREDICTION_CALIBRATION_RESET_AT_STORAGE_KEY);
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
      if (storedPredictionCalibrationResetAt) {
        const parsed = Number(storedPredictionCalibrationResetAt);
        if (Number.isFinite(parsed) && parsed > 0) {
          setPredictionCalibrationResetAt(parsed);
        }
      }
    } catch {
      // ignore local storage access issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        AI_EXPAND_CONTEXT_STORAGE_KEY,
        JSON.stringify(expandContextByTodoId),
      );
    } catch {
      // ignore local storage save issues
    }
  }, [expandContextByTodoId]);

  useEffect(() => {
    try {
      if (predictionCalibrationResetAt === null) {
        window.localStorage.removeItem(PREDICTION_CALIBRATION_RESET_AT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          PREDICTION_CALIBRATION_RESET_AT_STORAGE_KEY,
          String(predictionCalibrationResetAt),
        );
      }
    } catch {
      // ignore local storage save issues
    }
  }, [predictionCalibrationResetAt]);

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
  const gameStatesByZone = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const zoneState of overlayState?.zones ?? []) {
      map.set(zoneState.zone.id, new Set(zoneState.activeForGameStateIds));
    }
    return map;
  }, [overlayState]);
  const gameStateNameById = useMemo(
    () => new Map(gameStates.map((gs) => [gs.id, gs.name])),
    [gameStates],
  );
  const detectedGameState = overlayState?.detectedGameState ?? null;

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
  const habitsView: HabitsView = habitsSubtab === "month" ? "month" : "week";

  function awardHabitGold(streak: number, sourceElement: HTMLElement | null) {
    const rewardAmount = 4 + streak;
    playGoldSound();
    launchFlyingCoins(sourceElement);
    void runAction(async () => {
      const nextGoldState = await awardGoldApi(rewardAmount);
      setGold(nextGoldState.gold);
      setRewardedTodoIds(nextGoldState.rewardedTodoIds);
    });
  }

  function addHabit(status: HabitStatus = "active") {
    const nextName = newHabitName.trim();
    if (!nextName) return;
    setHabits((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: nextName,
        checks: [],
        createdAt: Date.now(),
        status,
      },
    ]);
    setNewHabitName("");
  }

  function toggleHabitDay(habitId: string, dateKey: string, sourceElement: HTMLElement | null = null) {
    let rewardedHabit: Habit | null = null;
    let streak = 0;
    setHabits((prev) =>
      prev.map((habit) => {
        if (habit.id !== habitId) return habit;
        const hasCheck = habit.checks.some((check) => check.date === dateKey && check.done);
        const nextHabit = {
          ...habit,
          checks: hasCheck
            ? habit.checks.filter((check) => check.date !== dateKey)
            : [...habit.checks.filter((check) => check.date !== dateKey), { date: dateKey, done: true }],
        };
        if (!hasCheck) {
          rewardedHabit = nextHabit;
          streak = calculateHabitDayStreak(nextHabit, dateKey);
        }
        return nextHabit;
      }),
    );
    if (rewardedHabit) {
      awardHabitGold(streak, sourceElement);
    }
  }

  function toggleHabitWeek(habitId: string, weekStart: Date, weekEnd: Date, sourceElement: HTMLElement | null = null) {
    let rewardedHabit: Habit | null = null;
    let streak = 0;
    setHabits((prev) =>
      prev.map((habit) => {
        if (habit.id !== habitId) return habit;
        const doneInWeek = habit.checks.some((check) => {
          if (!check.done) return false;
          const checkDate = parseDateKey(check.date);
          return checkDate >= weekStart && checkDate <= weekEnd;
        });
        if (doneInWeek) {
          return {
            ...habit,
            checks: habit.checks.filter((check) => {
              const checkDate = parseDateKey(check.date);
              return checkDate < weekStart || checkDate > weekEnd;
            }),
          };
        }
        const nextHabit = {
          ...habit,
          checks: [...habit.checks, { date: getDateKey(weekEnd), done: true }],
        };
        rewardedHabit = nextHabit;
        streak = calculateHabitWeekStreak(nextHabit, weekStart, weekEnd);
        return nextHabit;
      }),
    );
    if (rewardedHabit) {
      awardHabitGold(streak, sourceElement);
    }
  }

  function deleteHabit(habitId: string) {
    setHabits((prev) => prev.filter((habit) => habit.id !== habitId));
  }

  function setHabitStatus(habitId: string, status: HabitStatus) {
    setHabits((prev) =>
      prev.map((habit) => (habit.id === habitId ? { ...habit, status } : habit)),
    );
    setEditingHabitId((prev) => (prev === habitId ? null : prev));
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
  const habitsTableColSpan = habitsView === "week" ? habitDays.length + 1 : habitWeeks.length + 1;
  const newHabitStatus: HabitStatus = habitsSubtab === "ideas" ? "idea" : "active";
  const newHabitPlaceholder =
    habitsSubtab === "ideas" ? "+ Add a new habit idea..." : "+ Add a new habit...";

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
    setNewPredictionConfidence(DEFAULT_PREDICTION_CONFIDENCE);
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

  function addGoalPrediction(todo: Todo) {
    const goalTitle = todo.title.trim();
    if (!goalTitle) return;
    const confidence = Math.max(1, Math.min(99, goalPredictionConfidences[todo.id] ?? DEFAULT_PREDICTION_CONFIDENCE));
    setPredictions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: goalTitle,
        confidence,
        outcome: "pending",
        createdAt: Date.now(),
        resolvedAt: null,
      },
    ]);
    setGoalPredictionConfidences((prev) => ({ ...prev, [todo.id]: DEFAULT_PREDICTION_CONFIDENCE }));
  }

  const activePredictions = useMemo(
    () => predictions.filter((prediction) => prediction.outcome === "pending"),
    [predictions],
  );
  const resolvedPredictions = useMemo(
    () => predictions.filter((prediction) => prediction.outcome !== "pending"),
    [predictions],
  );
  const pastPredictions = useMemo(
    () =>
      [...resolvedPredictions].sort(
        (a, b) => (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt),
      ),
    [resolvedPredictions],
  );
  const calibrationPredictions = useMemo(
    () =>
      resolvedPredictions.filter(
        (prediction) =>
          predictionCalibrationResetAt === null ||
          (prediction.resolvedAt ?? prediction.createdAt) >= predictionCalibrationResetAt,
      ),
    [predictionCalibrationResetAt, resolvedPredictions],
  );
  const calibrationAccuracy = useMemo(() => {
    if (calibrationPredictions.length === 0) return null;
    const total = calibrationPredictions.length;
    const hits = calibrationPredictions.filter((prediction) => prediction.outcome === "hit").length;
    return Math.round((hits / total) * 100);
  }, [calibrationPredictions]);
  const averageConfidence = useMemo(() => {
    if (calibrationPredictions.length === 0) return null;
    const sum = calibrationPredictions.reduce((acc, prediction) => acc + prediction.confidence, 0);
    return Math.round(sum / calibrationPredictions.length);
  }, [calibrationPredictions]);
  const calibrationChartPoints = useMemo(() => {
    if (calibrationPredictions.length === 0) return [];
    const plotWidth = CALIBRATION_CHART_WIDTH - CALIBRATION_CHART_PADDING.left - CALIBRATION_CHART_PADDING.right;
    const plotHeight = CALIBRATION_CHART_HEIGHT - CALIBRATION_CHART_PADDING.top - CALIBRATION_CHART_PADDING.bottom;
    const scaleX = (value: number) => CALIBRATION_CHART_PADDING.left + (value / 100) * plotWidth;
    const scaleY = (value: number) => CALIBRATION_CHART_PADDING.top + (1 - value / 100) * plotHeight;
    const buckets = new Map<number, { count: number; hits: number; confidenceSum: number }>();

    for (const prediction of calibrationPredictions) {
      const bucketStart = Math.min(90, Math.floor(prediction.confidence / 10) * 10);
      const current = buckets.get(bucketStart) ?? { count: 0, hits: 0, confidenceSum: 0 };
      current.count += 1;
      current.confidenceSum += prediction.confidence;
      if (prediction.outcome === "hit") current.hits += 1;
      buckets.set(bucketStart, current);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, bucket]) => {
        const avgConfidence = Math.round(bucket.confidenceSum / bucket.count);
        const actualRate = Math.round((bucket.hits / bucket.count) * 100);
        const label = bucketStart === 0 ? "1-9%" : `${bucketStart}-${Math.min(bucketStart + 9, 99)}%`;
        return {
          key: label,
          label,
          count: bucket.count,
          avgConfidence,
          actualRate,
          cx: scaleX(avgConfidence),
          cy: scaleY(actualRate),
        };
      });
  }, [calibrationPredictions]);
  const calibrationChartPath = useMemo(
    () =>
      calibrationChartPoints
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.cx.toFixed(1)} ${point.cy.toFixed(1)}`)
        .join(" "),
    [calibrationChartPoints],
  );
  const getResolvedPredictionLabel = (outcome: PredictionOutcome) =>
    outcome === "hit" ? "Happened" : outcome === "miss" ? "Didn't happen" : "Pending";
  const resetPredictionCalibration = () => setPredictionCalibrationResetAt(Date.now());
  const todaysPredictionGoals = useMemo(
    () =>
      todos.filter(
        (todo) =>
          !todo.archivedAt &&
          todo.status === "active" &&
          getViewForDeadline(todo.deadlineAt) === "daily" &&
          todo.title.trim().length > 0,
      ),
    [todos],
  );

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
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("social")}>
                  Social
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
                  onClick={() => setShowSettingsModal(true)}
                  title="Settings"
                  aria-label="Settings"
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
              </div>
            </div>

            <p className="goals-progress">Progress: {progress}% complete</p>
            {loadState === "loading" && <p>Loading…</p>}
            {error && <p style={{ color: "#fda4af" }}>{error}</p>}

            {filteredTodos.length === 0 ? (
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
                      <textarea
                        ref={(node) => {
                          if (node) {
                            todoInputRefs.current.set(todo.id, node);
                            autoResizeTextarea(node);
                          } else {
                            todoInputRefs.current.delete(todo.id);
                          }
                        }}
                        value={todoDrafts[todo.id] ?? todo.title}
                        onChange={(event) => {
                          setTodoDrafts((prev) => ({ ...prev, [todo.id]: event.target.value }));
                          autoResizeTextarea(event.target);
                        }}
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
                        rows={1}
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
                            <span className="goal-context-icon" aria-hidden="true">🎤</span>
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
            {todoFilter !== "completed" &&
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
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("social")}>
                  Social
                </button>
              </nav>
              <div className="goals-filters">
                <button
                  type="button"
                  className={`goals-subtab ${habitsSubtab === "ideas" ? "active" : ""}`}
                  onClick={() => setHabitsSubtab("ideas")}
                >
                  Ideas {ideaHabits.length > 0 ? `(${ideaHabits.length})` : ""}
                </button>
                <button
                  type="button"
                  className={`goals-subtab ${habitsSubtab === "week" ? "active" : ""}`}
                  onClick={() => setHabitsSubtab("week")}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`goals-subtab ${habitsSubtab === "month" ? "active" : ""}`}
                  onClick={() => setHabitsSubtab("month")}
                >
                  Month
                </button>
              </div>
            </div>
            <div className="habits-grid">
              {habitsSubtab === "ideas" ? (
                <div className="habits-panel">
                  <div className="habits-table-wrap">
                    <table className="habits-table habits-ideas-table">
                      <thead>
                        <tr>
                          <th>Idea</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ideaHabits.length === 0 ? (
                          <tr>
                            <td className="habits-empty-cell">
                              <p className="goals-empty">No habit ideas yet.</p>
                            </td>
                          </tr>
                        ) : (
                          ideaHabits.map((habit) => (
                            <tr
                              key={habit.id}
                              className={`habit-row ${editingHabitId === habit.id ? "editing" : ""}`}
                              onBlur={(event) => {
                                const nextTarget = event.relatedTarget as Node | null;
                                if (!event.currentTarget.contains(nextTarget)) {
                                  setEditingHabitId((current) => (current === habit.id ? null : current));
                                }
                              }}
                            >
                              <td>
                                <div className="habit-name-cell">
                                  <input
                                    id={`habit-name-${habit.id}`}
                                    className="habit-name-input"
                                    value={habit.name}
                                    onFocus={() => setEditingHabitId(habit.id)}
                                    onChange={(event) =>
                                      setHabits((prev) =>
                                        prev.map((h) =>
                                          h.id === habit.id ? { ...h, name: event.target.value } : h,
                                        ),
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="habit-edit-trigger"
                                    onClick={() => {
                                      setEditingHabitId(habit.id);
                                      requestAnimationFrame(() => {
                                        document.getElementById(`habit-name-${habit.id}`)?.focus();
                                      });
                                    }}
                                    aria-label={`Edit ${habit.name}`}
                                  >
                                    ✎
                                  </button>
                                  <div className="habit-row-actions">
                                    <button
                                      type="button"
                                      onClick={() => setHabitStatus(habit.id, "active")}
                                    >
                                      Activate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setHabitStatus(habit.id, "archived")}
                                    >
                                      Archive
                                    </button>
                                    <button type="button" onClick={() => deleteHabit(habit.id)}>
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                        <tr className="habits-add-row">
                          <td>
                            <div className="habits-add-inline">
                              <span className="habit-add-prefix">+</span>
                              <input
                                value={newHabitName}
                                onChange={(event) => setNewHabitName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addHabit(newHabitStatus);
                                  }
                                }}
                                placeholder={newHabitPlaceholder}
                              />
                              {newHabitName.trim() ? (
                                <button type="button" onClick={() => addHabit(newHabitStatus)}>
                                  Add
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {archivedHabits.length > 0 && (
                    <div className="habits-archive-panel">
                      <div className="habits-panel-header">
                        <strong>Archived</strong>
                        <small>{archivedHabits.length}</small>
                      </div>
                      <ul className="goals-list">
                        {archivedHabits.map((habit) => (
                          <li
                            key={`archived:${habit.id}`}
                            className={`goal-row habit-side-row ${editingHabitId === habit.id ? "editing" : ""}`}
                            onBlur={(event) => {
                              const nextTarget = event.relatedTarget as Node | null;
                              if (!event.currentTarget.contains(nextTarget)) {
                                setEditingHabitId((current) => (current === habit.id ? null : current));
                              }
                            }}
                          >
                            <div className="habit-name-cell">
                              <input
                                id={`habit-name-${habit.id}`}
                                className="habit-name-input"
                                value={habit.name}
                                onFocus={() => setEditingHabitId(habit.id)}
                                onChange={(event) =>
                                  setHabits((prev) =>
                                    prev.map((h) =>
                                      h.id === habit.id ? { ...h, name: event.target.value } : h,
                                    ),
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                              />
                              <button
                                type="button"
                                className="habit-edit-trigger"
                                onClick={() => {
                                  setEditingHabitId(habit.id);
                                  requestAnimationFrame(() => {
                                    document.getElementById(`habit-name-${habit.id}`)?.focus();
                                  });
                                }}
                                aria-label={`Edit ${habit.name}`}
                              >
                                ✎
                              </button>
                              <div className="habit-row-actions">
                                <button
                                  type="button"
                                  onClick={() => setHabitStatus(habit.id, "active")}
                                >
                                  Restore
                                </button>
                                <button type="button" onClick={() => deleteHabit(habit.id)}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : activeHabits.length === 0 ? (
                <div className="habits-panel">
                  <div className="habits-table-wrap">
                    <table className="habits-table">
                      <thead>
                        <tr>
                          <th>Habit</th>
                          {habitsView === "week"
                            ? habitDays.map((day) => (
                                <th key={day.key} className={day.key === todayKey ? "is-today" : ""}>
                                  <div>{day.label}</div>
                                  <small>{day.subLabel}</small>
                                </th>
                              ))
                            : habitWeeks.map((week) => (
                                <th
                                  key={week.start.toISOString()}
                                  className={getDateKey(week.end) >= todayKey && getDateKey(week.start) <= todayKey
                                    ? "is-today"
                                    : ""}
                                >
                                  {week.label}
                                </th>
                              ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="habits-empty-cell" colSpan={habitsTableColSpan}>
                            <p className="goals-empty">No habits yet.</p>
                          </td>
                        </tr>
                        <tr className="habits-add-row">
                          <td colSpan={habitsTableColSpan}>
                            <div className="habits-add-inline">
                              <span className="habit-add-prefix">+</span>
                              <input
                                value={newHabitName}
                                onChange={(event) => setNewHabitName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addHabit(newHabitStatus);
                                  }
                                }}
                                placeholder={newHabitPlaceholder}
                              />
                              {newHabitName.trim() ? (
                                <button type="button" onClick={() => addHabit(newHabitStatus)}>
                                  Add
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="habits-panel">
                  <div className="habits-table-wrap">
                    <table className="habits-table">
                  <thead>
                    <tr>
                      <th>Habit</th>
                      {habitsView === "week"
                        ? habitDays.map((day) => (
                            <th key={day.key} className={day.key === todayKey ? "is-today" : ""}>
                              <div>{day.label}</div>
                              <small>{day.subLabel}</small>
                            </th>
                          ))
                        : habitWeeks.map((week) => (
                            <th
                              key={week.start.toISOString()}
                              className={getDateKey(week.end) >= todayKey && getDateKey(week.start) <= todayKey
                                ? "is-today"
                                : ""}
                            >
                              {week.label}
                            </th>
                          ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeHabits.map((habit) => (
                      <tr
                        key={habit.id}
                        className={`habit-row ${editingHabitId === habit.id ? "editing" : ""}`}
                        onBlur={(event) => {
                          const nextTarget = event.relatedTarget as Node | null;
                          if (!event.currentTarget.contains(nextTarget)) {
                            setEditingHabitId((current) => (current === habit.id ? null : current));
                          }
                        }}
                      >
                        <td>
                          <div className="habit-name-cell">
                            <input
                              id={`habit-name-${habit.id}`}
                              className="habit-name-input"
                              value={habit.name}
                              onFocus={() => setEditingHabitId(habit.id)}
                              onChange={(event) =>
                                setHabits((prev) =>
                                  prev.map((h) => (h.id === habit.id ? { ...h, name: event.target.value } : h)),
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                            />
                            <button
                              type="button"
                              className="habit-edit-trigger"
                              onClick={() => {
                                setEditingHabitId(habit.id);
                                requestAnimationFrame(() => {
                                  document.getElementById(`habit-name-${habit.id}`)?.focus();
                                });
                              }}
                              aria-label={`Edit ${habit.name}`}
                            >
                              ✎
                            </button>
                            <div className="habit-row-actions">
                              <button type="button" onClick={() => setHabitStatus(habit.id, "idea")}>
                                Idea
                              </button>
                              <button type="button" onClick={() => setHabitStatus(habit.id, "archived")}>
                                Archive
                              </button>
                              <button type="button" onClick={() => deleteHabit(habit.id)}>Delete</button>
                            </div>
                          </div>
                        </td>
                        {habitsView === "week"
                          ? habitDays.map((day) => {
                              const done = habit.checks.some((check) => check.date === day.key && check.done);
                              return (
                                <td key={`${habit.id}:${day.key}`} className={day.key === todayKey ? "is-today" : ""}>
                                  <button
                                    type="button"
                                    className={`habit-check ${done ? "done" : ""}`}
                                    onClick={(event) => toggleHabitDay(habit.id, day.key, event.currentTarget)}
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
                                <td
                                  key={`${habit.id}:${week.start.toISOString()}`}
                                  className={getDateKey(week.end) >= todayKey && getDateKey(week.start) <= todayKey
                                    ? "is-today"
                                    : ""}
                                >
                                  <button
                                    type="button"
                                    className={`habit-check ${done ? "done" : ""}`}
                                    onClick={(event) =>
                                      toggleHabitWeek(habit.id, week.start, week.end, event.currentTarget)
                                    }
                                  >
                                    {done ? "✓" : ""}
                                  </button>
                                </td>
                              );
                            })}
                      </tr>
                    ))}
                    <tr className="habits-add-row">
                      <td colSpan={habitsTableColSpan}>
                        <div className="habits-add-inline">
                          <span className="habit-add-prefix">+</span>
                          <input
                            value={newHabitName}
                            onChange={(event) => setNewHabitName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addHabit(newHabitStatus);
                              }
                            }}
                            placeholder={newHabitPlaceholder}
                          />
                          {newHabitName.trim() ? (
                            <button type="button" onClick={() => addHabit(newHabitStatus)}>
                              Add
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                    </table>
                  </div>
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
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("social")}>
                  Social
                </button>
              </nav>
            </div>
            <div className="predictions-top">
              <div className="prediction-header">
                <h3 className="prediction-heading">Predict your day</h3>
              </div>
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
                    setNewPredictionConfidence(
                      Number.isFinite(numeric) ? numeric : DEFAULT_PREDICTION_CONFIDENCE,
                    );
                  }}
                />
                <button type="button" onClick={addPrediction}>Add</button>
              </div>
            </div>
            {activePredictions.length === 0 ? (
              <p className="goals-empty">
                {pastPredictions.length === 0 ? "No predictions yet." : "No active predictions right now."}
              </p>
            ) : (
              <ul className="goals-list">
                {activePredictions.map((prediction) => (
                  <li key={prediction.id} className="goal-row">
                    <div className="prediction-row">
                      <span className="prediction-title">{prediction.title}</span>
                      <div className="goal-actions prediction-actions">
                        <button type="button" onClick={() => setPredictionOutcome(prediction.id, "hit")}>Happened</button>
                        <button type="button" onClick={() => setPredictionOutcome(prediction.id, "miss")}>Didn't happen</button>
                        <button type="button" onClick={() => deletePrediction(prediction.id)}>Delete</button>
                      </div>
                      <small className="prediction-confidence">{prediction.confidence}%</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <details className="prediction-goals-panel">
              <summary>Add from today's goals</summary>
              <div className="prediction-goals-content">
                {todaysPredictionGoals.length === 0 ? (
                  <p className="goals-empty">No active daily goals to pull from.</p>
                ) : (
                  <ul className="prediction-goals-list">
                    {todaysPredictionGoals.map((todo) => (
                      <li key={todo.id} className="prediction-goal-item">
                        <span className="prediction-goal-label">{todo.title}</span>
                        <div className="prediction-goal-actions">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={goalPredictionConfidences[todo.id] ?? DEFAULT_PREDICTION_CONFIDENCE}
                            onChange={(event) => {
                              const numeric = Number(event.target.value);
                              setGoalPredictionConfidences((prev) => ({
                                ...prev,
                                [todo.id]: Number.isFinite(numeric) ? numeric : DEFAULT_PREDICTION_CONFIDENCE,
                              }));
                            }}
                            aria-label={`Confidence for ${todo.title}`}
                          />
                          <button type="button" onClick={() => addGoalPrediction(todo)}>
                            Add
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
            <details className="prediction-goals-panel">
              <summary>Past predictions</summary>
              <div className="prediction-goals-content">
                {pastPredictions.length === 0 ? (
                  <p className="goals-empty">Resolved predictions will show up here.</p>
                ) : (
                  <ul className="goals-list">
                    {pastPredictions.map((prediction) => (
                      <li key={prediction.id} className="goal-row">
                        <div className="prediction-row">
                          <div className="prediction-history-main">
                            <span className="prediction-title">{prediction.title}</span>
                            <div className="prediction-history-meta">
                              <span
                                className={`prediction-outcome-badge ${
                                  prediction.outcome === "hit" ? "prediction-outcome-happened" : "prediction-outcome-not-happened"
                                }`}
                              >
                                {getResolvedPredictionLabel(prediction.outcome)}
                              </span>
                              <span>
                                {new Date(prediction.resolvedAt ?? prediction.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                          </div>
                          <div className="goal-actions prediction-actions">
                            <button type="button" onClick={() => deletePrediction(prediction.id)}>Delete</button>
                          </div>
                          <small className="prediction-confidence">{prediction.confidence}%</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
            <details className="prediction-goals-panel">
              <summary>Calibration results</summary>
              <div className="prediction-goals-content">
                <div className="prediction-calibration-toolbar">
                  {predictionCalibrationResetAt ? (
                    <p className="prediction-calibration-note">
                      Showing results since{" "}
                      {new Date(predictionCalibrationResetAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="prediction-calibration-reset" onClick={resetPredictionCalibration}>
                    Reset calibration
                  </button>
                </div>
                {calibrationPredictions.length === 0 ? (
                  <p className="goals-empty">
                    {resolvedPredictions.length === 0
                      ? "Resolve a few predictions to see your calibration graph."
                      : "No resolved predictions yet in the current calibration window."}
                  </p>
                ) : (
                  <div className="prediction-calibration">
                    <div className="prediction-calibration-stats">
                      <p className="goals-progress">
                        Accuracy: {calibrationAccuracy ?? "—"}%
                      </p>
                      <p className="goals-progress">
                        Average confidence: {averageConfidence ?? "—"}%
                      </p>
                    </div>
                    <div className="prediction-calibration-chart">
                      <svg viewBox={`0 0 ${CALIBRATION_CHART_WIDTH} ${CALIBRATION_CHART_HEIGHT}`} role="img" aria-label="Calibration graph">
                        {[0, 25, 50, 75, 100].map((tick) => {
                          const y =
                            CALIBRATION_CHART_PADDING.top +
                            (1 - tick / 100) *
                              (CALIBRATION_CHART_HEIGHT - CALIBRATION_CHART_PADDING.top - CALIBRATION_CHART_PADDING.bottom);
                          return (
                            <g key={`y-${tick}`}>
                              <line
                                x1={CALIBRATION_CHART_PADDING.left}
                                x2={CALIBRATION_CHART_WIDTH - CALIBRATION_CHART_PADDING.right}
                                y1={y}
                                y2={y}
                                className="prediction-calibration-grid"
                              />
                              <text x={CALIBRATION_CHART_PADDING.left - 8} y={y + 4} textAnchor="end" className="prediction-calibration-axis">
                                {tick}
                              </text>
                            </g>
                          );
                        })}
                        {[0, 25, 50, 75, 100].map((tick) => {
                          const x =
                            CALIBRATION_CHART_PADDING.left +
                            (tick / 100) *
                              (CALIBRATION_CHART_WIDTH - CALIBRATION_CHART_PADDING.left - CALIBRATION_CHART_PADDING.right);
                          return (
                            <g key={`x-${tick}`}>
                              <line
                                x1={x}
                                x2={x}
                                y1={CALIBRATION_CHART_PADDING.top}
                                y2={CALIBRATION_CHART_HEIGHT - CALIBRATION_CHART_PADDING.bottom}
                                className="prediction-calibration-grid"
                              />
                              <text
                                x={x}
                                y={CALIBRATION_CHART_HEIGHT - CALIBRATION_CHART_PADDING.bottom + 18}
                                textAnchor="middle"
                                className="prediction-calibration-axis"
                              >
                                {tick}
                              </text>
                            </g>
                          );
                        })}
                        <line
                          x1={CALIBRATION_CHART_PADDING.left}
                          y1={CALIBRATION_CHART_HEIGHT - CALIBRATION_CHART_PADDING.bottom}
                          x2={CALIBRATION_CHART_WIDTH - CALIBRATION_CHART_PADDING.right}
                          y2={CALIBRATION_CHART_PADDING.top}
                          className="prediction-calibration-target"
                        />
                        {calibrationChartPath ? (
                          <path d={calibrationChartPath} className="prediction-calibration-line" />
                        ) : null}
                        {calibrationChartPoints.map((point) => (
                          <g key={point.key}>
                            <circle cx={point.cx} cy={point.cy} r={4.5} className="prediction-calibration-point" />
                            <title>{`Confidence bucket ${point.label}: ${point.actualRate}% hit rate from ${point.count} resolved prediction${point.count === 1 ? "" : "s"} at ${point.avgConfidence}% avg confidence`}</title>
                          </g>
                        ))}
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </details>
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
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("social")}>
                  Social
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
              <button
                type="button"
                className="goals-subtab"
                onClick={() => setActiveTab("social")}
              >
                Social
              </button>
            </nav>
          </div>
          <div className="tab-pane">
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              onClick={() => setBlockSubtab("zones")}
              style={{
                fontWeight: blockSubtab === "zones" ? 700 : 400,
                background: "transparent",
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                borderBottomWidth: 2,
                borderBottomStyle: "solid",
                borderBottomColor: blockSubtab === "zones" ? "#60a5fa" : "transparent",
                padding: "0.4rem 0.75rem",
                cursor: "pointer",
                color: blockSubtab === "zones" ? "#e2e8f0" : "#94a3b8",
              }}
            >
              Lock Zones
            </button>
            <button
              type="button"
              onClick={() => setBlockSubtab("game-states")}
              style={{
                fontWeight: blockSubtab === "game-states" ? 700 : 400,
                background: "transparent",
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                borderBottomWidth: 2,
                borderBottomStyle: "solid",
                borderBottomColor: blockSubtab === "game-states" ? "#60a5fa" : "transparent",
                padding: "0.4rem 0.75rem",
                cursor: "pointer",
                color: blockSubtab === "game-states" ? "#e2e8f0" : "#94a3b8",
              }}
            >
              Game States
              {detectedGameState?.gameStateName && (
                <span style={{ marginLeft: "0.4rem", fontSize: "0.75rem", color: "#86efac" }}>
                  ({detectedGameState.gameStateName})
                </span>
              )}
            </button>
          </div>

          {blockSubtab === "zones" && (
          <>
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
              const isLocked = zoneState?.isLocked ?? false;
              const goldUnlockActive = zoneState?.goldUnlockActive ?? false;
              const lockText = lockMessage(requiredTitles, zone.unlockMode);
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
                    cursor: isLocked ? "pointer" : "move",
                  }}
                >
                  {isLocked && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-start",
                        alignItems: "center",
                        paddingTop: lockTextTopPadding(zone.width, zone.height),
                        paddingLeft: "0.45rem",
                        paddingRight: "0.45rem",
                        gap: "0.45rem",
                      }}
                    >
                      <div
                        style={{
                          ...lockTextStyle,
                        }}
                      >
                        {lockText}
                      </div>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          unlockZoneWithGold(zone.id);
                        }}
                        style={{
                          borderRadius: 999,
                          border: "1px solid rgba(212, 170, 71, 0.56)",
                          background: gold >= ZONE_GOLD_UNLOCK_COST ? "rgba(73, 53, 18, 0.92)" : "rgba(55, 65, 81, 0.92)",
                          color: gold >= ZONE_GOLD_UNLOCK_COST ? "#f8df8b" : "#d1d5db",
                          padding: "0.32rem 0.7rem",
                          fontSize: Math.max(10, Math.min(13, Math.min(zone.width, zone.height) * 0.05)),
                          fontWeight: 700,
                        }}
                        title={`Spend ${ZONE_GOLD_UNLOCK_COST} gold to unlock`}
                      >
                        Unlock for {ZONE_GOLD_UNLOCK_COST} gold
                      </button>
                    </div>
                  )}
                  {!isLocked && goldUnlockActive && (
                    <div
                      style={{
                        position: "absolute",
                        right: "0.45rem",
                        top: "0.45rem",
                        borderRadius: 999,
                        background: "rgba(120, 53, 15, 0.9)",
                        color: "#fde68a",
                        padding: "0.2rem 0.5rem",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        pointerEvents: "none",
                      }}
                    >
                      Gold unlocked
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
                const zoneState = overlayState?.zones.find((entry) => entry.zone.id === zone.id);
                const isLocked = zoneState?.isLocked ?? false;
                const goldUnlockActive = zoneState?.goldUnlockActive ?? false;
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
                      <select
                        value={zone.unlockMode}
                        onChange={(event) => setZoneUnlockMode(zone.id, event.target.value as LockZoneUnlockMode)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <option value="todos">Todo unlock</option>
                        <option value="gold">10 gold unlock</option>
                      </select>
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
                      {isLocked ? "Locked in game" : goldUnlockActive ? "Unlocked with gold" : "Unlocked in game"}
                    </p>

                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>{zone.unlockMode === "gold" ? "Unlock rule" : "Required todos"}</strong>
                      {zone.unlockMode === "gold" ? (
                        <>
                          <small>Click the locked block and pay {ZONE_GOLD_UNLOCK_COST} gold to unlock it.</small>
                          {goldUnlockActive && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                relockZone(zone.id);
                              }}
                              style={{ justifySelf: "start" }}
                            >
                              Re-lock zone
                            </button>
                          )}
                        </>
                      ) : lockableTodos.length === 0 ? (
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

                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>Active in game states</strong>
                      {gameStates.length === 0 ? (
                        <small style={{ opacity: 0.7 }}>No game states defined yet. Create them in the Game States tab.</small>
                      ) : (
                        <>
                          <small style={{ opacity: 0.7 }}>
                            {(gameStatesByZone.get(zone.id)?.size ?? 0) === 0
                              ? "Always active (no game state filter)"
                              : `Active in: ${[...(gameStatesByZone.get(zone.id) ?? [])].map((id) => gameStateNameById.get(id) ?? id).join(", ")}`}
                          </small>
                          {gameStates.map((gs) => (
                            <label key={`${zone.id}:gs:${gs.id}`} style={{ display: "flex", gap: "0.4rem" }}>
                              <input
                                type="checkbox"
                                checked={gameStatesByZone.get(zone.id)?.has(gs.id) ?? false}
                                onChange={() => toggleZoneGameState(zone.id, gs.id)}
                              />
                              <span>{gs.name}</span>
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          </>
          )}

          {blockSubtab === "game-states" && (
          <>
          <h2>Game States</h2>
          <p style={{ marginBottom: "0.75rem", opacity: 0.85 }}>
            Define game states (shop, campfire, combat, etc.) to conditionally activate lock zones.
            The detection agent will match screenshots against reference images to determine the current state.
          </p>

          {detectedGameState && (
            <div style={{
              padding: "0.6rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid #374151",
              marginBottom: "1rem",
              background: detectedGameState.gameStateId ? "rgba(34,197,94,0.08)" : "rgba(55,65,81,0.3)",
            }}>
              <strong>Currently detected: </strong>
              {detectedGameState.gameStateName ? (
                <span style={{ color: "#86efac" }}>
                  {detectedGameState.gameStateName}
                  <small style={{ marginLeft: "0.5rem", opacity: 0.7 }}>
                    ({(detectedGameState.confidence * 100).toFixed(0)}% confidence)
                  </small>
                </span>
              ) : (
                <span style={{ opacity: 0.6 }}>None (no state detected)</span>
              )}
              {detectedGameState.gameStateId && (
                <button
                  type="button"
                  onClick={() => void runAction(async () => { await setDetectedGameStateApi(null, 0); await refresh(); })}
                  style={{ marginLeft: "0.75rem", fontSize: "0.8rem" }}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div style={{
            padding: "0.75rem",
            borderRadius: "8px",
            border: "1px solid #374151",
            marginBottom: "1rem",
            background: "rgba(30,41,59,0.5)",
          }}>
            <strong>Test Detection</strong>
            <p style={{ opacity: 0.7, fontSize: "0.85rem", margin: "0.25rem 0 0.5rem" }}>
              Upload any screenshot or click &quot;Test this&quot; on a reference image below.
              This runs the image comparison algorithm and shows match scores against all references.
              It does <strong>not</strong> change the active detected state — use &quot;Apply best match&quot; for that.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <label style={{
                display: "inline-block",
                padding: "0.35rem 0.75rem",
                border: "1px dashed #4b5563",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}>
                {isTestingDetection ? "Analyzing..." : "Upload test screenshot"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(event) => runDetectionTest(event.target.files)}
                  disabled={isTestingDetection}
                />
              </label>
              {detectionTestImage && (
                <img
                  src={detectionTestImage}
                  alt="Test screenshot"
                  style={{ width: 160, height: 90, objectFit: "cover", borderRadius: "4px", border: "1px solid #4b5563" }}
                />
              )}
            </div>
            {detectionTestResults && (
              <div style={{ marginTop: "0.75rem" }}>
                {detectionTestResults.length === 0 ? (
                  <p style={{ opacity: 0.6 }}>No reference images to compare against. Upload some first.</p>
                ) : (
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 80px 80px 80px",
                      gap: "0.5rem",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      opacity: 0.6,
                      paddingBottom: "0.25rem",
                      borderBottom: "1px solid #374151",
                    }}>
                      <span>Game State (ref image)</span>
                      <span>Structural</span>
                      <span>Histogram</span>
                      <span>Combined</span>
                    </div>
                    {detectionTestResults.map((r, i) => {
                      const isTop = i === 0;
                      const passesThreshold = (() => {
                        const gs = gameStates.find((s) => s.id === r.gameStateId);
                        return gs ? r.combined >= gs.matchThreshold : false;
                      })();
                      return (
                        <div
                          key={`${r.imageId}-${i}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 80px 80px 80px",
                            gap: "0.5rem",
                            fontSize: "0.85rem",
                            padding: "0.3rem 0",
                            background: isTop ? "rgba(34,197,94,0.08)" : "transparent",
                            borderRadius: isTop ? "4px" : 0,
                            color: passesThreshold ? "#86efac" : isTop ? "#fde68a" : "#94a3b8",
                          }}
                        >
                          <span>
                            {isTop && (passesThreshold ? "  " : "  ")}
                            {r.gameStateName}
                            <small style={{ opacity: 0.5, marginLeft: "0.3rem" }}>({r.filename.slice(0, 12)}...)</small>
                          </span>
                          <span>{(r.ncc * 100).toFixed(1)}%</span>
                          <span>{(r.histogram * 100).toFixed(1)}%</span>
                          <span style={{ fontWeight: isTop ? 700 : 400 }}>{(r.combined * 100).toFixed(1)}%</span>
                        </div>
                      );
                    })}
                    {detectionTestResults.length > 0 && (() => {
                      const best = detectionTestResults[0];
                      const gs = gameStates.find((s) => s.id === best.gameStateId);
                      const threshold = gs?.matchThreshold ?? 0.8;
                      const passes = best.combined >= threshold;
                      return (
                        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                          <p style={{
                            margin: 0,
                            fontSize: "0.85rem",
                            color: passes ? "#86efac" : "#fca5a5",
                          }}>
                            Best match: <strong>{best.gameStateName}</strong> at {(best.combined * 100).toFixed(1)}%
                            {passes
                              ? ` — passes threshold (${(threshold * 100).toFixed(0)}%)`
                              : ` — below threshold (${(threshold * 100).toFixed(0)}%)`}
                          </p>
                          <button
                            type="button"
                            onClick={() => void runAction(async () => {
                              await setDetectedGameStateApi(passes ? best.gameStateId : null, passes ? best.combined : 0);
                              await refresh();
                            })}
                            style={{
                              fontSize: "0.8rem",
                              padding: "0.25rem 0.6rem",
                              background: passes ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                              border: passes ? "1px solid #166534" : "1px solid #7f1d1d",
                              borderRadius: "4px",
                              color: passes ? "#86efac" : "#fca5a5",
                              cursor: "pointer",
                            }}
                          >
                            {passes
                              ? `Apply: set state to "${best.gameStateName}"`
                              : "Apply: clear state (below threshold)"}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); addGameState(); }}
            style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
          >
            <input
              value={newGameStateName}
              onChange={(event) => setNewGameStateName(event.target.value)}
              placeholder="e.g. Shop, Campfire, Combat"
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={!newGameStateName.trim()}>Add Game State</button>
          </form>

          {gameStates.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No game states defined yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {gameStates.map((gs) => {
                const isSelected = selectedGameStateId === gs.id;
                const refImages = gameStateRefImages.get(gs.id) ?? [];
                return (
                  <article
                    key={gs.id}
                    onClick={() => setSelectedGameStateId(gs.id)}
                    style={{
                      border: isSelected ? "1px solid #60a5fa" : "1px solid #374151",
                      borderRadius: "10px",
                      padding: "0.75rem",
                      display: "grid",
                      gap: "0.5rem",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        value={gs.name}
                        onChange={(event) => {
                          const nextName = event.target.value;
                          setGameStates((prev) => prev.map((item) => (item.id === gs.id ? { ...item, name: nextName } : item)));
                        }}
                        onBlur={() => patchGameState(gs.id, { name: gs.name.trim() })}
                        onClick={(event) => event.stopPropagation()}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); patchGameState(gs.id, { enabled: !gs.enabled }); }}
                      >
                        {gs.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); removeGameState(gs.id); }}
                        style={{ color: "#fca5a5" }}
                      >
                        Delete
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <label onClick={(event) => event.stopPropagation()} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                        <small>Match threshold:</small>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={gs.matchThreshold}
                          onChange={(event) => {
                            const val = Number(event.target.value);
                            setGameStates((prev) => prev.map((item) => (item.id === gs.id ? { ...item, matchThreshold: val } : item)));
                          }}
                          onMouseUp={() => patchGameState(gs.id, { matchThreshold: gs.matchThreshold })}
                          onTouchEnd={() => patchGameState(gs.id, { matchThreshold: gs.matchThreshold })}
                          style={{ width: 100 }}
                        />
                        <small>{(gs.matchThreshold * 100).toFixed(0)}%</small>
                      </label>
                      <small style={{ opacity: 0.5 }}>Method: {gs.detectionMethod.replace(/_/g, " ")}</small>
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAction(async () => { await setDetectedGameStateApi(gs.id, 1.0); await refresh(); });
                        }}
                        style={{ fontSize: "0.8rem" }}
                        title="Force-set the detected state to this game state (no image comparison, just directly activates it)"
                      >
                        Force activate this state
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void runAction(async () => { await setDetectedGameStateApi(null, 0); await refresh(); });
                        }}
                        style={{ fontSize: "0.8rem" }}
                        title="Clear the detected state back to Default"
                      >
                        Clear to Default
                      </button>
                      <small style={{ opacity: 0.5 }}>
                        {gs.enabled ? "Enabled" : "Disabled"}
                        {detectedGameState?.gameStateId === gs.id && (
                          <span style={{ color: "#86efac", marginLeft: "0.4rem" }}>(currently active)</span>
                        )}
                      </small>
                    </div>

                    {isSelected && (
                      <div style={{ borderTop: "1px solid #374151", paddingTop: "0.5rem" }}>
                        <strong>Reference Screenshots</strong>
                        <p style={{ opacity: 0.7, fontSize: "0.85rem", margin: "0.25rem 0 0.5rem" }}>
                          Upload screenshots that represent this game state. The agent will compare against these.
                        </p>

                        <label
                          onClick={(event) => event.stopPropagation()}
                          style={{
                            display: "inline-block",
                            padding: "0.35rem 0.75rem",
                            border: "1px dashed #4b5563",
                            borderRadius: "6px",
                            cursor: "pointer",
                            marginBottom: "0.5rem",
                            fontSize: "0.85rem",
                          }}
                        >
                          Upload image(s)
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: "none" }}
                            onChange={(event) => handleRefImageUpload(gs.id, event.target.files)}
                          />
                        </label>

                        {refImages.length === 0 ? (
                          <p style={{ opacity: 0.5, fontSize: "0.85rem" }}>No reference images yet.</p>
                        ) : (
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            {refImages.map((img) => (
                              <div
                                key={img.id}
                                style={{
                                  position: "relative",
                                  border: "1px solid #4b5563",
                                  borderRadius: "6px",
                                  overflow: "hidden",
                                }}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <img
                                  src={referenceImageUrl(gs.id, img.filename)}
                                  alt={img.filename}
                                  style={{ width: 140, height: 80, objectFit: "cover", display: "block" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => runDetectionTestFromUrl(referenceImageUrl(gs.id, img.filename))}
                                  disabled={isTestingDetection}
                                  style={{
                                    position: "absolute",
                                    bottom: 2,
                                    left: 2,
                                    background: "rgba(0,0,0,0.75)",
                                    color: "#93c5fd",
                                    border: "none",
                                    borderRadius: "4px",
                                    fontSize: 10,
                                    cursor: "pointer",
                                    padding: "2px 6px",
                                  }}
                                  title="Test: compare this image against all references (should match itself at ~100%)"
                                >
                                  Test this
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRefImage(img.id, gs.id)}
                                  style={{
                                    position: "absolute",
                                    top: 2,
                                    right: 2,
                                    background: "rgba(0,0,0,0.7)",
                                    color: "#fca5a5",
                                    border: "none",
                                    borderRadius: "50%",
                                    width: 20,
                                    height: 20,
                                    fontSize: 12,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                  }}
                                  title="Remove image"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          </>
          )}

          </div>
          </section>
          )}

          {activeTab === "social" && (
          <section className="tab-pane goals-board">
            <div className="goals-topbar">
              <nav className="goals-subtabs" aria-label="Accountability sections">
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("goals")}>
                  Goals
                </button>
                <button type="button" className="goals-subtab" onClick={() => setActiveTab("habits")}>
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
                <button type="button" className="goals-subtab active" onClick={() => setActiveTab("social")}>
                  Social
                </button>
              </nav>
            </div>
            <SocialModal embedded />
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
      {showSettingsModal && (
        <div
          className="todo-edit-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!isResettingGold) {
              setShowSettingsModal(false);
            }
          }}
        >
          <div
            className="todo-edit-modal settings-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Settings</h3>
            <section className="settings-section">
              <p className="settings-section-title">AI expansion</p>
              <p className="settings-section-copy">
                Choose the provider used for goal expansion and store your API keys locally in this browser.
              </p>
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
              <p className="settings-hint">
                Expansion asks for end state, intermediate states, and concrete physical actions, then creates 3-5
                subtasks prefixed with [2m] or [5m].
              </p>
            </section>
            <section className="settings-section settings-reset-card">
              <p className="settings-section-title">Gold reset</p>
              <p className="settings-section-copy">
                Reset your gold count for testing without clearing goals, zones, habits, predictions, reflections, or
                saved AI settings.
              </p>
              <button
                type="button"
                className="settings-reset-button"
                onClick={() => void resetGoldProgress()}
                disabled={isResettingGold}
              >
                {isResettingGold ? "Resetting..." : "Reset gold"}
              </button>
            </section>
            <div className="todo-edit-modal-actions">
              <button type="button" onClick={() => setShowSettingsModal(false)} disabled={isResettingGold}>Cancel</button>
              <button type="button" onClick={saveSettings} disabled={isResettingGold}>Save</button>
            </div>
          </div>
        </div>
      )}
      {expansionContextTodoId && (
        <div className="todo-edit-modal-backdrop" role="presentation" onClick={closeExpansionContextModal}>
          <div
            className="todo-edit-modal settings-modal"
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
            <p className="settings-hint">
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
