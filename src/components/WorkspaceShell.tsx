"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck2,
  FileText,
  Network,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { NoteEditor } from "@/components/NoteEditor";
import { TaskBoard } from "@/components/TaskBoard";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { AiAssistantDrawer } from "@/components/AiAssistantDrawer";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";
import { getAreas } from "@/services/areasService";
import {
  createNote,
  deleteNote,
  findOrCreateNoteByTitle,
  getNotesByArea,
  updateNote,
} from "@/services/notesService";
import type { Area, AreaId, Note } from "@/types/note";

interface WorkspaceShellProps {
  userEmail: string;
}

export function WorkspaceShell({ userEmail }: WorkspaceShellProps) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<AreaId>("facultad");
  const [activeTab, setActiveTab] = useState<"notes" | "tasks" | "graph">(
    "notes"
  );
  const [notesState, setNotesState] = useState<{
    area: AreaId;
    notes: Note[];
    loading: boolean;
    error: string | null;
  }>({ area: "facultad", notes: [], loading: true, error: null });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  const pendingNoteId = useRef<string | null>(null);
  const notes =
    notesState.area === activeArea ? notesState.notes : [];
  const loading =
    notesState.area !== activeArea || notesState.loading;
  const notesError =
    notesState.area === activeArea ? notesState.error : null;
  const activeAreaInfo = areas.find((area) => area.slug === activeArea);
  const activeAreaName = activeAreaInfo?.name ?? activeArea;

  useEffect(() => {
    let cancelled = false;
    getAreas()
      .then((loadedAreas) => {
        if (cancelled) return;
        setAreas(loadedAreas);
        setActiveArea((current) =>
          loadedAreas.some((area) => area.slug === current)
            ? current
            : (loadedAreas[0]?.slug ?? "")
        );
        setAreasError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAreasError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las áreas."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const closeGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const noteToOpen = pendingNoteId.current;
    pendingNoteId.current = null;

    getNotesByArea(activeArea)
      .then((data) => {
        if (cancelled) return;
        setNotesState({
          area: activeArea,
          notes: data,
          loading: false,
          error: null,
        });
        const preferredNoteId = noteToOpen ?? pendingNoteId.current;
        pendingNoteId.current = null;
        const selected = preferredNoteId
          ? data.find((note) => note.id === preferredNoteId)
          : undefined;
        setSelectedNoteId(selected?.id ?? data[0]?.id ?? null);
        if (preferredNoteId && selected) setMobileEditing(true);
        if (!preferredNoteId) setMobileEditing(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotesState({
          area: activeArea,
          notes: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las notas.",
        });
        setSelectedNoteId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeArea]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (globalSearchOpen) closeGlobalSearch();
        else setGlobalSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [closeGlobalSearch, globalSearchOpen]);

  function handleSelectArea(area: AreaId) {
    if (area === activeArea) return;
    pendingNoteId.current = null;
    setSelectedNoteId(null);
    setMobileEditing(false);
    setActiveArea(area);
  }

  function handleAreasChanged(updatedAreas: Area[], nextActiveArea?: string) {
    pendingNoteId.current = null;
    setAreas(updatedAreas);
    setAreasError(null);

    const selectedArea =
      nextActiveArea ??
      (updatedAreas.some((area) => area.slug === activeArea)
        ? activeArea
        : updatedAreas[0]?.slug);

    if (selectedArea && selectedArea !== activeArea) {
      setSelectedNoteId(null);
      setMobileEditing(false);
      setActiveArea(selectedArea);
    }
  }

  function updateNotes(updater: (current: Note[]) => Note[]) {
    setNotesState((current) =>
      current.area === activeArea
        ? { ...current, notes: updater(current.notes) }
        : current
    );
  }

  function handleSelectNote(note: Note) {
    setActiveTab("notes");
    if (note.area !== activeArea) {
      pendingNoteId.current = note.id;
      setActiveArea(note.area);
      return;
    }
    if (notesState.area !== activeArea || notesState.loading) {
      pendingNoteId.current = note.id;
    }

    updateNotes((current) =>
      current.some((item) => item.id === note.id) ? current : [note, ...current]
    );
    setSelectedNoteId(note.id);
    setMobileEditing(true);
  }

  async function handleCreateNote() {
    const created = await createNote(activeArea);
    updateNotes((prev) => [created, ...prev]);
    setSelectedNoteId(created.id);
    setMobileEditing(true);
  }

  async function handleSaveNote(
    id: string,
    updates: { title?: string; content?: string }
  ): Promise<Note> {
    const updated = await updateNote(id, updates);
    updateNotes((prev) =>
      prev.map((item) => (item.id === id ? updated : item))
    );
    return updated;
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id);
    updateNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== id);
      if (selectedNoteId === id) {
        setSelectedNoteId(remaining[0]?.id ?? null);
        setMobileEditing(false);
      }
      return remaining;
    });
  }

  async function handleOpenWikilink(linkTitle: string) {
    const target = await findOrCreateNoteByTitle(linkTitle, activeArea);
    handleSelectNote(target);
  }

  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase())
  );

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 md:pl-72">
      {areasError ? (
        <p role="alert" className="fixed top-16 right-4 z-[60] rounded-lg border border-red-900/70 bg-zinc-950 px-3 py-2 text-xs text-red-300">
          {areasError}
        </p>
      ) : null}
      <Sidebar
        areas={areas}
        activeArea={activeArea}
        onSelectArea={handleSelectArea}
        onAreasChanged={handleAreasChanged}
      />

      <div className="flex h-dvh flex-col pt-14 md:pt-0">
        {/* Barra superior de sub-módulos */}
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("notes")}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition sm:px-3 ${
                activeTab === "notes"
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <NotebookPen className="size-3.5" />
              Notas
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tasks")}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition sm:px-3 ${
                activeTab === "tasks"
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <CalendarCheck2 className="size-3.5" />
              <span className="sm:hidden">Tareas</span>
              <span className="hidden sm:inline">Tareas y Agenda</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("graph")}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition sm:px-3 ${
                activeTab === "graph"
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <Network className="size-3.5" />
              Grafo
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-3">
            <button
              type="button"
              onClick={() => setGlobalSearchOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white sm:px-3"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Buscar</span>
              <kbd className="hidden rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-zinc-500 sm:inline">
                Ctrl+K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white sm:px-3"
            >
              <Sparkles className="size-3.5 text-emerald-400" />
              <span className="sm:hidden">IA</span>
              <span className="hidden sm:inline">Asistente IA</span>
            </button>

            <span className="hidden text-xs text-zinc-500 md:inline">
              {userEmail}
            </span>
          </div>
        </header>

        {activeTab === "graph" ? (
          <div className="flex-1 overflow-hidden">
            <KnowledgeGraph
              activeArea={activeArea}
              onSelectNote={handleSelectNote}
            />
          </div>
        ) : activeTab === "tasks" ? (
          <div className="flex-1 overflow-hidden">
            <TaskBoard
              key={`${activeArea}:${tasksRefreshKey}`}
              area={activeArea}
              areaName={activeAreaName}
            />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Lista de notas del área */}
            <section
              className={`w-full flex-col border-r border-zinc-800 bg-zinc-950 md:flex md:w-80 ${
                mobileEditing ? "hidden" : "flex"
              }`}
            >
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {activeAreaName}
                </h2>
                <button
                  type="button"
                  onClick={handleCreateNote}
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-white"
                >
                  <Plus className="size-3.5" />
                  Nueva
                </button>
              </div>

              <div className="border-b border-zinc-800/80 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar en esta área…"
                    className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 pr-3 pl-8 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                  <p className="px-3 py-6 text-center text-xs text-zinc-500">
                    Cargando notas…
                  </p>
                ) : notesError ? (
                  <p role="alert" className="px-3 py-6 text-center text-xs text-red-300">
                    {notesError}
                  </p>
                ) : filteredNotes.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-zinc-500">
                    No hay notas acá todavía. Tocá &ldquo;Nueva&rdquo; para
                    empezar.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filteredNotes.map((item) => {
                      const isSelected = item.id === selectedNoteId;
                      return (
                        <li
                          key={item.id}
                          className="group relative flex items-center"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedNoteId(item.id);
                              setMobileEditing(true);
                            }}
                            className={`flex w-full flex-col rounded-lg px-3 py-2.5 pr-9 text-left transition ${
                              isSelected
                                ? "bg-zinc-900 text-zinc-50"
                                : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
                            }`}
                          >
                            <span className="truncate text-sm font-medium">
                              {item.title || "Sin título"}
                            </span>
                            <span className="mt-0.5 truncate text-xs text-zinc-500">
                              {item.content
                                ? item.content
                                    .replace(/[#*`\[\]]/g, "")
                                    .slice(0, 60)
                                : "Nota vacía"}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Eliminar nota"
                            onClick={() => handleDeleteNote(item.id)}
                            className="absolute right-2 rounded p-1.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-red-300 group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            {/* Lienzo del editor */}
            <main
              className={`flex-1 flex-col bg-zinc-950 ${
                mobileEditing ? "flex" : "hidden md:flex"
              }`}
            >
              {selectedNote ? (
                <NoteEditor
                  key={selectedNote.id}
                  note={selectedNote}
                  areaName={
                    areas.find((area) => area.slug === selectedNote.area)?.name ??
                    selectedNote.area
                  }
                  areas={areas}
                  onSave={handleSaveNote}
                  onOpenWikilink={handleOpenWikilink}
                  onBackMobile={() => setMobileEditing(false)}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-zinc-500">
                  <FileText className="size-8 text-zinc-700" />
                  <p className="mt-3 text-sm">
                    Seleccioná una nota o creá una nueva en{" "}
                    <span className="text-zinc-300">{activeAreaName}</span>
                    .
                  </p>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      <AiAssistantDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        activeArea={activeArea}
        activeAreaName={activeAreaName}
        activeNoteId={selectedNoteId}
        activeNoteTitle={selectedNote?.title}
        onActionsExecuted={({ createdNotes, createdTasks, updatedNote }) => {
          if (createdNotes.length > 0) {
            const notesInArea = createdNotes.filter(
              (n) => n.area === activeArea
            );
            if (notesInArea.length > 0) {
              updateNotes((prev) => [...notesInArea, ...prev]);
              setSelectedNoteId(notesInArea[0].id);
            }
          }
          if (createdTasks.length > 0) {
            setTasksRefreshKey((k) => k + 1);
          }
          if (updatedNote) {
            updateNotes((prev) =>
              prev.map((n) => (n.id === updatedNote.id ? updatedNote : n))
            );
          }
        }}
      />

      <GlobalSearchModal
        key={globalSearchOpen ? "open" : "closed"}
        open={globalSearchOpen}
        onClose={closeGlobalSearch}
        onSelectNote={handleSelectNote}
        areas={areas}
      />
    </div>
  );
}