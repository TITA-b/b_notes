import type { AreaId } from "@/types/note";
import type { Task, TaskAttachment } from "@/types/task";
import { apiRequest, jsonBody } from "@/services/apiClient";
import {
  clearOfflineCacheStorage,
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const TASKS_CACHE_KEY = "bnotes_cache_tasks";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTaskAttachment(value: unknown): value is TaskAttachment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.url === "string"
  );
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.area === "string" &&
    typeof value.title === "string" &&
    (value.due_date === null || typeof value.due_date === "string") &&
    typeof value.completed === "boolean" &&
    typeof value.sync_to_gcal === "boolean" &&
    (value.gcal_event_id === null || typeof value.gcal_event_id === "string") &&
    typeof value.created_at === "string" &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.every(isTaskAttachment)))
  );
}

function requireTask(value: unknown): Task {
  if (!isTask(value)) {
    throw new Error("La respuesta de tareas no tiene el formato esperado.");
  }
  return value;
}

function requireTasks(value: unknown): Task[] {
  if (!Array.isArray(value) || !value.every(isTask)) {
    throw new Error("La respuesta de tareas no tiene el formato esperado.");
  }
  return value;
}

export function clearOfflineCache(): void {
  clearOfflineCacheStorage();
}

export async function getTasksByArea(area: AreaId): Promise<Task[]> {
  try {
    const tasks = requireTasks(
      await apiRequest<unknown>(
        `/api/data/tasks?area=${encodeURIComponent(area)}`
      )
    );
    const cached = (readOfflineCache<unknown>(TASKS_CACHE_KEY) ?? [])
      .filter(isTask)
      .filter((task) => task.area !== area);
    writeOfflineCache(TASKS_CACHE_KEY, [...cached, ...tasks]);
    return tasks;
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = readOfflineCache<unknown>(TASKS_CACHE_KEY);
      if (cached) {
        notifyOfflineCacheUsed();
        return cached.filter(isTask).filter((task) => task.area === area);
      }
    }
    throw error;
  }
}

export async function createTask(
  area: AreaId,
  title: string,
  dueDate?: string | null,
  attachments: TaskAttachment[] = []
): Promise<Task> {
  return requireTask(
    await apiRequest<unknown>("/api/data/tasks", {
      method: "POST",
      body: jsonBody({
        area,
        title: title.trim(),
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        completed: false,
        sync_to_gcal: false,
        attachments,
      }),
    })
  );
}

export async function updateTask(
  id: string,
  updates: { title?: string; due_date?: string | null; area?: AreaId }
): Promise<Task> {
  const payload = {
    ...updates,
    ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
    ...(updates.due_date !== undefined
      ? {
          due_date: updates.due_date
            ? new Date(updates.due_date).toISOString()
            : null,
        }
      : {}),
  };
  return requireTask(
    await apiRequest<unknown>("/api/data/tasks", {
      method: "PATCH",
      body: jsonBody({ id, ...payload }),
    })
  );
}

export async function importCalendarEventAsTask(
  area: AreaId,
  event: { id: string; summary: string; start: string }
): Promise<Task> {
  const existing = requireTasks(
    await apiRequest<unknown>(
      `/api/data/tasks?gcal_event_id=${encodeURIComponent(event.id)}`
    )
  );
  if (existing[0]) return existing[0];

  return requireTask(
    await apiRequest<unknown>("/api/data/tasks", {
      method: "POST",
      body: jsonBody({
        area,
        title: event.summary,
        due_date: event.start ? new Date(event.start).toISOString() : null,
        completed: false,
        sync_to_gcal: true,
        gcal_event_id: event.id,
      }),
    })
  );
}

export async function updateTaskAttachments(
  id: string,
  attachments: TaskAttachment[]
): Promise<Task> {
  return requireTask(
    await apiRequest<unknown>("/api/data/tasks", {
      method: "PATCH",
      body: jsonBody({ id, attachments }),
    })
  );
}

export async function toggleTaskCompleted(
  id: string,
  completed: boolean
): Promise<Task> {
  return requireTask(
    await apiRequest<unknown>("/api/data/tasks", {
      method: "PATCH",
      body: jsonBody({ id, completed }),
    })
  );
}

export async function deleteTask(id: string): Promise<void> {
  await apiRequest<void>(`/api/data/tasks?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}