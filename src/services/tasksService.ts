import { createClient } from "@/lib/supabase/client";
import type { AreaId } from "@/types/note";
import type { Task, TaskAttachment } from "@/types/task";
import {
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const TASKS_CACHE_KEY = "bnotes_cache_tasks";

export async function getTasksByArea(area: AreaId): Promise<Task[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("area", area)
    .order("completed", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (isNetworkFailure(error)) {
      const cached = readOfflineCache<Task>(TASKS_CACHE_KEY);
      if (cached) {
        notifyOfflineCacheUsed();
        return cached.filter((task) => task.area === area);
      }
    }
    throw new Error(error.message);
  }
  const tasks = (data ?? []) as Task[];
  const cached = (readOfflineCache<Task>(TASKS_CACHE_KEY) ?? []).filter(
    (task) => task.area !== area
  );
  writeOfflineCache(TASKS_CACHE_KEY, [...cached, ...tasks]);
  return tasks;
}

export async function createTask(
  area: AreaId,
  title: string,
  dueDate?: string | null,
  attachments: TaskAttachment[] = []
): Promise<Task> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      area,
      title: title.trim(),
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      completed: false,
      sync_to_gcal: false,
      attachments,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function updateTask(
  id: string,
  updates: { title?: string; due_date?: string | null; area?: AreaId }
): Promise<Task> {
  const supabase = createClient();
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
  const { data, error } = await supabase
    .from("tasks")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function importCalendarEventAsTask(
  area: AreaId,
  event: { id: string; summary: string; start: string }
): Promise<Task> {
  const supabase = createClient();
  const { data: existing, error: lookupError } = await supabase
    .from("tasks")
    .select("*")
    .eq("gcal_event_id", event.id)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);
  if (existing) return existing as Task;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      area,
      title: event.summary,
      due_date: event.start ? new Date(event.start).toISOString() : null,
      completed: false,
      sync_to_gcal: true,
      gcal_event_id: event.id,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function updateTaskAttachments(
  id: string,
  attachments: TaskAttachment[]
): Promise<Task> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ attachments })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function toggleTaskCompleted(
  id: string,
  completed: boolean
): Promise<Task> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ completed })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}