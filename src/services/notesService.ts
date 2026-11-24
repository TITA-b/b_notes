import { createClient } from "@/lib/supabase/client";
import type { AreaId, Note } from "@/types/note";
import {
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const NOTES_CACHE_KEY = "bnotes_cache_notes";

function cacheNotes(notes: Note[], area?: AreaId): void {
  const cached = area
    ? (readOfflineCache<Note>(NOTES_CACHE_KEY) ?? []).filter(
        (note) => note.area !== area
      )
    : [];
  writeOfflineCache(NOTES_CACHE_KEY, [...cached, ...notes]);
}

function getCachedNotes(area?: AreaId): Note[] | null {
  const cached = readOfflineCache<Note>(NOTES_CACHE_KEY);
  if (!cached) return null;
  notifyOfflineCacheUsed();
  return area ? cached.filter((note) => note.area === area) : cached;
}

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

  if (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedNotes(area);
      if (cached) return cached;
    }
    throw new Error(error.message);
  }
  const notes = (data ?? []) as Note[];
  cacheNotes(notes, area);
  return notes;
}

export async function createNote(
  area: AreaId,
  title = "Sin título",
  content = ""
): Promise<Note> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({ area, title, content, links: [] })
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

export async function getAllNotes(): Promise<Note[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedNotes();
      if (cached) return cached;
    }
    throw new Error(error.message);
  }
  const notes = (data ?? []) as Note[];
  cacheNotes(notes);
  return notes;
}