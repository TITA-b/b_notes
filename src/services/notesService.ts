import type { AreaId, Note } from "@/types/note";
import { apiRequest, jsonBody } from "@/services/apiClient";
import { unlinkCachedTasksFromNote } from "@/services/tasksService";
import {
  clearOfflineCacheStorage,
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  upsertOfflineCacheItem,
  writeOfflineCache,
} from "@/services/offlineCache";
import {
  enqueueOfflineMutation,
  getPendingOfflineLocalIds,
} from "@/services/offlineSync";

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
    const pendingIds = getPendingOfflineLocalIds(NOTES_CACHE_KEY);
    const pendingLocalNotes = (readOfflineCache<Note>(NOTES_CACHE_KEY) ?? [])
      .filter((note) => pendingIds.has(note.id) && note.area === area);
    const mergedNotes = [
      ...pendingLocalNotes,
      ...notes.filter((note) => !pendingIds.has(note.id)),
    ];
    cacheNotes(mergedNotes, area);
    return mergedNotes;
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
  content = "",
  periodicKey?: string
): Promise<Note> {
  const normalizedTitle = title.trim() || "Sin título";
  const body = jsonBody({
    area,
    title: normalizedTitle,
    content,
    links: [],
    periodic_key: periodicKey,
  });
  try {
    const created = await apiRequest<Note>("/api/data/notes", {
      method: "POST",
      body,
    });
    upsertOfflineCacheItem(NOTES_CACHE_KEY, created);
    return created;
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    const cached = readOfflineCache<Note>(NOTES_CACHE_KEY) ?? [];
    const created: Note = {
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: cached[0]?.user_id ?? "offline",
      area,
      title: normalizedTitle,
      content,
      links: extractWikilinks(content),
      periodic_key: periodicKey ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    enqueueOfflineMutation({
      path: "/api/data/notes",
      method: "POST",
      body,
      cacheKey: NOTES_CACHE_KEY,
      localId: created.id,
    });
    upsertOfflineCacheItem(NOTES_CACHE_KEY, created);
    return created;
  }
}

export async function updateNote(
  id: string,
  updates: { title?: string; content?: string; periodic_key?: string | null }
): Promise<Note> {
  const body = jsonBody({
    id,
    ...updates,
    ...(typeof updates.content === "string"
      ? { links: extractWikilinks(updates.content) }
      : {}),
  });
  try {
    const updated = await apiRequest<Note>("/api/data/notes", {
      method: "PATCH",
      body,
    });
    upsertOfflineCacheItem(NOTES_CACHE_KEY, updated);
    return updated;
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    const cached = readOfflineCache<Note>(NOTES_CACHE_KEY) ?? [];
    const current = cached.find((note) => note.id === id);
    if (!current) throw error;

    const updated: Note = {
      ...current,
      ...updates,
      ...(typeof updates.content === "string"
        ? { links: extractWikilinks(updates.content) }
        : {}),
      updated_at: new Date().toISOString(),
    };
    enqueueOfflineMutation({
      path: "/api/data/notes",
      method: "PATCH",
      body,
      cacheKey: NOTES_CACHE_KEY,
      localId: id,
    });
    upsertOfflineCacheItem(NOTES_CACHE_KEY, updated);
    return updated;
  }
}

export async function deleteNote(id: string): Promise<void> {
  await apiRequest<void>(`/api/data/notes?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  unlinkCachedTasksFromNote(id);
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