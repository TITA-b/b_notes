"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Heading1,
  Heading2,
  Link2,
  List,
  Loader2,
} from "lucide-react";
import type { Note } from "@/types/note";

interface NoteEditorProps {
  note: Note;
  onSave: (id: string, updates: { title?: string; content?: string }) => Promise<Note>;
  onOpenWikilink: (title: string) => void;
  onBackMobile: () => void;
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

export function NoteEditor({
  note,
  onSave,
  onOpenWikilink,
  onBackMobile,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [liveLinks, setLiveLinks] = useState<string[]>(note.links ?? []);
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNoteId = useRef(note.id);

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
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: note.content,
    editorProps: {
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

  useEffect(() => {
    latestNoteId.current = note.id;
    setTitle(note.title);
    setLiveLinks(note.links ?? []);
    setStatus("saved");
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
  }, [note.id]);

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
            Área: <strong className="font-medium text-zinc-300">{note.area}</strong>
          </span>

          {/* Barra rápida de formato */}
          {editor ? (
            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
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