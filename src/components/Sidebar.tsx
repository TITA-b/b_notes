"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  LogOut,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAreaIcon } from "@/lib/areaIcons";
import { AreaManagerModal } from "@/components/AreaManagerModal";
import type { Area, AreaId } from "@/types/note";

interface SidebarProps {
  areas: Area[];
  activeArea: AreaId;
  onSelectArea: (area: AreaId) => void;
  onAreasChanged: (areas: Area[], nextActiveArea?: string) => void;
}

export function Sidebar({
  areas,
  activeArea,
  onSelectArea,
  onAreasChanged,
}: SidebarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [areaManagerOpen, setAreaManagerOpen] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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
            setAreaManagerOpen(true);
            setOpen(false);
          }}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
        >
          <Settings2 className="size-4 text-zinc-500" />
          Gestionar áreas
        </button>
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
          onClose={() => setAreaManagerOpen(false)}
          onAreasChanged={(updatedAreas, nextActiveArea) => {
            onAreasChanged(updatedAreas, nextActiveArea);
          }}
        />
      ) : null}
    </>
  );
}