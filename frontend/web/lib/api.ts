import type { LockZone, OverlayState, Todo } from "@slaythelist/contracts";

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

export async function createTodo(title: string) {
  return request<Todo>("/api/todos", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function setTodoStatus(id: string, status: "pending" | "done") {
  return request<Todo>(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
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

export function overlayWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}
