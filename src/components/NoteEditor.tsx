"use client";

/* eslint-disable @next/next/no-img-element -- Google Drive thumbnails load directly from their public URL. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CheckSquare,
  Download,
  ExternalLink,
  FileText,
  Heading1,
  Heading2,
  Link2,
  List,
  Loader2,
  Maximize2,
  Paperclip,
  Play,
  Plus,
  Circle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  findOrCreateNoteByTitle,
  getAllNotes,
} from "@/services/notesService";
import {
  createTask,
  getTasksByNote,
  toggleTaskCompleted,
} from "@/services/tasksService";
import { getAreas } from "@/services/areasService";
import {
  getDriveImagePreviewUrl,
  getDriveViewUrl,
} from "@/lib/driveMedia";
import {
  getDriveUploadHeaders,
  validateDriveUploadSize,
} from "@/lib/driveUpload";
import { downloadNoteAsMarkdown } from "@/lib/exportNotes";
import {
  MediaLightboxModal,
  type LightboxMedia,
} from "@/components/MediaLightboxModal";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import {
  resetWeeklyNote,
  synchronizePeriodicNote,
} from "@/lib/periodicNotes";
import type { Area, Note } from "@/types/note";
import type { Task } from "@/types/task";

interface NoteEditorProps {
  note: Note;
  areaName: string;
  areas: Area[];
  onSave: (id: string, updates: { title?: string; content?: string }) => Promise<Note>;
  onOpenWikilink: (title: string) => void;
  onTasksChanged: () => void;
  tasksRefreshKey: number;
  onBackMobile: () => void;
  onRequestDelete?: (note: Note) => void;
}

interface DriveUploadResponse {
  error?: string;
  requiresReauth?: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    thumbnailUrl?: string | null;
    isVideo?: boolean;
  };
}

interface WikilinkAutocompleteState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
  activeIndex: number;
}

interface PendingAiAttachment {
  id: string;
  noteId: string;
  file: File;
  position: number;
  processing: boolean;
  error: string | null;
}

const EMPTY_NOTES: Note[] = [];

function parseLinksLive(text: string): string[] {
  const cleanText = text.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  const regex = /\[\[([^\]]+)\]\]/g;
  const set = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleanText)) !== null) {
    const val = match[1].trim();
    if (val) set.add(val);
  }
  return Array.from(set);
}

function normalizeWikilinkMarkdown(markdown: string): string {
  return markdown.replace(/\\\[\[([^\[\]\n]+)\\\]\]/g, "[[$1]]");
}

function unescapeMarkdownBrackets(text: string): string {
  return text.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function getAiAttachmentType(file: File): "audio" | "pdf" | null {
  if (
    file.type.startsWith("audio/") ||
    /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(file.name)
  ) {
    return "audio";
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return "pdf";
  }
  return null;
}

function findWikilinkAtPosition(view: EditorView, position: number): string | null {
  const resolvedPosition = view.state.doc.resolve(position);
  if (!resolvedPosition.parent.isTextblock) return null;

  const text = resolvedPosition.parent.textContent;
  const offset = resolvedPosition.parentOffset;
  const regex = /(?:\\?\[){2}([\s\S]+?)(?:\\?\]){2}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      return match[1].trim() || null;
    }
  }

  return null;
}

function getWikilinkSnippet(content: string, title: string): string {
  const unescaped = unescapeMarkdownBrackets(content);
  const wikilink = `[[${title.trim()}]]`.toLocaleLowerCase();
  const paragraph =
    unescaped
      .split(/\n{2,}/)
      .find((part) => part.toLocaleLowerCase().includes(wikilink)) ?? unescaped;
  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph];
  const sentence =
    sentences.find((part) => part.toLocaleLowerCase().includes(wikilink)) ??
    paragraph;
  const snippet = sentence.replace(/\s+/g, " ").trim();

  return snippet.length > 180 ? `${snippet.slice(0, 177)}…` : snippet;
}

function DriveMediaNodeView({ node }: NodeViewProps) {
  const [media, setMedia] = useState<LightboxMedia | null>(null);
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const isVideo = alt.startsWith("🎬 Video:");
  const title = isVideo ? alt.slice("🎬 Video:".length).trim() : alt || "Imagen";
  const driveUrl = getDriveViewUrl(src);

  function openLightbox() {
    setMedia({
      type: isVideo ? "video" : "image",
      src,
      title,
      driveUrl,
    });
  }

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="group relative mx-1 inline-block max-w-full align-middle"
    >
      {isVideo ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLightbox}
          aria-label={`Expandir video ${title}`}
          className="relative flex h-36 w-64 max-w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100"
        >
          <span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs">
            <Play className="size-4 fill-current" />
            {title || "Video"}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLightbox}
          aria-label={`Expandir imagen ${title}`}
          className="block max-w-full cursor-zoom-in"
        >
          <img
            src={getDriveImagePreviewUrl(src)}
            alt={title}
            loading="lazy"
            className="max-h-80 max-w-full cursor-zoom-in rounded-xl border border-zinc-800 object-contain"
          />
        </button>
      )}

      <div className="absolute right-2 top-2 flex gap-1 rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-1 opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          title="Expandir"
          aria-label="Expandir"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLightbox}
          className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <a
          href={driveUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir en Drive"
          aria-label="Abrir en Drive"
          onMouseDown={(event) => event.preventDefault()}
          className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      <MediaLightboxModal media={media} onClose={() => setMedia(null)} />
    </NodeViewWrapper>
  );
}

const DriveMediaImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DriveMediaNodeView);
  },
});

const wikilinkPluginKey = new PluginKey("wikilinkDecorations");
const wikilinkPlugin = new Plugin({
  key: wikilinkPluginKey,
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];

      state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return;

        const regex = /(?:\\?\[){2}([\s\S]+?)(?:\\?\]){2}/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(node.text)) !== null) {
          if (!match[1].trim()) continue;
          decorations.push(
            Decoration.inline(
              position + match.index,
              position + match.index + match[0].length,
              {
                class:
                  "text-emerald-400 underline decoration-emerald-500/50 underline-offset-4 cursor-pointer hover:text-emerald-300",
              }
            )
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});

export function NoteEditor({
  note,
  areaName,
  areas,
  onSave,
  onOpenWikilink,
  onTasksChanged,
  tasksRefreshKey,
  onBackMobile,
  onRequestDelete,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [liveLinks, setLiveLinks] = useState<string[]>(note.links ?? []);
  const [backlinksState, setBacklinksState] = useState<{
    noteId: string;
    title: string;
    notes: Note[];
  } | null>(null);
  const [backlinksErrorState, setBacklinksErrorState] = useState<{
    noteId: string;
    title: string;
    message: string;
  } | null>(null);
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [linkedTasksForNote, setLinkedTasksForNote] = useState<string | null>(
    null
  );
  const [linkedTasksError, setLinkedTasksError] = useState<string | null>(null);
  const [linkedTasksLoading, setLinkedTasksLoading] = useState(true);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [savingLinkedTaskId, setSavingLinkedTaskId] = useState<string | null>(
    null
  );
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [periodicSyncing, setPeriodicSyncing] = useState(false);
  const [weeklyResetOpen, setWeeklyResetOpen] = useState(false);
  const [weeklyResetting, setWeeklyResetting] = useState(false);
  const [periodicError, setPeriodicError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNoteId = useRef(note.id);
  const openWikilinkRef = useRef(onOpenWikilink);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const taskTitleInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFilesHandlerRef = useRef<(files: File[]) => void>(() => {});
  const uploadingFilesRef = useRef(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveNeedsReconnect, setDriveNeedsReconnect] = useState(false);
  const [pendingAiAttachments, setPendingAiAttachments] = useState<
    PendingAiAttachment[]
  >([]);
  const pendingAiAttachmentsRef = useRef<PendingAiAttachment[]>([]);
  const [wikilinkDataState, setWikilinkDataState] = useState<{
    noteId: string;
    notes: Note[];
    areas: Area[];
    error?: string;
  } | null>(null);
  const [wikilinkPopup, setWikilinkPopup] =
    useState<WikilinkAutocompleteState | null>(null);
  const [wikilinkOperationError, setWikilinkOperationError] = useState<
    string | null
  >(null);
  const wikilinkPopupRef = useRef<WikilinkAutocompleteState | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const updateWikilinkPopupRef = useRef<(currentEditor: Editor) => void>(
    () => {}
  );
  const confirmWikilinkRef = useRef<(index: number) => void>(() => {});
  const handleWikilinkKeyDownRef = useRef<(event: KeyboardEvent) => boolean>(
    () => false
  );
  const periodicKind = note.periodic_key?.startsWith("daily:")
    ? "daily"
    : note.periodic_key === "weekly:current"
      ? "weekly"
      : null;

  useEffect(() => {
    openWikilinkRef.current = onOpenWikilink;
  }, [onOpenWikilink]);

  useEffect(() => {
    let cancelled = false;
    const trimmedTitle = note.title.trim();

    if (!trimmedTitle) return;

    getAllNotes()
      .then((allNotes) => {
        if (cancelled) return;
        setBacklinksState({
          noteId: note.id,
          title: trimmedTitle,
          notes: allNotes.filter((item) => {
            if (item.id === note.id) return false;
            const content = unescapeMarkdownBrackets(
              item.content
            ).toLocaleLowerCase();
            return (
              content.includes(trimmedTitle.toLocaleLowerCase()) ||
              (item.links ?? []).some(
                (link) => link.trim().toLocaleLowerCase() ===
                  trimmedTitle.toLocaleLowerCase()
              )
            );
          }),
        });
        setBacklinksErrorState(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBacklinksErrorState({
            noteId: note.id,
            title: trimmedTitle,
            message:
              error instanceof Error
                ? error.message
                : "No se pudieron cargar las menciones.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [note.id, note.title]);

  useEffect(() => {
    let cancelled = false;
    getTasksByNote(note.id)
      .then((tasks) => {
        if (cancelled) return;
        setLinkedTasks(tasks.filter((task) => task.noteId === note.id));
        setLinkedTasksForNote(note.id);
        setLinkedTasksError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLinkedTasksError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las tareas vinculadas."
        );
      })
      .finally(() => {
        if (!cancelled) setLinkedTasksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [note.id, note.area, tasksRefreshKey]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getAllNotes(), getAreas()])
      .then(([allNotes, loadedAreas]) => {
        if (cancelled) return;
        setWikilinkDataState({
          noteId: note.id,
          notes: allNotes.filter((item) => item.id !== note.id),
          areas: loadedAreas,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWikilinkDataState({
          noteId: note.id,
          notes: [],
          areas: [],
          error:
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las notas para sugerir.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [note.id]);

  const wikilinkData =
    wikilinkDataState?.noteId === note.id ? wikilinkDataState : null;
  const wikilinkNotes = wikilinkData?.notes ?? EMPTY_NOTES;
  const wikilinkAreas = wikilinkData?.areas ?? areas;
  const wikilinkDataError = wikilinkData?.error ?? null;
  const wikilinkDataPending = wikilinkData === null;

  const backlinks =
    backlinksState?.noteId === note.id &&
    backlinksState.title === note.title.trim()
      ? backlinksState.notes
      : [];
  const backlinksError =
    backlinksErrorState?.noteId === note.id &&
    backlinksErrorState.title === note.title.trim()
      ? backlinksErrorState.message
      : null;
  const areaNames = new Map(areas.map((area) => [area.slug, area.name]));
  const noteTasks =
    linkedTasksForNote === note.id
      ? linkedTasks.filter((task) => task.noteId === note.id)
      : [];
  const connectionCount = noteTasks.length + backlinks.length + liveLinks.length;

  const wikilinkQuery = wikilinkPopup?.query;
  const wikilinkSuggestions = useMemo(() => {
    if (wikilinkQuery === undefined) return [];
    const query = wikilinkQuery.toLocaleLowerCase();
    return wikilinkNotes
      .filter((item) => item.title.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  }, [wikilinkNotes, wikilinkQuery]);
  const hasExactWikilinkMatch = Boolean(
    wikilinkPopup &&
      [note, ...wikilinkNotes].some(
        (item) =>
          item.title.trim().toLocaleLowerCase() ===
          wikilinkPopup.query.trim().toLocaleLowerCase()
      )
  );
  const canCreateWikilink = Boolean(
    wikilinkPopup &&
      wikilinkPopup.query.trim().length > 0 &&
      !wikilinkDataPending &&
      !wikilinkDataError &&
      !hasExactWikilinkMatch
  );
  const wikilinkOptionCount =
    wikilinkSuggestions.length + (canCreateWikilink ? 1 : 0);

  const closeWikilinkPopup = useCallback(() => {
    wikilinkPopupRef.current = null;
    setWikilinkPopup(null);
  }, []);

  const updateWikilinkPopup = useCallback((currentEditor: Editor) => {
    const { selection } = currentEditor.state;
    if (!selection.empty || !selection.$from.parent.isTextblock) {
      closeWikilinkPopup();
      return;
    }

    const { $from } = selection;
    const textBeforeCursor = $from.parent.textBetween(
      0,
      $from.parentOffset,
      "",
      "\uFFFC"
    );
    const match = /\[\[([^\[\]\n]*)$/.exec(textBeforeCursor);
    if (!match || typeof window === "undefined") {
      closeWikilinkPopup();
      return;
    }

    const from = $from.start() + match.index;
    const to = selection.from;
    const cursor = currentEditor.view.coordsAtPos(to);
    const next: WikilinkAutocompleteState = {
      query: match[1],
      from,
      to,
      left: Math.max(8, Math.min(cursor.left, window.innerWidth - 348)),
      top: cursor.bottom + 4,
      activeIndex:
        wikilinkPopupRef.current?.query === match[1]
          ? wikilinkPopupRef.current.activeIndex
          : 0,
    };

    wikilinkPopupRef.current = next;
    setWikilinkPopup(next);
  }, [closeWikilinkPopup]);

  const confirmWikilink = useCallback(
    (index: number) => {
      const currentEditor = editorRef.current;
      const popup = wikilinkPopupRef.current;
      if (!currentEditor || !popup) return;

      const selectedNote = wikilinkSuggestions[index];
      const title = selectedNote?.title.trim() ??
        (canCreateWikilink && index === wikilinkSuggestions.length
          ? popup.query.trim()
          : "");
      if (!title) return;

      setWikilinkOperationError(null);
      currentEditor
        .chain()
        .focus()
        .insertContentAt({ from: popup.from, to: popup.to }, `[[${title}]] `)
        .run();
      closeWikilinkPopup();

      if (!selectedNote) {
        void findOrCreateNoteByTitle(title, note.area)
          .then((createdNote) => {
            setWikilinkDataState((current) => {
              if (!current || current.noteId !== note.id || current.error) {
                return current;
              }
              return {
                ...current,
                notes: [
                  createdNote,
                  ...current.notes.filter((item) => item.id !== createdNote.id),
                ],
              };
            });
          })
          .catch((error: unknown) => {
            setWikilinkOperationError(
              error instanceof Error
                ? error.message
                : "No se pudo crear la nota enlazada."
            );
          });
      }
    },
    [
      canCreateWikilink,
      closeWikilinkPopup,
      note.area,
      note.id,
      wikilinkSuggestions,
    ]
  );

  const handleWikilinkKeyDown = useCallback((event: KeyboardEvent) => {
    const popup = wikilinkPopupRef.current;
    if (!popup) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      closeWikilinkPopup();
      return true;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (wikilinkOptionCount > 0) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (popup.activeIndex + direction + wikilinkOptionCount) %
          wikilinkOptionCount;
        const next = { ...popup, activeIndex: nextIndex };
        wikilinkPopupRef.current = next;
        setWikilinkPopup(next);
      }
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (wikilinkOptionCount > 0) {
        confirmWikilinkRef.current(
          Math.min(popup.activeIndex, wikilinkOptionCount - 1)
        );
      }
      return true;
    }

    return false;
  }, [closeWikilinkPopup, wikilinkOptionCount]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList.configure({
        HTMLAttributes: {
          class: "list-none pl-0 my-2 space-y-1.5",
        },
      }),
TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class:
            "flex flex-row items-start gap-2.5 [&>label]:flex [&>label]:items-center [&>label]:shrink-0 [&>label>input]:mt-[5px] [&>label>input]:size-4 [&>label>input]:accent-emerald-400 [&>div]:flex-1 [&>div>p]:m-0 data-[checked=true]:[&>div]:line-through data-[checked=true]:[&>div]:text-zinc-500",
        },
      }),
      Placeholder.configure({
        placeholder: "Escribí acá... Usá # + espacio para título, [] + espacio para tarea o [[Otra nota]]",
      }),
      DriveMediaImage.configure({
        inline: true,
        HTMLAttributes: {
          class: "max-h-[28rem] max-w-full rounded-lg object-contain",
        },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: note.content,
    editorProps: {
      handleKeyDown: (_view, event) =>
        handleWikilinkKeyDownRef.current(event),
      handleClick: (view, position, event) => {
        const title = findWikilinkAtPosition(view, position);
        if (!title) return false;
        event.preventDefault();
        openWikilinkRef.current(title);
        return true;
      },
      handleDOMEvents: {
        blur: () => {
          closeWikilinkPopup();
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/")
        );
        if (images.length === 0) return false;
        event.preventDefault();
        uploadFilesHandlerRef.current(images);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;

        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        if (position !== undefined) {
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(position))
            )
          );
        }
        event.preventDefault();
        uploadFilesHandlerRef.current(files);
        return true;
      },
      attributes: {
        class:
          "max-w-none min-h-[55dvh] focus:outline-none text-sm leading-7 text-zinc-200 [&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0 [&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:items-start [&_li[data-type='taskItem']]:gap-2.5 [&_input[type='checkbox']]:mt-1.5 [&_input[type='checkbox']]:size-4 [&_input[type='checkbox']]:accent-emerald-400 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-50 [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      updateWikilinkPopupRef.current(currentEditor);
      const storage = currentEditor.storage as unknown as {
        markdown?: { getMarkdown: () => string };
      };
      const markdown = normalizeWikilinkMarkdown(
        storage.markdown?.getMarkdown() ?? currentEditor.getText()
      );
      setLiveLinks(parseLinksLive(markdown));
      scheduleSave({ content: markdown });
    },
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged || pendingAiAttachmentsRef.current.length === 0) {
        return;
      }
      const mappedAttachments = pendingAiAttachmentsRef.current.map(
        (attachment) => ({
          ...attachment,
          position: transaction.mapping.map(attachment.position, 1),
        })
      );
      pendingAiAttachmentsRef.current = mappedAttachments;
      setPendingAiAttachments(mappedAttachments);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      updateWikilinkPopupRef.current(currentEditor);
      const { from, to, empty } = currentEditor.state.selection;
      setHasTextSelection(
        !empty &&
          currentEditor.state.doc.textBetween(from, to, " ").trim().length > 0
      );
    },
  });
  useEffect(() => {
    updateWikilinkPopupRef.current = updateWikilinkPopup;
    confirmWikilinkRef.current = confirmWikilink;
    handleWikilinkKeyDownRef.current = handleWikilinkKeyDown;
    editorRef.current = editor;
  }, [confirmWikilink, editor, handleWikilinkKeyDown, updateWikilinkPopup]);

  const uploadNoteFiles = useCallback(async (files: File[]) => {
    if (!editor || files.length === 0 || uploadingFilesRef.current) return;
    uploadingFilesRef.current = true;
    setUploadingAttachments(true);
    setUploadError(null);
    setDriveNeedsReconnect(false);

    try {
      for (const file of files) {
        validateDriveUploadSize(file);
        const response = await fetch("/api/google/drive", {
          method: "POST",
          headers: getDriveUploadHeaders(file),
          body: file,
        });
        const data = (await response.json()) as DriveUploadResponse;

        if (!response.ok || !data.file) {
          const requiresReauth =
            response.status === 401 || Boolean(data.requiresReauth);
          setDriveNeedsReconnect(requiresReauth);
          throw new Error(
            data.error ?? "No se pudo subir el archivo a Google Drive."
          );
        }

        const isVideo =
          data.file.isVideo ?? data.file.mimeType.startsWith("video/");
        const markdown = isVideo
          ? `![🎬 Video: ${escapeMarkdownLabel(file.name)}](${data.file.thumbnailUrl ?? data.file.webViewLink})`
          : data.file.mimeType.startsWith("image/")
            ? `![${escapeMarkdownLabel(file.name)}](${data.file.thumbnailUrl ?? data.file.webViewLink})`
            : `[📎 ${escapeMarkdownLabel(file.name)}](${data.file.webViewLink})`;
        const insertionPosition = editor.state.selection.from;
        editor
          .chain()
          .focus()
          .insertContentAt(insertionPosition, markdown)
          .run();
        const aiType = getAiAttachmentType(file);
        if (aiType) {
          const pending: PendingAiAttachment = {
            id: globalThis.crypto.randomUUID(),
            noteId: note.id,
            file,
            position: editor.state.selection.from,
            processing: false,
            error: null,
          };
          const next = [...pendingAiAttachmentsRef.current, pending];
          pendingAiAttachmentsRef.current = next;
          setPendingAiAttachments(next);
        }
      }
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error ? error.message : "No se pudo subir el archivo."
      );
    } finally {
      uploadingFilesRef.current = false;
      setUploadingAttachments(false);
    }
  }, [editor, note.id]);

  async function processAiAttachment(id: string) {
    const pending = pendingAiAttachmentsRef.current.find(
      (attachment) => attachment.id === id
    );
    if (!pending || pending.processing) return;
    const type = getAiAttachmentType(pending.file);
    if (!type) return;

    const processingState = pendingAiAttachmentsRef.current.map((attachment) =>
      attachment.id === id
        ? { ...attachment, processing: true, error: null }
        : attachment
    );
    pendingAiAttachmentsRef.current = processingState;
    setPendingAiAttachments(processingState);

    try {
      const form = new FormData();
      form.append("type", type);
      form.append("file", pending.file);
      const response = await fetch("/api/ai/process-attachment", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        error?: string;
        html?: string;
      };
      if (!response.ok || !result.html) {
        throw new Error(result.error ?? "No se pudo procesar el adjunto.");
      }

      const current = pendingAiAttachmentsRef.current.find(
        (attachment) => attachment.id === id
      );
      const currentEditor = editorRef.current;
      if (
        !current ||
        current.noteId !== latestNoteId.current ||
        !currentEditor ||
        currentEditor.isDestroyed
      ) {
        throw new Error("La nota cambió antes de insertar el resultado.");
      }
      const position = Math.min(
        Math.max(1, current.position),
        currentEditor.state.doc.content.size
      );
      currentEditor
        .chain()
        .focus()
        .insertContentAt(position, result.html)
        .run();
      const next = pendingAiAttachmentsRef.current.filter(
        (attachment) => attachment.id !== id
      );
      pendingAiAttachmentsRef.current = next;
      setPendingAiAttachments(next);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo procesar el adjunto.";
      const next = pendingAiAttachmentsRef.current.map((attachment) =>
        attachment.id === id
          ? { ...attachment, processing: false, error: message }
          : attachment
      );
      pendingAiAttachmentsRef.current = next;
      setPendingAiAttachments(next);
    }
  }

  useEffect(() => {
    uploadFilesHandlerRef.current = (files) => {
      void uploadNoteFiles(files);
    };
  }, [uploadNoteFiles]);

  useEffect(() => {
    if (!editor) return;
    editor.registerPlugin(wikilinkPlugin);
    return () => {
      editor.unregisterPlugin(wikilinkPluginKey);
    };
  }, [editor]);

  useEffect(() => {
    if (latestNoteId.current !== note.id) {
      pendingAiAttachmentsRef.current = [];
      setPendingAiAttachments([]);
    }
    latestNoteId.current = note.id;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (editor && !editor.isDestroyed) {
      const storage = editor.storage as unknown as {
        markdown?: { getMarkdown: () => string };
      };
      const currentMd = storage.markdown?.getMarkdown() ?? "";
      if (currentMd !== note.content) {
        editor.commands.setContent(note.content || "");
      }
    }
  }, [editor, note.id, note.content]);

  function scheduleSave(updates: { title?: string; content?: string }) {
    setStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const targetId = latestNoteId.current;
    saveTimerRef.current = setTimeout(async () => {
      try {
        await onSave(targetId, updates);
      } finally {
        if (latestNoteId.current === targetId) {
          setStatus("saved");
        }
      }
    }, 800);
  }

  useEffect(() => {
    if (taskComposerOpen) taskTitleInputRef.current?.focus();
  }, [taskComposerOpen]);

  function openTaskComposer() {
    setConnectionsOpen(true);
    setTaskComposerOpen(true);
    setTaskError(null);
  }

  async function handleCreateLinkedTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim() || creatingTask) return;

    setCreatingTask(true);
    setTaskError(null);
    try {
      const created = await createTask(
        note.area,
        taskTitle,
        taskDueDate || null,
        [],
        note.id
      );
      setLinkedTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
      setTaskTitle("");
      setTaskDueDate("");
      setTaskComposerOpen(false);
      onTasksChanged();
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error ? error.message : "No se pudo crear la tarea."
      );
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleToggleLinkedTask(task: Task) {
    if (savingLinkedTaskId) return;
    setSavingLinkedTaskId(task.id);
    setTaskError(null);
    try {
      const updated = await toggleTaskCompleted(task.id, !task.completed);
      setLinkedTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      onTasksChanged();
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la tarea."
      );
    } finally {
      setSavingLinkedTaskId(null);
    }
  }

  async function handleConvertSelectionToTask() {
    if (!editor) return;
    const selection = editor.state.selection;
    const selectedText = editor.state.doc
      .textBetween(selection.from, selection.to, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!selectedText) return;

    setTaskError(null);
    try {
      const created = await createTask(note.area, selectedText, null, [], note.id);
      setLinkedTasks((current) => [created, ...current.filter((task) => task.id !== created.id)]);
      if (
        !editor.isDestroyed &&
        editor.state.selection.from === selection.from &&
        editor.state.selection.to === selection.to &&
        editor.state.doc
          .textBetween(selection.from, selection.to, " ")
          .replace(/\s+/g, " ")
          .trim() === selectedText
      ) {
        if (!editor.isActive("taskItem") && editor.can().toggleTaskList()) {
          editor.chain().focus().toggleTaskList().run();
        }
      }
      onTasksChanged();
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error ? error.message : "No se pudo crear la tarea."
      );
    }
  }

  function getCurrentEditorContent(): string {
    const storage = editor?.storage as
      | { markdown?: { getMarkdown: () => string } }
      | undefined;
    return normalizeWikilinkMarkdown(
      storage?.markdown?.getMarkdown() ?? note.content
    );
  }

  async function handleSynchronizePeriodicNote() {
    if (!periodicKind || periodicSyncing) return;
    setPeriodicSyncing(true);
    setPeriodicError(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      const currentNote = { ...note, content: getCurrentEditorContent() };
      const content = await synchronizePeriodicNote(currentNote, areas);
      await onSave(note.id, { content });
      setStatus("saved");
    } catch (error: unknown) {
      setPeriodicError(
        error instanceof Error
          ? error.message
          : "No se pudo sincronizar la nota periódica."
      );
    } finally {
      setPeriodicSyncing(false);
    }
  }

  async function handleResetWeeklyNote() {
    if (periodicKind !== "weekly" || weeklyResetting) return;
    setWeeklyResetting(true);
    setPeriodicError(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      const currentNote = { ...note, content: getCurrentEditorContent() };
      const content = await resetWeeklyNote(currentNote, areas);
      await onSave(note.id, { content });
      setStatus("saved");
      setWeeklyResetOpen(false);
    } catch (error: unknown) {
      setPeriodicError(
        error instanceof Error
          ? error.message
          : "No se pudo resetear la hoja semanal."
      );
    } finally {
      setWeeklyResetting(false);
    }
  }

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle);
    scheduleSave({ title: newTitle.trim() || "Sin título" });
  }

  function handleDownloadMarkdown() {
    const storage = editor?.storage as
      | { markdown?: { getMarkdown: () => string } }
      | undefined;
    const content = normalizeWikilinkMarkdown(
      storage?.markdown?.getMarkdown() ?? note.content
    );

    downloadNoteAsMarkdown({
      ...note,
      title: title.trim() || "Sin título",
      content,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-2.5 md:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackMobile}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 md:hidden"
          >
            <ArrowLeft className="size-4" />
            Volver
          </button>

          <span className="text-xs text-zinc-500 capitalize">
            Área: <strong className="font-medium text-zinc-300">{areaName}</strong>
          </span>

          {/* Barra rápida de formato */}
          {editor ? (
            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
              <button
                type="button"
                title="Adjuntar archivo o imagen"
                aria-label="Adjuntar archivo o imagen"
                disabled={uploadingAttachments}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => attachmentInputRef.current?.click()}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50"
              >
                {uploadingAttachments ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Paperclip className="size-3.5" />
                )}
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                aria-label="Seleccionar archivos para adjuntar"
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  uploadFilesHandlerRef.current(files);
                }}
              />
              <button
                type="button"
                title="Título grande (# + espacio)"
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <Heading1 className="size-3.5" />
              </button>
              <button
                type="button"
                title="Subtítulo (## + espacio)"
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <Heading2 className="size-3.5" />
              </button>
              <button
                type="button"
                title="Lista con viñetas (- + espacio)"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <List className="size-3.5" />
              </button>
              <button
                type="button"
                title="Casilla de tarea ([] + espacio)"
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <CheckSquare className="size-3.5" />
              </button>
              <button
                type="button"
                title="Agregar tarea vinculada a esta nota"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openTaskComposer}
                className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <Plus className="size-3.5" />
                Tarea
              </button>
              {hasTextSelection ? (
                <button
                  type="button"
                  title="Convertir selección en tarea vinculada"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleConvertSelectionToTask()}
                  className="flex items-center gap-1 rounded-md border border-emerald-900/70 px-2 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/50"
                >
                  <CheckSquare className="size-3.5" />
                  Convertir en tarea
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          {periodicKind ? (
            <button
              type="button"
              onClick={() => void handleSynchronizePeriodicNote()}
              disabled={periodicSyncing || status === "saving"}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50"
            >
              <RefreshCw
                className={`size-3.5 ${periodicSyncing ? "animate-spin" : ""}`}
              />
              <span>{periodicSyncing ? "Sincronizando…" : "Sincronizar agenda"}</span>
            </button>
          ) : null}
          {periodicKind === "weekly" ? (
            <button
              type="button"
              onClick={() => setWeeklyResetOpen(true)}
              disabled={weeklyResetting || status === "saving"}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              <span>Resetear semana</span>
            </button>
          ) : null}
          {onRequestDelete ? (
            <button
              type="button"
              title="Eliminar nota"
              aria-label="Eliminar nota"
              disabled={status === "saving"}
              onClick={() => onRequestDelete(note)}
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-900 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            title="Descargar nota como Markdown"
            aria-label="Descargar nota como Markdown"
            onClick={handleDownloadMarkdown}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            <Download className="size-3.5" />
            <span>Markdown</span>
          </button>
          {status === "saving" ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-zinc-400" />
              <span>Guardando…</span>
            </>
          ) : (
            <>
              <Check className="size-3.5 text-emerald-400" />
              <span>Guardado</span>
            </>
          )}
        </div>
      </div>

      {uploadError ? (
        <p
          role="alert"
          className="border-b border-amber-900/70 bg-amber-950/30 px-5 py-2 text-xs text-amber-200 md:px-10"
        >
          {uploadError}{" "}
          {driveNeedsReconnect ? (
            <a
              href="/api/google/auth"
              className="font-medium underline underline-offset-2"
            >
              Reconectar Google Drive
            </a>
          ) : null}
        </p>
      ) : null}
      {wikilinkOperationError ? (
        <p
          role="alert"
          className="border-b border-amber-900/70 bg-amber-950/30 px-5 py-2 text-xs text-amber-200 md:px-10"
        >
          {wikilinkOperationError}
        </p>
      ) : null}
      {periodicError ? (
        <p
          role="alert"
          className="border-b border-amber-900/70 bg-amber-950/30 px-5 py-2 text-xs text-amber-200 md:px-10"
        >
          {periodicError}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-10">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Título de la nota…"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight text-zinc-100 placeholder-zinc-600 outline-none"
        />

        <div className="relative mt-6">
          <EditorContent editor={editor} />
          {wikilinkPopup ? (
            <div
              role="listbox"
              aria-label="Sugerencias de wikilinks"
              className="fixed z-[70] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl"
              style={{
                left: wikilinkPopup.left,
                top: wikilinkPopup.top,
                width: "min(21rem, calc(100vw - 1rem))",
                maxHeight: "min(20rem, calc(100vh - 1rem))",
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              {wikilinkDataError ? (
                <p role="alert" className="px-3 py-2 text-xs text-red-300">
                  {wikilinkDataError}
                </p>
              ) : wikilinkDataPending ? (
                <p className="px-3 py-2 text-xs text-zinc-500">
                  Cargando notas…
                </p>
              ) : (
                <>
                  {wikilinkSuggestions.map((suggestion, index) => {
                    const area = wikilinkAreas.find(
                      (item) => item.slug === suggestion.area
                    );
                    const isActive = wikilinkPopup.activeIndex === index;

                    return (
                      <button
                        key={suggestion.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => {
                          const next = { ...wikilinkPopup, activeIndex: index };
                          wikilinkPopupRef.current = next;
                          setWikilinkPopup(next);
                        }}
                        onClick={() => confirmWikilinkRef.current(index)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                          isActive
                            ? "bg-zinc-800 text-zinc-50"
                            : "text-zinc-300 hover:bg-zinc-900"
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          {suggestion.title || "Sin título"}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full"
                            style={{
                              backgroundColor: area?.color ?? "#71717a",
                            }}
                          />
                          {area?.name ?? suggestion.area}
                        </span>
                      </button>
                    );
                  })}
                  {canCreateWikilink ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={
                        wikilinkPopup.activeIndex === wikilinkSuggestions.length
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => {
                        const next = {
                          ...wikilinkPopup,
                          activeIndex: wikilinkSuggestions.length,
                        };
                        wikilinkPopupRef.current = next;
                        setWikilinkPopup(next);
                      }}
                      onClick={() =>
                        confirmWikilinkRef.current(wikilinkSuggestions.length)
                      }
                      className={`mt-1 w-full rounded-lg border-t border-zinc-800 px-3 py-2 text-left text-xs ${
                        wikilinkPopup.activeIndex === wikilinkSuggestions.length
                          ? "bg-zinc-800 text-emerald-300"
                          : "text-emerald-400 hover:bg-zinc-900"
                      }`}
                    >
                      + Crear y enlazar &quot;[[{wikilinkPopup.query.trim()}]]&quot;
                    </button>
                  ) : null}
                  {wikilinkSuggestions.length === 0 && !canCreateWikilink ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">
                      No hay notas que coincidan.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>

        {pendingAiAttachments.some(
          (attachment) => attachment.noteId === note.id
        ) ? (
          <div className="mt-4 space-y-2">
            {pendingAiAttachments
              .filter((attachment) => attachment.noteId === note.id)
              .map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2 truncate text-xs text-zinc-400">
                    <FileText className="size-3.5 shrink-0" />
                    {attachment.file.name}
                  </span>
                  <button
                    type="button"
                    disabled={attachment.processing}
                    onClick={() => void processAiAttachment(attachment.id)}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-900/70 px-2.5 py-1.5 text-[11px] text-emerald-300 transition hover:bg-emerald-950/50 disabled:opacity-50"
                  >
                    {attachment.processing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Sparkles className="size-3" />
                    )}
                    {attachment.processing
                      ? "Procesando…"
                      : "Transcribir / Resumir con IA"}
                  </button>
                  {attachment.error ? (
                    <p role="alert" className="w-full text-xs text-red-300">
                      {attachment.error}
                    </p>
                  ) : null}
                </div>
              ))}
          </div>
        ) : null}

        <section className="mt-10 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <button
            type="button"
            aria-expanded={connectionsOpen}
            onClick={() => setConnectionsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-900/70 md:px-5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Link2 className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate text-sm font-medium text-zinc-200">
                Conexiones y Tareas
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                {connectionCount}
              </span>
              <ChevronDown
                className={`size-4 text-zinc-500 transition ${
                  connectionsOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {connectionsOpen ? (
            <div className="space-y-5 border-t border-zinc-800 px-4 py-4 md:px-5">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-medium text-zinc-300">
                    Tareas vinculadas ({noteTasks.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setTaskComposerOpen((open) => !open);
                      setTaskError(null);
                    }}
                    className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <Plus className="size-3" />
                    Agregar tarea
                  </button>
                </div>

                {taskComposerOpen ? (
                  <form
                    onSubmit={(event) => void handleCreateLinkedTask(event)}
                    className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2"
                  >
                    <input
                      ref={taskTitleInputRef}
                      type="text"
                      aria-label="Título de la tarea vinculada"
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      placeholder="¿Qué hay que hacer?"
                      className="h-9 min-w-36 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                    />
                    <input
                      type="datetime-local"
                      aria-label="Fecha opcional de la tarea"
                      value={taskDueDate}
                      onChange={(event) => setTaskDueDate(event.target.value)}
                      className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-600 [color-scheme:dark]"
                    />
                    <button
                      type="submit"
                      disabled={!taskTitle.trim() || creatingTask}
                      className="h-9 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
                    >
                      {creatingTask ? "Creando…" : "Crear tarea"}
                    </button>
                  </form>
                ) : null}

                {linkedTasksLoading && linkedTasksForNote !== note.id ? (
                  <p className="py-2 text-xs text-zinc-500">
                    Cargando tareas…
                  </p>
                ) : noteTasks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {noteTasks.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          disabled={savingLinkedTaskId === task.id}
                          onClick={() => void handleToggleLinkedTask(task)}
                          className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 text-left transition hover:border-zinc-700 hover:bg-zinc-950 disabled:opacity-60"
                        >
                          {task.completed ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                          ) : (
                            <Circle className="size-4 shrink-0 text-zinc-500" />
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate text-xs ${
                              task.completed
                                ? "text-zinc-500 line-through"
                                : "text-zinc-200"
                            }`}
                          >
                            {task.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-xs text-zinc-500">
                    Todavía no hay tareas vinculadas a esta nota.
                  </p>
                )}
              </section>

              {taskError || linkedTasksError ? (
                <p role="alert" className="text-xs text-red-300">
                  {taskError ?? linkedTasksError}
                </p>
              ) : null}

              <section>
                <h3 className="mb-2 text-xs font-medium text-zinc-300">
                  Menciones inversas ({backlinks.length})
                </h3>
                {backlinksError ? (
                  <p role="alert" className="text-xs text-red-300">
                    {backlinksError}
                  </p>
                ) : backlinks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {backlinks.map((backlink) => {
                      const backlinkArea = areas.find(
                        (area) => area.slug === backlink.area
                      );
                      return (
                        <li key={backlink.id}>
                          <button
                            type="button"
                            onClick={() => onOpenWikilink(backlink.title)}
                            className="flex w-full flex-col items-start rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-left transition hover:border-zinc-700 hover:bg-zinc-950"
                          >
                            <span className="flex max-w-full items-center gap-2">
                              <FileText className="size-3.5 shrink-0 text-zinc-500" />
                              <span className="truncate text-xs text-zinc-200">
                                {backlink.title || "Sin título"}
                              </span>
                              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 rounded-full"
                                  style={{
                                    backgroundColor:
                                      backlinkArea?.color ?? "#71717a",
                                  }}
                                />
                                {areaNames.get(backlink.area) ?? backlink.area}
                              </span>
                            </span>
                            <span className="mt-1 pl-5 text-[11px] leading-4 text-zinc-500">
                              {getWikilinkSnippet(backlink.content, note.title)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : backlinksState?.noteId === note.id ? (
                  <p className="py-2 text-xs text-zinc-500">
                    Ninguna otra nota menciona este título.
                  </p>
                ) : (
                  <p className="py-2 text-xs text-zinc-500">
                    Cargando menciones…
                  </p>
                )}
              </section>

              {liveLinks.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-xs font-medium text-zinc-300">
                    Notas enlazadas ({liveLinks.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {liveLinks.map((linkTitle) => (
                      <button
                        key={linkTitle}
                        type="button"
                        onClick={() => onOpenWikilink(linkTitle)}
                        className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900"
                      >
                        [[{linkTitle}]]
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
      <ConfirmDeleteModal
        open={weeklyResetOpen}
        title="Resetear hoja semanal"
        description="Se actualizarán la agenda y las tareas. Las tareas marcadas como completadas se archivarán y se conservarán las notas fijas."
        confirmLabel="Resetear semana"
        loadingLabel="Actualizando…"
        loading={weeklyResetting}
        onConfirm={handleResetWeeklyNote}
        onClose={() => setWeeklyResetOpen(false)}
      />
    </div>
  );
}