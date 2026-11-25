"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import { createNote } from "@/services/notesService";
import { createTask } from "@/services/tasksService";
import { getDriveUploadHeaders } from "@/lib/driveUpload";
import type { Area, AreaId, Note } from "@/types/note";
import type { Task } from "@/types/task";

interface QuickCaptureModalProps {
  areas: Area[];
  activeArea: AreaId;
  initialTitle?: string;
  initialContent?: string;
  initialAttachment?: File | null;
  onClose: () => void;
  onNoteCreated: (note: Note) => void;
  onTaskCreated: (task: Task) => void;
}

export function QuickCaptureModal({
  areas,
  activeArea,
  initialTitle = "",
  initialContent = "",
  initialAttachment = null,
  onClose,
  onNoteCreated,
  onTaskCreated,
}: QuickCaptureModalProps) {
  const [type, setType] = useState<"note" | "task">("note");
  const [area, setArea] = useState(activeArea);
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [attachment, setAttachment] = useState<File | null>(initialAttachment);
  const [processingAttachment, setProcessingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedArea = areas.some((item) => item.slug === area)
    ? area
    : areas.find((item) => item.slug === activeArea)?.slug ??
      areas[0]?.slug ??
      "";
  const attachmentType =
    attachment?.type.startsWith("audio/") ||
    (attachment &&
      /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(attachment.name))
      ? "audio"
      : attachment &&
          (attachment.type === "application/pdf" ||
            /\.pdf$/i.test(attachment.name))
        ? "pdf"
        : null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving && !processingAttachment) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, processingAttachment, saving]);

  async function processAttachment() {
    if (!attachment || !attachmentType || processingAttachment) return;
    setProcessingAttachment(true);
    setAttachmentError(null);
    try {
      const form = new FormData();
      form.append("type", attachmentType);
      form.append("file", attachment);
      form.append("area", selectedArea);
      const response = await fetch("/api/ai/process-attachment", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        error?: string;
        markdown?: string;
      };
      if (!response.ok || !result.markdown) {
        throw new Error(result.error ?? "No se pudo procesar el adjunto.");
      }
      setContent((current) =>
        [current.trim(), result.markdown?.trim()].filter(Boolean).join("\n\n")
      );
    } catch (processError) {
      setAttachmentError(
        processError instanceof Error
          ? processError.message
          : "No se pudo procesar el adjunto."
      );
    } finally {
      setProcessingAttachment(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !selectedArea) return;

    setSaving(true);
    setError(null);
    try {
      if (type === "note") {
        let attachmentLink = "";
        if (attachment) {
          const response = await fetch("/api/google/drive", {
            method: "POST",
            headers: getDriveUploadHeaders(attachment),
            body: attachment,
          });
          const result = (await response.json()) as {
            error?: string;
            file?: { webViewLink?: string; name?: string };
          };
          if (!response.ok || !result.file?.webViewLink) {
            throw new Error(
              result.error ?? "No se pudo subir el adjunto a Google Drive."
            );
          }
          attachmentLink = `[📎 ${result.file.name ?? attachment.name}](${result.file.webViewLink})`;
        }
        const noteContent = [attachmentLink, content.trim()]
          .filter(Boolean)
          .join("\n\n");
        onNoteCreated(await createNote(selectedArea, title.trim(), noteContent));
      } else {
        onTaskCreated(
          await createTask(
            selectedArea,
            title.trim(),
            dueDate ? `${dueDate}T12:00` : null
          )
        );
      }
      onClose();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "No se pudo guardar la captura."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 pb-5 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !saving &&
          !processingAttachment
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-title"
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3.5">
          <h2
            id="quick-capture-title"
            className="text-sm font-semibold text-zinc-100"
          >
            Captura rápida
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || processingAttachment}
            aria-label="Cerrar captura rápida"
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de captura">
            <button
              type="button"
              aria-pressed={type === "note"}
              onClick={() => setType("note")}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition ${
                type === "note"
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <NotebookPen className="size-3.5" />
              Nota rápida
            </button>
            <button
              type="button"
              aria-pressed={type === "task"}
              onClick={() => setType("task")}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition ${
                type === "task"
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <CalendarDays className="size-3.5" />
              Tarea / Entrega
            </button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Área destino</span>
            <select
              value={selectedArea}
              onChange={(event) => setArea(event.target.value)}
              required
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
            >
              {areas.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">Título</span>
            <input
              autoFocus
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={type === "note" ? "Idea para recordar…" : "¿Qué tenés que hacer?"}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
            />
          </label>

          {type === "note" ? (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs text-zinc-400">Contenido breve</span>
                <textarea
                  rows={4}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Anotá los detalles que no querés olvidar…"
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
                />
              </label>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-zinc-300 hover:text-zinc-100">
                    <Paperclip className="size-3.5 shrink-0 text-zinc-500" />
                    <span className="truncate">
                      {attachment ? attachment.name : "Adjuntar audio o PDF"}
                    </span>
                    <input
                      type="file"
                      accept="audio/*,.pdf,application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        setAttachment(event.currentTarget.files?.[0] ?? null);
                        setAttachmentError(null);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {attachment ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachment(null);
                        setAttachmentError(null);
                      }}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      aria-label="Quitar adjunto"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                {attachment ? (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800 pt-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-zinc-500">
                      <FileText className="size-3 shrink-0" />
                      {attachment.size > 1024 * 1024
                        ? `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${Math.max(1, Math.ceil(attachment.size / 1024))} KB`}
                    </span>
                    {attachmentType ? (
                      <button
                        type="button"
                        disabled={processingAttachment}
                        onClick={() => void processAttachment()}
                        className="flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-900/70 px-2 py-1.5 text-[11px] text-emerald-300 transition hover:bg-emerald-950/50 disabled:opacity-50"
                      >
                        {processingAttachment ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        {processingAttachment
                          ? "Procesando…"
                          : "Transcribir / Resumir con IA"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {attachmentError ? (
                  <p role="alert" className="mt-2 text-xs text-red-300">
                    {attachmentError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">Fecha (opcional)</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </label>
          )}

          {error ? (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={
              saving ||
              processingAttachment ||
              !title.trim() ||
              !selectedArea ||
              areas.length === 0
            }
            className="h-10 w-full rounded-lg bg-emerald-500 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar captura"}
          </button>
        </form>
      </section>
    </div>
  );
}
