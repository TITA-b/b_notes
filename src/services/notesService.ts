import type { AreaId, Note } from "@/types/note";
import { apiRequest, jsonBody } from "@/services/apiClient";
import {
  clearOfflineCacheStorage,
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const NOTES_CACHE_KEY = "bnotes_cache_notes";

export function clearOfflineCache(): void {
  clearOfflineCacheStorage();
}

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
  try {
    const notes = await apiRequest<Note[]>(
      `/api/data/notes?area=${encodeURIComponent(area)}`
    );
    cacheNotes(notes, area);
    return notes;
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedNotes(area);
      if (cached) return cached;
    }
    throw error;
  }
}

export async function createNote(
  area: AreaId,
  title = "Sin título",
  content = ""
): Promise<Note> {
  return apiRequest<Note>("/api/data/notes", {
    method: "POST",
    body: jsonBody({ area, title, content, links: [] }),
  });
}

export async function updateNote(
  id: string,
  updates: { title?: string; content?: string }
): Promise<Note> {
  return apiRequest<Note>("/api/data/notes", {
    method: "PATCH",
    body: jsonBody({
      id,
      ...updates,
      ...(typeof updates.content === "string"
        ? { links: extractWikilinks(updates.content) }
        : {}),
    }),
  });
}

export async function deleteNote(id: string): Promise<void> {
  await apiRequest<void>(`/api/data/notes?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function findOrCreateNoteByTitle(
  title: string,
  fallbackArea: AreaId
): Promise<Note> {
  const cleanTitle = title.trim();
  const existing = await apiRequest<Note[]>(
    `/api/data/notes?title=${encodeURIComponent(cleanTitle)}`
  );
  if (existing[0]) return existing[0];

  return createNote(fallbackArea, cleanTitle);
}

export async function getAllNotes(): Promise<Note[]> {
  try {
    const notes = await apiRequest<Note[]>("/api/data/notes");
    cacheNotes(notes);
    return notes;
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedNotes();
      if (cached) return cached;
    }
    throw error;
  }
}