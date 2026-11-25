"use client";

import { FormEvent, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteArea, createArea, getAreas, updateArea } from "@/services/areasService";
import { AREA_ICON_OPTIONS } from "@/lib/areaIcons";
import type { Area } from "@/types/note";

const AREA_COLORS = [
  "#ef4444",
  "#f87171",
  "#fca5a5",
  "#fb923c",
  "#fdba74",
  "#fed7aa",
  "#f59e0b",
  "#fcd34d",
  "#eab308",
  "#fde047",
  "#84cc16",
  "#bef264",
  "#d9f99d",
  "#22c55e",
  "#bbf7d0",
  "#34d399",
  "#10b981",
  "#6ee7b7",
  "#a7f3d0",
  "#14b8a6",
  "#5eead4",
  "#99f6e4",
  "#06b6d4",
  "#67e8f9",
  "#a5f3fc",
  "#0ea5e9",
  "#38bdf8",
  "#bae6fd",
  "#3b82f6",
  "#60a5fa",
  "#bfdbfe",
  "#6366f1",
  "#818cf8",
  "#c7d2fe",
  "#8b5cf6",
  "#a78bfa",
  "#ddd6fe",
  "#d946ef",
  "#e879f9",
  "#f5d0fe",
  "#ec4899",
  "#f9a8d4",
  "#fbcfe8",
  "#f43f5e",
  "#fecdd3",
  "#64748b",
  "#94a3b8",
  "#cbd5e1",
] as const;

interface AreaManagerModalProps {
  areas: Area[];
  activeAreaId: string;
  onClose: () => void;
  onAreasChanged: (areas: Area[], nextActiveArea?: string) => void;
}

export function AreaManagerModal({
  areas,
  activeAreaId,
  onClose,
  onAreasChanged,
}: AreaManagerModalProps) {
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("FolderKanban");
  const [color, setColor] = useState<string>(AREA_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingArea(null);
    setName("");
    setIcon("FolderKanban");
    setColor(AREA_COLORS[0]);
    setError(null);
  }

  function startEditing(area: Area) {
    setEditingArea(area);
    setName(area.name);
    setIcon(area.icon);
    setColor(area.color);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingArea) {
        await updateArea(editingArea.id, { name, icon, color });
        onAreasChanged(await getAreas());
        resetForm();
      } else {
        const created = await createArea({ name, icon, color });
        onAreasChanged(await getAreas(), created.slug);
        resetForm();
      }
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el área."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(area: Area) {
    if (areas.length <= 1) return;
    const fallback = areas.find((candidate) => candidate.id !== area.id);
    if (!fallback) return;
    if (!window.confirm(`¿Eliminar "${area.name}"? Sus notas y tareas se moverán a "${fallback.name}".`)) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await deleteArea(area.id, fallback.slug);
      onAreasChanged(
        await getAreas(),
        activeAreaId === area.slug ? fallback.slug : undefined
      );
      if (editingArea?.id === area.id) resetForm();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar el área."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="area-manager-title"
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-5 py-4">
          <div>
            <h2 id="area-manager-title" className="text-sm font-semibold text-zinc-100">
              Gestionar áreas
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Creá áreas y personalizá su nombre, ícono y color.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar gestión de áreas"
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid gap-6 p-5 md:grid-cols-[1fr_1.15fr]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-xs font-semibold text-zinc-300">
              {editingArea ? "Editar área" : "Nueva área"}
            </h3>
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">Nombre</span>
              <input
                autoFocus
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={50}
                placeholder="Ej. Lecturas"
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-xs text-zinc-400">Ícono</legend>
              <div className="grid grid-cols-5 gap-2">
                {AREA_ICON_OPTIONS.map(({ name: iconName, Icon }) => (
                  <button
                    key={iconName}
                    type="button"
                    aria-label={iconName}
                    aria-pressed={icon === iconName}
                    onClick={() => setIcon(iconName)}
                    className={`flex size-9 items-center justify-center rounded-lg border transition ${
                      icon === iconName
                        ? "border-zinc-500 bg-zinc-800 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs text-zinc-400">Color</legend>
              <div className="flex flex-wrap gap-2">
                {AREA_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={`Elegir color ${option}`}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    className={`flex size-8 items-center justify-center rounded-full border-2 ${
                      color === option ? "border-white" : "border-transparent"
                    }`}
                    style={{ backgroundColor: option }}
                  >
                    {color === option ? <Check className="size-4 text-zinc-950" /> : null}
                  </button>
                ))}
                <label
                  title="Elegir un color personalizado"
                  className={`relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${
                    AREA_COLORS.some((option) => option === color)
                      ? "border-transparent"
                      : "border-white"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{ backgroundColor: color }}
                  />
                  <input
                    type="color"
                    aria-label="Elegir color personalizado"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                  {!AREA_COLORS.some((option) => option === color) ? (
                    <Check className="relative size-4 text-zinc-950" />
                  ) : null}
                </label>
              </div>
            </fieldset>

            {error ? (
              <p role="alert" className="text-xs leading-5 text-red-300">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
              >
                <Plus className="size-3.5" />
                {saving ? "Guardando…" : editingArea ? "Guardar cambios" : "Crear área"}
              </button>
              {editingArea ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={resetForm}
                  className="h-9 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-300">
              Tus áreas ({areas.length})
            </h3>
            <ul className="space-y-1.5">
              {areas.map((area) => {
                const Icon = AREA_ICON_OPTIONS.find(
                  (option) => option.name === area.icon
                )?.Icon;
                const AreaIcon = Icon ?? AREA_ICON_OPTIONS[2].Icon;
                return (
                  <li
                    key={area.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-3 py-2"
                  >
                    <AreaIcon className="size-4 shrink-0" style={{ color: area.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                      {area.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEditing(area)}
                      aria-label={`Editar ${area.name}`}
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    {areas.length > 1 ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleDelete(area)}
                        aria-label={`Eliminar ${area.name}`}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
