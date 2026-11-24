import { createClient } from "@/lib/supabase/client";
import type { Area } from "@/types/note";
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

const DEFAULT_AREAS = [
  {
    slug: "facultad",
    name: "Facultad",
    icon: "GraduationCap",
    color: "#38bdf8",
  },
  {
    slug: "trabajo",
    name: "Trabajo",
    icon: "Briefcase",
    color: "#a855f7",
  },
  {
    slug: "proyectos",
    name: "Proyectos",
    icon: "FolderKanban",
    color: "#34d399",
  },
  {
    slug: "hobbies",
    name: "Hobbies",
    icon: "Palette",
    color: "#fbbf24",
  },
] as const;

async function getUserId(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user) throw new Error("Tenés que iniciar sesión para gestionar áreas.");
  return user.id;
}

async function getUserAreas(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<Area[]> {
  const { data, error } = await supabase
    .from("areas")
    .select("*")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  const areas = (data ?? []) as Area[];
  writeOfflineCache(AREAS_CACHE_KEY, areas);
  return areas;
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
  const supabase = createClient();
  try {
    const userId = await getUserId(supabase);
    const areas = await getUserAreas(supabase, userId);
    if (areas.length > 0) return areas;

    const { data, error } = await supabase
      .from("areas")
      .insert(
        DEFAULT_AREAS.map((area, position) => ({
          ...area,
          user_id: userId,
          position,
        }))
      )
      .select("*")
      .order("position", { ascending: true });

    if (!error) {
      const seeded = (data ?? []) as Area[];
      writeOfflineCache(AREAS_CACHE_KEY, seeded);
      return seeded;
    }

    const seededAreas = await getUserAreas(supabase, userId);
    if (seededAreas.length > 0) return seededAreas;
    throw new Error(error.message);
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
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { data: lastArea, error: positionError } = await supabase
    .from("areas")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (positionError) throw new Error(positionError.message);

  const { data, error } = await supabase
    .from("areas")
    .insert({
      user_id: userId,
      slug,
      name,
      icon: input.icon,
      color: input.color,
      position: (lastArea?.position ?? -1) + 1,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Area;
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

  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { data, error } = await supabase
    .from("areas")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Area;
}

export async function deleteArea(
  id: string,
  fallbackSlug: string
): Promise<void> {
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { data: area, error: areaError } = await supabase
    .from("areas")
    .select("slug")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (areaError) throw new Error(areaError.message);
  if (area.slug === fallbackSlug) {
    throw new Error("El área de reemplazo debe ser diferente.");
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from("areas")
    .select("slug")
    .eq("slug", fallbackSlug)
    .eq("user_id", userId)
    .maybeSingle();

  if (fallbackError) throw new Error(fallbackError.message);
  if (!fallback) throw new Error("El área de reemplazo ya no existe.");

  const { error: notesError } = await supabase
    .from("notes")
    .update({ area: fallbackSlug })
    .eq("user_id", userId)
    .eq("area", area.slug);

  if (notesError) throw new Error(notesError.message);

  const { error: tasksError } = await supabase
    .from("tasks")
    .update({ area: fallbackSlug })
    .eq("user_id", userId)
    .eq("area", area.slug);

  if (tasksError) throw new Error(tasksError.message);

  const { error: deleteError } = await supabase
    .from("areas")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteError) throw new Error(deleteError.message);
}
