export type AreaId = string;

export const GENERAL_AREA_ID = "__general__";

export interface Area {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  position: number;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  area: AreaId;
  title: string;
  content: string;
  links: string[];
  created_at: string;
  updated_at: string;
}

export interface NoteTemplate {
  id: string;
  name: string;
  area_slug: string | null;
  default_title: string;
  content: string;
  position: number;
  is_default?: boolean;
}