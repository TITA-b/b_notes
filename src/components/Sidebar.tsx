"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CalendarDays,
  CalendarRange,
  Download,
  Globe2,
  LogOut,
  LayoutTemplate,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import { clearServiceWorkerRuntimeCache } from "@/services/offlineCache";
import { downloadAllNotesAsZip } from "@/lib/exportNotes";
import { getAreaIcon } from "@/lib/areaIcons";
import { clearOfflineCache, getAllNotes } from "@/services/notesService";
import { AreaManagerModal } from "@/components/AreaManagerModal";
import { GENERAL_AREA_ID, type Area, type AreaId } from "@/types/note";

interface SidebarProps {
  areas: Area[];
  activeArea: AreaId;
  areaManagerOpen: boolean;
  onAreaManagerOpenChange: (open: boolean) => void;
  onOpenTemplateManager: () => void;
  onOpenDailyNote: () => void;
  onOpenWeeklyNote: () => void;
  onSelectArea: (area: AreaId) => void;
  onAreasChanged: (areas: Area[], nextActiveArea?: string) => void;
}

export function Sidebar({
  areas,
  activeArea,
  areaManagerOpen,
  onAreaManagerOpenChange,
  onOpenTemplateManager,
  onOpenDailyNote,
  onOpenWeeklyNote,
  onSelectArea,
  onAreasChanged,
}: SidebarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    function handleOnline() {
      clearOfflineCache();
      clearServiceWorkerRuntimeCache();
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    clearOfflineCache();
    clearServiceWorkerRuntimeCache();
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("No se pudo cerrar la sesión.");
      }
      router.push("/login");
      router.refresh();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "No se pudo cerrar la sesión."
      );
    } finally {
      setSigningOut(false);
    }
  }

  async function exportBackup() {
    setExporting(true);
    setExportError(null);
    try {
      const notes = await getAllNotes();
      await downloadAllNotesAsZip(notes, areas);
      setOpen(false);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "No se pudo exportar el backup."
      );
    } finally {
      setExporting(false);
    }
  }

  const navigation = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <div>
          <p className="text-xs tracking-[0.18em] text-zinc-500 uppercase">
            Núcleo
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-100">
            B_Notes
          </p>
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 md:hidden"
          aria-label="Cerrar menú"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </button>
      </div>

      <nav aria-label="Áreas" className="flex flex-1 flex-col gap-1 px-3">
        <div className="mb-2 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-2">
          <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.14em] text-zinc-500 uppercase">
            Acceso rápido
          </p>
          <button
            type="button"
            onClick={() => {
              onOpenDailyNote();
              setOpen(false);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
          >
            <CalendarDays className="size-4 text-sky-400" />
            Nota de hoy
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenWeeklyNote();
              setOpen(false);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
          >
            <CalendarRange className="size-4 text-violet-400" />
            Hoja semanal
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelectArea(GENERAL_AREA_ID);
            setOpen(false);
          }}
          className={`flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm transition ${
            activeArea === GENERAL_AREA_ID
              ? "bg-zinc-900 font-medium text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-100"
          }`}
        >
          <Globe2 className="size-4 text-zinc-300" />
          General
        </button>
        {areas.map((area) => {
          const Icon = getAreaIcon(area.icon);
          const isActive = activeArea === area.slug;
          return (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                onSelectArea(area.slug);
                setOpen(false);
              }}
              className={`flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm transition ${
                isActive
                  ? "bg-zinc-900 font-medium text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" style={{ color: area.color }} />
              {area.name}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-zinc-800 p-3">
        <button
          type="button"
          onClick={() => {
            onAreaManagerOpenChange(true);
            setOpen(false);
          }}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
        >
          <Settings2 className="size-4 text-zinc-500" />
          Gestionar áreas
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenTemplateManager();
            setOpen(false);
          }}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
        >
          <LayoutTemplate className="size-4 text-zinc-500" />
          Plantillas
        </button>
        <button
          type="button"
          onClick={exportBackup}
          disabled={exporting}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50 disabled:opacity-60"
        >
          <Download className="size-4 text-zinc-500" />
          {exporting ? "Preparando backup…" : "Exportar backup (.zip)"}
        </button>
        {exportError ? (
          <p role="alert" className="px-3 text-xs leading-5 text-red-300">
            {exportError}
          </p>
        ) : null}
        {signOutError ? (
          <p role="alert" className="px-3 text-xs leading-5 text-red-300">
            {signOutError}
          </p>
        ) : null}
        <button
          type="button"
          aria-expanded={statusOpen}
          onClick={() => setStatusOpen((current) => !current)}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
        >
          <Activity className="size-4 text-emerald-400" />
          Estado del sistema
        </button>
        {statusOpen ? (
          <p className="px-3 text-xs leading-5 text-zinc-500">
            Núcleo operativo. Base de notas conectada con RLS activo.
          </p>
        ) : null}
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50 disabled:opacity-60"
        >
          <LogOut className="size-4 text-zinc-500" />
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 backdrop-blur md:hidden">
        <p className="text-sm font-medium">B_Notes</p>
        <button
          type="button"
          className="rounded-md p-2 text-zinc-300 hover:bg-zinc-900"
          aria-label="Abrir menú"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" />
        </button>
      </header>

      {open ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-zinc-800 bg-zinc-950 transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navigation}
      </aside>

      {areaManagerOpen ? (
        <AreaManagerModal
          areas={areas}
          activeAreaId={activeArea}
          onClose={() => onAreaManagerOpenChange(false)}
          onAreasChanged={(updatedAreas, nextActiveArea) => {
            onAreasChanged(updatedAreas, nextActiveArea);
          }}
        />
      ) : null}
    </>
  );
}