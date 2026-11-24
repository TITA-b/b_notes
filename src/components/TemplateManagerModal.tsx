"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import {
  createTemplate,
  deleteTemplate,
  getTemplates,
  resetDefaultTemplates,
  updateTemplate,
} from "@/services/templatesService";
import type { Area, NoteTemplate } from "@/types/note";

interface TemplateDraft {
  name: string;
  area_slug: string | null;
  default_title: string;
  content: string;
}

const EMPTY_DRAFT: TemplateDraft = {
  name: "",
  area_slug: null,
  default_title: "",
  content: "",
};

function toDraft(template: NoteTemplate): TemplateDraft {
  return {
    name: template.name,
    area_slug: template.area_slug,
    default_title: template.default_title,
    content: template.content,
  };
}

interface TemplateManagerModalProps {
  areas: Area[];
  onClose: () => void;
  onTemplatesChanged: (templates: NoteTemplate[]) => void;
}

export function TemplateManagerModal({
  areas,
  onClose,
  onTemplatesChanged,
}: TemplateManagerModalProps) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTemplates = useCallback(
    async (preferredId?: string) => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getTemplates();
        setTemplates(loaded);
        onTemplatesChanged(loaded);
        const selected =
          loaded.find((template) => template.id === preferredId) ?? loaded[0];
        setSelectedId(selected?.id ?? null);
        setDraft(selected ? toDraft(selected) : EMPTY_DRAFT);
      } catch (loadError: unknown) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudieron cargar las plantillas."
        );
      } finally {
        setLoading(false);
      }
    },
    [onTemplatesChanged]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshTemplates();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshTemplates]);

  function startNewTemplate() {
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  function selectTemplate(template: NoteTemplate) {
    setSelectedId(template.id);
    setDraft(toDraft(template));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError("El nombre de la plantilla es obligatorio.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = selectedId
        ? await updateTemplate(selectedId, {
            ...draft,
            name: draft.name.trim(),
          })
        : await createTemplate({
            ...draft,
            name: draft.name.trim(),
          });
      await refreshTemplates(saved.id);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la plantilla."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(template: NoteTemplate) {
    if (!window.confirm(`¿Eliminar la plantilla "${template.name}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTemplate(template.id);
      await refreshTemplates(
        selectedId === template.id ? undefined : selectedId ?? undefined
      );
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar la plantilla."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDefaults() {
    if (!window.confirm("¿Restaurar las plantillas base?")) return;
    setSaving(true);
    setError(null);
    try {
      const restored = await resetDefaultTemplates();
      setTemplates(restored);
      onTemplatesChanged(restored);
      const selected =
        restored.find((template) => template.id === selectedId) ?? restored[0];
      setSelectedId(selected?.id ?? null);
      setDraft(selected ? toDraft(selected) : EMPTY_DRAFT);
    } catch (resetError: unknown) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "No se pudieron restaurar las plantillas base."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="size-4 text-emerald-400" />
            <h2 id="template-manager-title" className="text-sm font-semibold">
              Editor de plantillas
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar editor de plantillas"
            disabled={saving}
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[220px_minmax(0,1fr)] md:overflow-hidden">
          <aside className="border-b border-zinc-800 p-3 md:overflow-y-auto md:border-r md:border-b-0">
            <button
              type="button"
              onClick={startNewTemplate}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
            >
              <Plus className="size-3.5" />
              Nueva plantilla
            </button>

            <div className="mt-3 space-y-1">
              {loading ? (
                <p className="px-2 py-4 text-center text-xs text-zinc-500">
                  Cargando plantillas…
                </p>
              ) : templates.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-zinc-500">
                  Todavía no hay plantillas.
                </p>
              ) : (
                templates.map((template) => (
                  <div
                    key={template.id}
                    className={`flex items-center rounded-lg ${
                      selectedId === template.id ? "bg-zinc-800" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectTemplate(template)}
                      className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-xs text-zinc-300 hover:text-white"
                    >
                      {template.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${template.name}`}
                      disabled={saving}
                      onClick={() => void handleDelete(template)}
                      className="mr-1 rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-300 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleResetDefaults()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-[11px] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              Restaurar plantillas base
            </button>
          </aside>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5"
          >
            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-200"
              >
                {error}
              </p>
            ) : null}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">
                Nombre de la plantilla
              </span>
              <input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Apunte de cursada FADU"
                className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">
                Área asociada
              </span>
              <select
                value={draft.area_slug ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    area_slug: event.target.value || null,
                  }))
                }
                className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
              >
                <option value="">Todas las áreas</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.slug}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">
                Título por defecto
              </span>
              <input
                value={draft.default_title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    default_title: event.target.value,
                  }))
                }
                placeholder="Clase - "
                className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-300">
                Contenido Markdown
              </span>
              <textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                placeholder={"## Temas\n\n- [ ] Pendiente\n\n[[Nota relacionada]]"}
                rows={11}
                spellCheck={false}
                className="min-h-56 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 font-mono text-xs leading-6 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
              <span className="text-[11px] text-zinc-500">
                Podés usar wikilinks como [[Materia]] y checklists - [ ].
              </span>
            </label>

            <div className="flex justify-end border-t border-zinc-800 pt-3">
              <button
                type="submit"
                disabled={saving || loading}
                className="flex h-9 items-center gap-2 rounded-lg bg-zinc-100 px-3.5 text-xs font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-50"
              >
                <Save className="size-3.5" />
                {saving ? "Guardando…" : "Guardar plantilla"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
