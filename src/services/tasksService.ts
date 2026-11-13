import { createClient } from "@/lib/supabase/client";
import type { AreaId } from "@/types/note";
import type { Task, TaskAttachment } from "@/types/task";

export async function getTasksByArea(area: AreaId): Promise<Task[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("area", area)
    .order("completed", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
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