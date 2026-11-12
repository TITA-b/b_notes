export type AreaId = "facultad" | "trabajo" | "proyectos" | "hobbies";

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