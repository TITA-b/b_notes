import { createClient } from "@/lib/supabase/client";
import type { AreaId, Note } from "@/types/note";

function extractWikilinks(markdown: string): string[] {
  const unescaped = markdown.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  const regex = /\[\[([^\]]+)\]\]/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(unescaped)) !== null) {
    const clean = match[1].trim();
    if (clean) found.add(clean);
  }

  return Array.from(found);
}

export async function getNotesByArea(area: AreaId): Promise<Note[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("area", area)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Note[];
}

export async function createNote(area: AreaId, title = "Sin título"): Promise<Note> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({ area, title, content: "", links: [] })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Note;
}

export async function updateNote(
  id: string,
  updates: { title?: string; content?: string }
): Promise<Note> {
  const supabase = createClient();
  const payload: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.content === "string") {
    payload.links = extractWikilinks(updates.content);
  }

  const { data, error } = await supabase
    .from("notes")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Note;
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function findOrCreateNoteByTitle(
  title: string,
  fallbackArea: AreaId
): Promise<Note> {
  const supabase = createClient();
  const cleanTitle = title.trim();

  const { data: existing, error: searchError } = await supabase
    .from("notes")
    .select("*")
    .ilike("title", cleanTitle)
    .limit(1)
    .maybeSingle();

  if (searchError) throw new Error(searchError.message);
  if (existing) return existing as Note;

  return createNote(fallbackArea, cleanTitle);
}