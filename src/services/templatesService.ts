import type { NoteTemplate } from "@/types/note";
import { apiRequest, jsonBody } from "@/services/apiClient";

type TemplateUpdate = Partial<
  Pick<
    NoteTemplate,
    "name" | "area_slug" | "default_title" | "content" | "position"
  >
>;

export async function getTemplates(): Promise<NoteTemplate[]> {
  return apiRequest<NoteTemplate[]>("/api/data/templates");
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
  return apiRequest<NoteTemplate>("/api/data/templates", {
    method: "POST",
    body: jsonBody({ ...input, name }),
  });
}

export async function updateTemplate(
  id: string,
  updates: TemplateUpdate
): Promise<NoteTemplate> {
  if (updates.name !== undefined && !updates.name.trim()) {
    throw new Error("El nombre de la plantilla es obligatorio.");
  }
  return apiRequest<NoteTemplate>("/api/data/templates", {
    method: "PATCH",
    body: jsonBody({ id, ...updates }),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiRequest<void>(`/api/data/templates?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function resetDefaultTemplates(): Promise<NoteTemplate[]> {
  return apiRequest<NoteTemplate[]>("/api/data/templates", {
    method: "POST",
    body: jsonBody({ action: "resetDefaultTemplates" }),
  });
}
