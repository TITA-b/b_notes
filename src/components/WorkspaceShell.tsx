"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck2,
  ChevronDown,
  FileText,
  FilePlus2,
  LayoutTemplate,
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
import { QuickCaptureModal } from "@/components/QuickCaptureModal";
import { TemplateManagerModal } from "@/components/TemplateManagerModal";
import { getAreas } from "@/services/areasService";
import { clearServiceWorkerRuntimeCache } from "@/services/offlineCache";
import { getNoteTemplatesForArea } from "@/lib/noteTemplates";
import { getTemplates } from "@/services/templatesService";
import {
  clearOfflineCache,
  createNote,
  deleteNote,
  findOrCreateNoteByTitle,
  getAllNotes,
  getNotesByArea,
  updateNote,
} from "@/services/notesService";
import type { Area, AreaId, Note, NoteTemplate } from "@/types/note";

interface WorkspaceShellProps {
  userEmail: string;
}

export function WorkspaceShell({ userEmail }: WorkspaceShellProps) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [areaManagerOpen, setAreaManagerOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
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
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [closeLightboxSignal, setCloseLightboxSignal] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const [shareCaptureError, setShareCaptureError] = useState<string | null>(null);
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0);
  const historyLayersRef = useRef<string[]>([]);
  const skipNextPopRef = useRef(false);
  const mobileEditingRef = useRef(mobileEditing);
  const pendingNoteId = useRef<string | null>(null);
  const templateMenuRef = useRef<HTMLDetailsElement>(null);
  const shareTargetHandledRef = useRef(false);
  const notes =
    notesState.area === activeArea ? notesState.notes : [];
  const loading =
    notesState.area !== activeArea || notesState.loading;
  const notesError =
    notesState.area === activeArea ? notesState.error : null;
  const activeAreaInfo = areas.find((area) => area.slug === activeArea);
  const activeAreaName = activeAreaInfo?.name ?? activeArea;

  useEffect(() => {
    mobileEditingRef.current = mobileEditing;
  }, [mobileEditing]);

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

  useEffect(() => {
    let cancelled = false;
    getTemplates()
      .then((loadedTemplates) => {
        if (cancelled) return;
        setTemplates(loadedTemplates);
        setTemplatesError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTemplatesError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las plantillas."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const pushHistoryLayer = useCallback((layer: string) => {
    window.history.pushState(
      { ...(window.history.state ?? {}), bnotesLayer: layer },
      ""
    );
    historyLayersRef.current.push(layer);
  }, []);

  const closeHistoryLayer = useCallback((layer: string) => {
    if (historyLayersRef.current[historyLayersRef.current.length - 1] !== layer) {
      return;
    }
    historyLayersRef.current.pop();
    skipNextPopRef.current = true;
    window.history.back();
  }, []);

  const drainStaleTabHistory = useCallback(() => {
    if (historyLayersRef.current[historyLayersRef.current.length - 1] !== "tab") {
      return;
    }
    historyLayersRef.current.pop();
    skipNextPopRef.current = true;
    window.history.back();
  }, []);

  const drainClosedModalHistory = useCallback(() => {
    const layer = historyLayersRef.current[historyLayersRef.current.length - 1];
    const isClosed =
      (layer === "lightbox" && !lightboxOpen) ||
      (layer === "quick-capture" && !quickCaptureOpen) ||
      (layer === "global-search" && !globalSearchOpen) ||
      (layer === "area-manager" && !areaManagerOpen) ||
      (layer === "template-manager" && !templateManagerOpen) ||
      (layer === "ai" && !aiOpen);
    if (!isClosed) return;
    historyLayersRef.current.pop();
    skipNextPopRef.current = true;
    window.history.back();
  }, [
    aiOpen,
    areaManagerOpen,
    globalSearchOpen,
    lightboxOpen,
    quickCaptureOpen,
    templateManagerOpen,
  ]);

  const openMobileEditor = useCallback(() => {
    if (
      !mobileEditingRef.current &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      pushHistoryLayer("mobile-edit");
    }
    setMobileEditing(true);
  }, [pushHistoryLayer]);

  const closeMobileEditor = useCallback(() => {
    closeHistoryLayer("mobile-edit");
    setMobileEditing(false);
  }, [closeHistoryLayer]);

  const selectTab = useCallback(
    (tab: "notes" | "tasks" | "graph", preserveHistory = false) => {
      if (tab === activeTab) return;
      if (tab === "notes") {
        if (!preserveHistory) closeHistoryLayer("tab");
      } else {
        pushHistoryLayer("tab");
      }
      setActiveTab(tab);
    },
    [activeTab, closeHistoryLayer, pushHistoryLayer]
  );

  const openGlobalSearch = useCallback(() => {
    if (!globalSearchOpen) pushHistoryLayer("global-search");
    setGlobalSearchOpen(true);
  }, [globalSearchOpen, pushHistoryLayer]);

  const closeGlobalSearch = useCallback(() => {
    closeHistoryLayer("global-search");
    setGlobalSearchOpen(false);
  }, [closeHistoryLayer]);

  const openTemplateManager = useCallback(() => {
    if (!templateManagerOpen) pushHistoryLayer("template-manager");
    setTemplateManagerOpen(true);
  }, [pushHistoryLayer, templateManagerOpen]);

  const closeTemplateManager = useCallback(() => {
    closeHistoryLayer("template-manager");
    setTemplateManagerOpen(false);
  }, [closeHistoryLayer]);

  useEffect(() => {
    function handlePopState() {
      if (skipNextPopRef.current) {
        skipNextPopRef.current = false;
        if (activeTab === "notes") drainStaleTabHistory();
        drainClosedModalHistory();
        return;
      }

      const layer = historyLayersRef.current.pop();
      switch (layer) {
        case "lightbox":
          setLightboxOpen(false);
          setCloseLightboxSignal((signal) => signal + 1);
          return;
        case "quick-capture":
          setQuickCaptureOpen(false);
          return;
        case "global-search":
          setGlobalSearchOpen(false);
          return;
        case "area-manager":
          setAreaManagerOpen(false);
          return;
        case "template-manager":
          setTemplateManagerOpen(false);
          return;
        case "ai":
          setAiOpen(false);
          return;
        case "mobile-edit":
          setMobileEditing(false);
          drainStaleTabHistory();
          drainClosedModalHistory();
          return;
        case "tab":
          setActiveTab("notes");
          drainStaleTabHistory();
          return;
      }

      if (lightboxOpen) {
        setLightboxOpen(false);
        setCloseLightboxSignal((signal) => signal + 1);
      } else if (quickCaptureOpen) {
        setQuickCaptureOpen(false);
      } else if (globalSearchOpen) {
        setGlobalSearchOpen(false);
      } else if (areaManagerOpen) {
        setAreaManagerOpen(false);
      } else if (templateManagerOpen) {
        setTemplateManagerOpen(false);
      } else if (aiOpen) {
        setAiOpen(false);
      } else if (
        activeTab === "notes" &&
        mobileEditing &&
        window.matchMedia("(max-width: 767px)").matches
      ) {
        setMobileEditing(false);
      } else if (activeTab !== "notes") {
        setActiveTab("notes");
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    activeTab,
    aiOpen,
    areaManagerOpen,
    globalSearchOpen,
    lightboxOpen,
    mobileEditing,
    quickCaptureOpen,
    templateManagerOpen,
    drainStaleTabHistory,
    drainClosedModalHistory,
  ]);

  useEffect(() => {
    let cancelled = false;
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      clearOfflineCache();
      clearServiceWorkerRuntimeCache();
      setTasksRefreshKey((key) => key + 1);

      getAllNotes()
        .then((freshNotes) => {
          if (cancelled) return;
          const areaNotes = freshNotes.filter((note) => note.area === activeArea);
          setNotesState({
            area: activeArea,
            notes: areaNotes,
            loading: false,
            error: null,
          });
          setSelectedNoteId((current) =>
            areaNotes.some((note) => note.id === current)
              ? current
              : (areaNotes[0]?.id ?? null)
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setNotesState((current) =>
            current.area === activeArea
              ? {
                  ...current,
                  error:
                    error instanceof Error
                      ? error.message
                      : "No se pudieron actualizar las notas.",
                }
              : current
          );
        });

      getAreas()
        .then((freshAreas) => {
          if (cancelled) return;
          setAreas(freshAreas);
          setAreasError(null);
          setActiveArea((current) =>
            freshAreas.some((area) => area.slug === current)
              ? current
              : (freshAreas[0]?.slug ?? "")
          );
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setAreasError(
              error instanceof Error
                ? error.message
                : "No se pudieron actualizar las áreas."
            );
          }
        });
    };
    const handleCachedFallback = () => setIsOffline(true);
    const initialOfflineCheck = window.setTimeout(() => {
      if (!navigator.onLine) handleOffline();
    }, 0);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("bnotes:offline-cache", handleCachedFallback);
    return () => {
      cancelled = true;
      window.clearTimeout(initialOfflineCheck);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("bnotes:offline-cache", handleCachedFallback);
    };
  }, [activeArea]);

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
        if (preferredNoteId && selected) openMobileEditor();
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
  }, [activeArea, openMobileEditor]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (globalSearchOpen) closeGlobalSearch();
        else openGlobalSearch();
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [closeGlobalSearch, globalSearchOpen, openGlobalSearch]);

  function handleSelectArea(area: AreaId) {
    if (area === activeArea) return;
    pendingNoteId.current = null;
    setSelectedNoteId(null);
    closeMobileEditor();
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
      closeMobileEditor();
      setActiveArea(selectedArea);
    }
  }

  const updateNotes = useCallback((updater: (current: Note[]) => Note[]) => {
    setNotesState((current) =>
      current.area === activeArea
        ? { ...current, notes: updater(current.notes) }
        : current
    );
  }, [activeArea]);

  const handleTemplatesChanged = useCallback(
    (updatedTemplates: NoteTemplate[]) => {
      setTemplates(updatedTemplates);
      setTemplatesError(null);
      setTemplatesLoading(false);
    },
    []
  );

  const handleSelectNote = useCallback((note: Note) => {
    selectTab("notes", true);
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
    openMobileEditor();
  }, [
    activeArea,
    notesState.area,
    notesState.loading,
    openMobileEditor,
    selectTab,
    updateNotes,
  ]);

  useEffect(() => {
    if (areas.length === 0 || shareTargetHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const shareTitle = params.get("share_title");
    const shareText = params.get("share_text");
    const shareUrl = params.get("share_url");
    if (shareTitle === null && shareText === null && shareUrl === null) return;

    shareTargetHandledRef.current = true;
    const title = shareTitle?.trim() || "Captura compartida";
    const content = [shareText?.trim(), shareUrl?.trim()]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");

    createNote(activeArea, title, content)
      .then((created) => {
        handleSelectNote(created);
        window.history.replaceState({}, "", "/");
      })
      .catch((error: unknown) => {
        setShareCaptureError(
          error instanceof Error
            ? `No se pudo guardar la captura compartida: ${error.message}`
            : "No se pudo guardar la captura compartida."
        );
      });
  }, [activeArea, areas.length, handleSelectNote]);

  async function handleCreateNote(template?: NoteTemplate) {
    const created = await createNote(
      activeArea,
      template?.default_title,
      template?.content
    );
    updateNotes((prev) => [created, ...prev]);
    setSelectedNoteId(created.id);
    openMobileEditor();
    if (template) templateMenuRef.current?.removeAttribute("open");
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
    const wasSelected = selectedNoteId === id;
    updateNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== id);
      if (wasSelected) {
        setSelectedNoteId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
    if (wasSelected) closeMobileEditor();
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
      {areasError || shareCaptureError ? (
        <p role="alert" className="fixed top-16 right-4 z-[60] rounded-lg border border-red-900/70 bg-zinc-950 px-3 py-2 text-xs text-red-300">
          {areasError ?? shareCaptureError}
        </p>
      ) : null}
      <Sidebar
        areas={areas}
        activeArea={activeArea}
        areaManagerOpen={areaManagerOpen}
        onOpenTemplateManager={openTemplateManager}
        onAreaManagerOpenChange={(open) => {
          if (open && !areaManagerOpen) pushHistoryLayer("area-manager");
          if (!open) closeHistoryLayer("area-manager");
          setAreaManagerOpen(open);
        }}
        onSelectArea={handleSelectArea}
        onAreasChanged={handleAreasChanged}
      />

      <div className="flex h-dvh flex-col pt-14 md:pt-0">
        {/* Barra superior de sub-módulos */}
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
            <button
              type="button"
              onClick={() => selectTab("notes")}
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
              onClick={() => selectTab("tasks")}
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
              onClick={() => selectTab("graph")}
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
              onClick={openGlobalSearch}
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
              onClick={() => {
                if (!aiOpen) pushHistoryLayer("ai");
                setAiOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white sm:px-3"
            >
              <Sparkles className="size-3.5 text-emerald-400" />
              <span className="sm:hidden">IA</span>
              <span className="hidden sm:inline">Asistente IA</span>
            </button>

            <span className="hidden text-xs text-zinc-500 md:inline">
              {userEmail}
            </span>
            {isOffline ? (
              <span className="rounded-full border border-amber-800/70 bg-amber-950/40 px-2 py-1 text-[10px] font-medium text-amber-200">
                Modo sin conexión
              </span>
            ) : null}
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
              closeLightboxSignal={closeLightboxSignal}
              onLightboxChange={(open) => {
                if (open && !lightboxOpen) pushHistoryLayer("lightbox");
                if (!open) closeHistoryLayer("lightbox");
                setLightboxOpen(open);
              }}
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
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCreateNote()}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition hover:bg-white"
                  >
                    <Plus className="size-3.5" />
                    Nueva
                  </button>
                  <details ref={templateMenuRef} className="relative">
                    <summary
                      title="Crear nota desde una plantilla"
                      aria-label="Crear nota desde una plantilla"
                      className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                    >
                      <FilePlus2 className="size-3.5" />
                      <ChevronDown className="size-3" />
                    </summary>
                    <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-xl">
                      {templatesError ? (
                        <p role="alert" className="px-3 py-2 text-[11px] text-red-300">
                          {templatesError}
                        </p>
                      ) : templatesLoading ? (
                        <p className="px-3 py-2 text-[11px] text-zinc-500">
                          Cargando plantillas…
                        </p>
                      ) : (
                        getNoteTemplatesForArea(activeArea, templates).map(
                          (template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => handleCreateNote(template)}
                          className="w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
                        >
                          {template.name}
                        </button>
                          )
                        )
                      )}
                      <div className="my-1 border-t border-zinc-800" />
                      <button
                        type="button"
                        onClick={openTemplateManager}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
                      >
                        <LayoutTemplate className="size-3.5" />
                        ⚙ Gestionar plantillas...
                      </button>
                    </div>
                  </details>
                </div>
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
                              openMobileEditor();
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
                            className="absolute right-2 rounded p-1.5 text-zinc-600 opacity-100 transition hover:bg-zinc-800 hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
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
                  onBackMobile={closeMobileEditor}
                  onDelete={handleDeleteNote}
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
        onClose={() => {
          closeHistoryLayer("ai");
          setAiOpen(false);
        }}
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

      {activeTab !== "notes" || !mobileEditing ? (
        <button
          type="button"
        onClick={() => {
          if (!quickCaptureOpen) pushHistoryLayer("quick-capture");
          setQuickCaptureOpen(true);
        }}
          aria-label="Abrir captura rápida"
          title="Captura rápida"
          className="fixed bottom-5 right-5 z-30 flex size-14 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 shadow-lg transition hover:bg-emerald-400 md:hidden"
        >
          <Plus className="size-6" />
        </button>
      ) : null}

      {quickCaptureOpen ? (
        <QuickCaptureModal
          areas={areas}
          activeArea={activeArea}
          onClose={() => {
            closeHistoryLayer("quick-capture");
            setQuickCaptureOpen(false);
          }}
          onNoteCreated={handleSelectNote}
          onTaskCreated={() => {
            setTasksRefreshKey((key) => key + 1);
          }}
        />
      ) : null}

      {templateManagerOpen ? (
        <TemplateManagerModal
          areas={areas}
          onClose={closeTemplateManager}
          onTemplatesChanged={handleTemplatesChanged}
        />
      ) : null}
    </div>
  );
}