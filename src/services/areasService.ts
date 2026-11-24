import type { Area } from "@/types/note";
import { apiRequest, jsonBody } from "@/services/apiClient";
import {
  clearOfflineCacheStorage,
  isNetworkFailure,
  notifyOfflineCacheUsed,
  readOfflineCache,
  writeOfflineCache,
} from "@/services/offlineCache";

const AREAS_CACHE_KEY = "bnotes_cache_areas";

export function clearOfflineCache(): void {
  clearOfflineCacheStorage();
}

function createSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getAreas(): Promise<Area[]> {
  try {
    const areas = await apiRequest<Area[]>("/api/data/areas");
    writeOfflineCache(AREAS_CACHE_KEY, areas);
    return areas;
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = readOfflineCache<Area>(AREAS_CACHE_KEY);
      if (cached) {
        notifyOfflineCacheUsed();
        return cached;
      }
    }
    throw error;
  }
}

export async function createArea(input: {
  name: string;
  icon: string;
  color: string;
}): Promise<Area> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre del área es obligatorio.");

  const slug = createSlug(name);
  if (!slug) throw new Error("El nombre no genera un slug válido.");

  await getAreas();
  return apiRequest<Area>("/api/data/areas", {
    method: "POST",
    body: jsonBody({ slug, name, icon: input.icon, color: input.color }),
  });
}

export async function updateArea(
  id: string,
  updates: { name?: string; icon?: string; color?: string }
): Promise<Area> {
  const payload = {
    ...updates,
    ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
  };
  if (payload.name === "") throw new Error("El nombre del área es obligatorio.");

  return apiRequest<Area>("/api/data/areas", {
    method: "PATCH",
    body: jsonBody({ id, ...payload }),
  });
}

export async function deleteArea(
  id: string,
  fallbackSlug: string
): Promise<void> {
  await apiRequest<void>("/api/data/areas", {
    method: "DELETE",
    body: jsonBody({ id, fallbackSlug }),
  });
}
