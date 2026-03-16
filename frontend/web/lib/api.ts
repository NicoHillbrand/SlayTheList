import type {
  AccountabilityState,
  Habit,
  HabitStatus,
  LockZone,
  OverlayState,
  Prediction,
  PredictionOutcome,
  ReflectionEntry,
  Todo,
} from "@slaythelist/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listTodos() {
  return request<{ items: Todo[] }>("/api/todos");
}

export async function createTodo(
  title: string,
  options?: { deadlineAt?: string | null; deadlineTime?: string },
) {
  return request<Todo>("/api/todos", {
    method: "POST",
    body: JSON.stringify({
      title,
      deadlineAt: options?.deadlineAt ?? null,
      deadlineTime: options?.deadlineTime,
    }),
  });
}

export async function setTodoStatus(id: string, status: "active" | "done") {
  return request<Todo>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function updateTodo(
  id: string,
  patch: Partial<{
    title: string;
    context: string;
    status: "active" | "done";
    indent: number;
    deadlineAt: string | null;
    deadlineTime: string;
    archived: boolean;
  }>,
) {
  return request<Todo>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteTodo(id: string) {
  return request<{ deleted: true }>(`/api/todos/${id}`, {
    method: "DELETE",
  });
}

export async function reorderTodos(orderedTodoIds: string[]) {
  return request<{ items: Todo[] }>("/api/todos/reorder", {
    method: "PUT",
    body: JSON.stringify({ orderedTodoIds }),
  });
}

export async function listZones() {
  return request<{ items: LockZone[] }>("/api/zones");
}

export async function createZone(input: {
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  enabled?: boolean;
}) {
  return request<LockZone>("/api/zones", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateZone(id: string, patch: Partial<LockZone>) {
  return request<LockZone>(`/api/zones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteZone(id: string) {
  return request<{ deleted: true }>(`/api/zones/${id}`, {
    method: "DELETE",
  });
}

export async function setZoneRequirements(zoneId: string, todoIds: string[]) {
  return request<{ updated: true }>(`/api/zones/${zoneId}/requirements`, {
    method: "PUT",
    body: JSON.stringify({ todoIds }),
  });
}

export async function getOverlayState() {
  return request<OverlayState>("/api/overlay-state");
}

export async function getAccountabilityState() {
  return request<AccountabilityState>("/api/accountability-state");
}

export async function saveAccountabilityState(state: AccountabilityState) {
  return request<AccountabilityState>("/api/accountability-state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
}

export async function listHabits() {
  return request<{ items: Habit[] }>("/api/habits");
}

export async function createHabit(input: { name: string; status?: HabitStatus }) {
  return request<Habit>("/api/habits", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateHabit(
  id: string,
  patch: Partial<{ name: string; status: HabitStatus; checks: Habit["checks"] }>,
) {
  return request<Habit>(`/api/habits/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteHabit(id: string) {
  return request<{ deleted: true }>(`/api/habits/${id}`, {
    method: "DELETE",
  });
}

export async function listPredictions() {
  return request<{ items: Prediction[] }>("/api/predictions");
}

export async function createPrediction(input: { title: string; confidence: number }) {
  return request<Prediction>("/api/predictions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePrediction(
  id: string,
  patch: Partial<{
    title: string;
    confidence: number;
    outcome: PredictionOutcome;
    resolvedAt: number | null;
  }>,
) {
  return request<Prediction>(`/api/predictions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deletePrediction(id: string) {
  return request<{ deleted: true }>(`/api/predictions/${id}`, {
    method: "DELETE",
  });
}

export async function listReflections() {
  return request<{ items: ReflectionEntry[] }>("/api/reflections");
}

export async function createReflection(
  input: Pick<ReflectionEntry, "date" | "wins" | "challenges" | "notes" | "tomorrow">,
) {
  return request<ReflectionEntry>("/api/reflections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateReflection(
  id: string,
  patch: Partial<Pick<ReflectionEntry, "date" | "wins" | "challenges" | "notes" | "tomorrow">>,
) {
  return request<ReflectionEntry>(`/api/reflections/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteReflection(id: string) {
  return request<{ deleted: true }>(`/api/reflections/${id}`, {
    method: "DELETE",
  });
}

export function overlayWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}
