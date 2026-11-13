"use client";

/* eslint-disable @next/next/no-img-element -- Google Drive thumbnails load directly from their public URL. */

import { useCallback, useEffect, useRef, useState } from "react";
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
  type NodeViewProps,
} from "@tiptap/react";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ExternalLink,
  Heading1,
  Heading2,
  Link2,
  List,
  Loader2,
  Maximize2,
  Paperclip,
  Play,
} from "lucide-react";
import { getAllNotes } from "@/services/notesService";
import {
  getDriveImagePreviewUrl,
  getDriveViewUrl,
} from "@/lib/driveMedia";
import {
  MediaLightboxModal,
  type LightboxMedia,
} from "@/components/MediaLightboxModal";
import type { Area, Note } from "@/types/note";

interface NoteEditorProps {
  note: Note;
  areaName: string;
  areas: Area[];
  onSave: (id: string, updates: { title?: string; content?: string }) => Promise<Note>;
  onOpenWikilink: (title: string) => void;
  onBackMobile: () => void;
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

function unescapeMarkdownBrackets(text: string): string {
  return text.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
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
  onBackMobile,
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNoteId = useRef(note.id);
  const openWikilinkRef = useRef(onOpenWikilink);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFilesHandlerRef = useRef<(files: File[]) => void>(() => {});
  const uploadingFilesRef = useRef(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveNeedsReconnect, setDriveNeedsReconnect] = useState(false);

  useEffect(() => {
    openWikilinkRef.current = onOpenWikilink;
  }, [onOpenWikilink]);

  useEffect(() => {
    let cancelled = false;
    const trimmedTitle = note.title.trim();

    if (!trimmedTitle) return;

    const wikilink = `[[${trimmedTitle}]]`.toLocaleLowerCase();
    getAllNotes()
      .then((allNotes) => {
        if (cancelled) return;
        setBacklinksState({
          noteId: note.id,
          title: trimmedTitle,
          notes: allNotes.filter(
            (item) =>
              item.id !== note.id &&
              unescapeMarkdownBrackets(item.content)
                .toLocaleLowerCase()
                .includes(wikilink)
          ),
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
      handleClick: (view, position, event) => {
        const title = findWikilinkAtPosition(view, position);
        if (!title) return false;
        event.preventDefault();
        openWikilinkRef.current(title);
        return true;
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
      const storage = currentEditor.storage as unknown as {
        markdown?: { getMarkdown: () => string };
      };
      const markdown = storage.markdown?.getMarkdown() ?? currentEditor.getText();
      setLiveLinks(parseLinksLive(markdown));
      scheduleSave({ content: markdown });
    },
  });

  const uploadNoteFiles = useCallback(async (files: File[]) => {
    if (!editor || files.length === 0 || uploadingFilesRef.current) return;
    uploadingFilesRef.current = true;
    setUploadingAttachments(true);
    setUploadError(null);
    setDriveNeedsReconnect(false);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/google/drive", {
          method: "POST",
          body: formData,
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
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.selection.from, markdown)
          .run();
      }
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error ? error.message : "No se pudo subir el archivo."
      );
    } finally {
      uploadingFilesRef.current = false;
      setUploadingAttachments(false);
    }
  }, [editor]);

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

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle);
    scheduleSave({ title: newTitle.trim() || "Sin título" });
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
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
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

      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-10">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Título de la nota…"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight text-zinc-100 placeholder-zinc-600 outline-none"
        />

        <div className="mt-6">
          <EditorContent editor={editor} />
        </div>
      </div>

      {backlinks.length > 0 ? (
        <div className="border-t border-zinc-800/80 bg-zinc-900/40 px-5 py-3 md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-zinc-400">
              Mencionada en ({backlinks.length})
            </span>
            {backlinks.map((backlink) => (
              <button
                key={backlink.id}
                type="button"
                onClick={() => onOpenWikilink(backlink.title)}
                className="flex max-w-80 flex-col items-start rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-left text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
              >
                <span className="flex items-center gap-2">
                  <span>{backlink.title || "Sin título"}</span>
                  <span className="capitalize text-zinc-500">
                    {areaNames.get(backlink.area) ?? backlink.area}
                  </span>
                </span>
                <span className="mt-1 text-[11px] leading-4 text-zinc-500">
                  {getWikilinkSnippet(backlink.content, note.title)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {backlinksError ? (
        <p role="alert" className="border-t border-zinc-800/80 px-5 py-2 text-xs text-red-300 md:px-10">
          {backlinksError}
        </p>
      ) : null}

      {liveLinks.length > 0 ? (
        <div className="border-t border-zinc-800/80 bg-zinc-900/40 px-5 py-3 md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              <Link2 className="size-3.5" />
              Conexiones:
            </span>
            {liveLinks.map((linkTitle) => (
              <button
                key={linkTitle}
                type="button"
                onClick={() => onOpenWikilink(linkTitle)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
              >
                [[{linkTitle}]]
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}