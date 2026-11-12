import type { AreaId } from "@/types/note";

export interface Task {
  id: string;
  user_id: string;
  area: AreaId;
  title: string;
  due_date: string | null;
  completed: boolean;
  sync_to_gcal: boolean;
  gcal_event_id: string | null;
  created_at: string;
}