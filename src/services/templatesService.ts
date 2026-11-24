import { createClient } from "@/lib/supabase/client";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import type { NoteTemplate } from "@/types/note";

type TemplateUpdate = Partial<
  Pick<
    NoteTemplate,
    "name" | "area_slug" | "default_title" | "content" | "position"
  >
>;

async function getUserId(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user) throw new Error("Tenés que iniciar sesión para gestionar plantillas.");
  return user.id;
}

async function selectTemplates(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<NoteTemplate[]> {
  const { data, error } = await supabase
    .from("note_templates")
    .select("id, name, area_slug, default_title, content, position, is_default")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as NoteTemplate[];
}

async function seedDefaultTemplates(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  const { error: seedError } = await supabase.from("note_templates").upsert(
    NOTE_TEMPLATES.map((template) => ({ ...template, user_id: userId })),
    { onConflict: "user_id,id", ignoreDuplicates: true }
  );
  if (seedError) throw new Error(seedError.message);

  const { error: markerError } = await supabase
    .from("note_template_settings")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (markerError) throw new Error(markerError.message);
}

export async function getTemplates(): Promise<NoteTemplate[]> {
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const existingTemplates = await selectTemplates(supabase, userId);
  const { data: settings, error: settingsError } = await supabase
    .from("note_template_settings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) throw new Error(settingsError.message);
  if (settings) return existingTemplates;
  if (existingTemplates.length === 0) {
    await seedDefaultTemplates(supabase, userId);
  } else {
    const { error: markerError } = await supabase
      .from("note_template_settings")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (markerError) throw new Error(markerError.message);
  }

  return selectTemplates(supabase, userId);
}

export async function createTemplate(input: {
  name: string;
  area_slug: string | null;
  default_title: string;
  content: string;
}): Promise<NoteTemplate> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la plantilla es obligatorio.");

  await getTemplates();
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { data: lastTemplate, error: positionError } = await supabase
    .from("note_templates")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (positionError) throw new Error(positionError.message);

  const { data, error } = await supabase
    .from("note_templates")
    .insert({
      user_id: userId,
      id: crypto.randomUUID(),
      name,
      area_slug: input.area_slug,
      default_title: input.default_title,
      content: input.content,
      position: (lastTemplate?.position ?? -1) + 1,
      is_default: false,
    })
    .select("id, name, area_slug, default_title, content, position, is_default")
    .single();

  if (error) throw new Error(error.message);
  return data as NoteTemplate;
}

export async function updateTemplate(
  id: string,
  updates: TemplateUpdate
): Promise<NoteTemplate> {
  if (updates.name !== undefined && !updates.name.trim()) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { data, error } = await supabase
    .from("note_templates")
    .update(updates)
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, name, area_slug, default_title, content, position, is_default")
    .single();

  if (error) throw new Error(error.message);
  return data as NoteTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { error } = await supabase
    .from("note_templates")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function resetDefaultTemplates(): Promise<NoteTemplate[]> {
  const supabase = createClient();
  const userId = await getUserId(supabase);
  const { error: deleteError } = await supabase
    .from("note_templates")
    .delete()
    .eq("user_id", userId)
    .eq("is_default", true);

  if (deleteError) throw new Error(deleteError.message);
  await seedDefaultTemplates(supabase, userId);
  return selectTemplates(supabase, userId);
}
