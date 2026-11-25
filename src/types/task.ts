import type { AreaId } from "@/types/note";

export interface TaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface Task {
  id: string;
  user_id: string;
  area: AreaId;
  title: string;
  due_date: string | null;
  completed: boolean;
  sync_to_gcal: boolean;
  gcal_event_id: string | null;
  noteId?: string | null;
  created_at: string;
  attachments?: TaskAttachment[];
}
