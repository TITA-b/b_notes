"use client";

import { useEffect, useState } from "react";
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
import {
  createNote,
  deleteNote,
  findOrCreateNoteByTitle,
  getNotesByArea,
  updateNote,
} from "@/services/notesService";
import type { AreaId, Note } from "@/types/note";

interface WorkspaceShellProps {
  userEmail: string;
}

export function WorkspaceShell({ userEmail }: WorkspaceShellProps) {
  const [activeArea, setActiveArea] = useState<AreaId>("facultad");
  const [activeTab, setActiveTab] = useState<"notes" | "tasks" | "graph">(
    "notes"
  );
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedNoteId(null);
    setMobileEditing(false);

    getNotesByArea(activeArea)
      .then((data) => {
        if (cancelled) return;
        setNotes(data);
        if (data.length > 0) setSelectedNoteId(data[0].id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeArea]);

  async function handleCreateNote() {
    const created = await createNote(activeArea);
    setNotes((prev) => [created, ...prev]);
    setSelectedNoteId(created.id);
    setMobileEditing(true);
  }

  async function handleSaveNote(
    id: string,
    updates: { title?: string; content?: string }
  ): Promise<Note> {
    const updated = await updateNote(id, updates);
    setNotes((prev) =>
      prev.map((item) => (item.id === id ? updated : item))
    );
    return updated;
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id);
    setNotes((prev) => {
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
    setActiveTab("notes");
    if (target.area !== activeArea) {
      setActiveArea(target.area);
    } else {
      setNotes((prev) =>
        prev.some((n) => n.id === target.id) ? prev : [target, ...prev]
      );
    }
    setSelectedNoteId(target.id);
    setMobileEditing(true);
  }

  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase())
  );

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 md:pl-72">
      <Sidebar activeArea={activeArea} onSelectArea={setActiveArea} />

      <div className="flex h-dvh flex-col pt-14 md:pt-0">
        {/* Barra superior de sub-módulos */}
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("notes")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
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
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "tasks"
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <CalendarCheck2 className="size-3.5" />
              Tareas y Agenda
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("graph")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "graph"
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              <Network className="size-3.5" />
              Grafo
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
            >
              <Sparkles className="size-3.5 text-emerald-400" />
              Asistente IA
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
              onSelectNote={(note) => {
                setActiveArea(note.area);
                setSelectedNoteId(note.id);
                setActiveTab("notes");
                setMobileEditing(true);
              }}
            />
          </div>
        ) : activeTab === "tasks" ? (
          <div className="flex-1 overflow-hidden">
            <TaskBoard key={tasksRefreshKey} area={activeArea} />
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
                <h2 className="text-sm font-semibold capitalize">
                  {activeArea}
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
                  note={selectedNote}
                  onSave={handleSaveNote}
                  onOpenWikilink={handleOpenWikilink}
                  onBackMobile={() => setMobileEditing(false)}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-zinc-500">
                  <FileText className="size-8 text-zinc-700" />
                  <p className="mt-3 text-sm">
                    Seleccioná una nota o creá una nueva en{" "}
                    <span className="capitalize text-zinc-300">
                      {activeArea}
                    </span>
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
        activeNoteId={selectedNoteId}
        activeNoteTitle={selectedNote?.title}
        onActionsExecuted={({ createdNotes, createdTasks, updatedNote }) => {
          if (createdNotes.length > 0) {
            const notesInArea = createdNotes.filter(
              (n) => n.area === activeArea
            );
            if (notesInArea.length > 0) {
              setNotes((prev) => [...notesInArea, ...prev]);
              setSelectedNoteId(notesInArea[0].id);
            }
          }
          if (createdTasks.length > 0) {
            setTasksRefreshKey((k) => k + 1);
          }
          if (updatedNote) {
            setNotes((prev) =>
              prev.map((n) => (n.id === updatedNote.id ? updatedNote : n))
            );
          }
        }}
      />
    </div>
  );
}