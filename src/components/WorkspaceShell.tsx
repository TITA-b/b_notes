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