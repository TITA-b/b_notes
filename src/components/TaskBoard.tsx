"use client";

/* eslint-disable @next/next/no-img-element -- media previews are served by the authenticated Drive proxy. */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  ArrowDownLeft,
  ExternalLink,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import {
  createTask,
  deleteTask,
  getTasksByArea,
  importCalendarEventAsTask,
  toggleTaskCompleted,
  updateTaskAttachments,
  updateTask,
} from "@/services/tasksService";
import {
  GENERAL_AREA_ID,
  type Area,
  type AreaId,
  type Note,
} from "@/types/note";
import type { Task, TaskAttachment } from "@/types/task";
import {
  getDriveImagePreviewUrl,
  getDriveVideoEmbedUrl,
  getDriveViewUrl,
} from "@/lib/driveMedia";
import {
  getDriveUploadHeaders,
  validateDriveUploadSize,
} from "@/lib/driveUpload";
import {
  MediaLightboxModal,
  type LightboxMedia,
} from "@/components/MediaLightboxModal";

interface TaskBoardProps {
  area: AreaId;
  areaName: string;
  areas: Area[];
  notes: Note[];
  onSelectNote: (note: Note) => void;
  refreshKey: number;
  calendarRefreshKey: number;
  closeLightboxSignal: number;
  onLightboxChange: (open: boolean) => void;
}

interface GCalEvent {
  id: string;
  summary: string;
  start: string;
  htmlLink: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGCalEvent(value: unknown): value is GCalEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.summary === "string" &&
    typeof value.start === "string" &&
    typeof value.htmlLink === "string"
  );
}

function parseCalendarResponse(value: unknown): {
  connected: boolean;
  events: GCalEvent[];
} {
  if (!isRecord(value) || typeof value.connected !== "boolean") {
    throw new Error("La respuesta de Google Calendar no tiene el formato esperado.");
  }
  const events = value.events;
  if (!Array.isArray(events) || !events.every(isGCalEvent)) {
    throw new Error("La lista de eventos de Google Calendar no tiene el formato esperado.");
  }
  return { connected: value.connected, events };
}

interface DriveApiResponse {
  error?: string;
  requiresReauth?: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
  };
}

function getAttachmentMedia(attachment: TaskAttachment): LightboxMedia | null {
  if (attachment.mimeType.startsWith("image/")) {
    return {
      type: "image",
      src: attachment.url,
      title: attachment.name,
      driveUrl: getDriveViewUrl(attachment.url),
    };
  }
  if (attachment.mimeType.startsWith("video/")) {
    return {
      type: "video",
      src: getDriveVideoEmbedUrl(attachment.id),
      title: attachment.name,
      driveUrl: getDriveViewUrl(attachment.url),
    };
  }
  return null;
}

function AttachmentChips({
  attachments,
  onRemove,
  onPreview,
  disabled,
}: {
  attachments: TaskAttachment[];
  onRemove: (attachment: TaskAttachment) => void;
  onPreview: (attachment: TaskAttachment) => void;
  disabled: boolean;
}) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const media = getAttachmentMedia(attachment);
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-300"
          >
            {media ? (
              <button
                type="button"
                aria-label={`Ver ${attachment.name}`}
                onClick={() => onPreview(attachment)}
                className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-800"
              >
                {media.type === "image" ? (
                  <img
                    src={getDriveImagePreviewUrl(attachment.id)}
                    alt=""
                    loading="lazy"
                    className="size-10 rounded-md object-cover"
                  />
                ) : (
                  <span className="flex size-10 items-center justify-center bg-zinc-800 text-zinc-200">
                    <Play className="size-4 fill-current" />
                  </span>
                )}
              </button>
            ) : (
              <Paperclip className="ml-1 size-3 shrink-0 text-zinc-500" />
            )}
            {media ? (
              <button
                type="button"
                onClick={() => onPreview(attachment)}
                title={attachment.name}
                className="max-w-48 truncate text-left hover:text-white"
              >
                {attachment.name}
              </button>
            ) : (
              <a
                href={getDriveViewUrl(attachment.url)}
                target="_blank"
                rel="noreferrer"
                title={attachment.name}
                className="max-w-48 truncate hover:text-white"
              >
                {attachment.name}
              </a>
            )}
            <a
              href={getDriveViewUrl(attachment.url)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir ${attachment.name} en Google Drive`}
              title="Abrir en Drive"
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              <ExternalLink className="size-3" />
            </a>
            <button
              type="button"
              aria-label={`Quitar ${attachment.name}`}
              title="Quitar archivo"
              disabled={disabled}
              onClick={() => onRemove(attachment)}
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300 disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function formatDueDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateTimeLocal(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function isOverdue(
  iso: string | null,
  completed: boolean,
  currentTime: number | null
) {
  if (!iso || completed || currentTime === null) return false;
  return new Date(iso).getTime() < currentTime;
}

function NoteSourceBadge({
  task,
  notesById,
  onSelectNote,
}: {
  task: Task;
  notesById: ReadonlyMap<string, Note>;
  onSelectNote: (note: Note) => void;
}) {
  const note = task.noteId ? notesById.get(task.noteId) : undefined;
  if (!note) return null;

  return (
    <button
      type="button"
      title={`Abrir nota: ${note.title}`}
      onClick={() => onSelectNote(note)}
      className="flex max-w-full items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
    >
      <FileText className="size-3 shrink-0" />
      <span className="truncate">{note.title || "Sin título"}</span>
    </button>
  );
}

export function TaskBoard({
  area,
  areaName,
  areas,
  notes,
  onSelectNote,
  refreshKey,
  calendarRefreshKey,
  closeLightboxSignal,
  onLightboxChange,
}: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadedArea, setLoadedArea] = useState<AreaId | null>(null);
  const [title, setTitle] = useState("");
  const [selectedTaskArea, setSelectedTaskArea] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArea, setEditArea] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [importingEventId, setImportingEventId] = useState<string | null>(null);
  const [linkedEventIds, setLinkedEventIds] = useState<Set<string>>(
    () => new Set()
  );
  const [draftAttachments, setDraftAttachments] = useState<TaskAttachment[]>([]);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveNeedsReconnect, setDriveNeedsReconnect] = useState(false);
  const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
  const [taskDeleteLoading, setTaskDeleteLoading] = useState(false);
  const [taskDeleteError, setTaskDeleteError] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<LightboxMedia | null>(null);
  const previousCloseSignal = useRef(closeLightboxSignal);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const isGeneral = area === GENERAL_AREA_ID;
  const taskAreaForNewTask = areas.some(
    (candidate) => candidate.slug === selectedTaskArea
  )
    ? selectedTaskArea
    : areas[0]?.slug ?? "";
  const areaBySlug = new Map(areas.map((candidate) => [candidate.slug, candidate]));
  const notesById = new Map(notes.map((note) => [note.id, note]));

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    const initialUpdate = window.setTimeout(updateCurrentTime, 0);
    const interval = window.setInterval(updateCurrentTime, 60_000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, []);

  function handlePreviewAttachment(attachment: TaskAttachment) {
    const media = getAttachmentMedia(attachment);
    if (media) {
      setActiveMedia(media);
      onLightboxChange(true);
    }
  }

  function closeLightbox() {
    setActiveMedia(null);
    onLightboxChange(false);
  }

  useEffect(() => {
    if (previousCloseSignal.current === closeLightboxSignal) return;
    previousCloseSignal.current = closeLightboxSignal;
    setActiveMedia(null);
  }, [closeLightboxSignal]);

  // Estado de Google Calendar
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(true);
  const [gcalError, setGcalError] = useState<string | null>(null);
  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);

  const loading = loadedArea !== area;
  const loadCalendar = useCallback(async (withSpinner = true) => {
    if (withSpinner) setGcalLoading(true);
    try {
      const res = await fetch("/api/google/events");
      if (!res.ok) {
        throw new Error("No se pudieron cargar los eventos de Google Calendar.");
      }
      const data: unknown = await res.json();
      const calendar = parseCalendarResponse(data);
      setGcalConnected(calendar.connected);
      setGcalEvents(calendar.events);
      setGcalError(null);
    } catch (error: unknown) {
      console.error("Could not load Google Calendar events.", error);
      setGcalConnected(false);
      setGcalEvents([]);
      setGcalError("No se pudieron cargar los eventos de Google Calendar.");
    } finally {
      setGcalLoading(false);
    }
  }, []);

  const previousCalendarRefreshKey = useRef(calendarRefreshKey);
  useEffect(() => {
    if (previousCalendarRefreshKey.current === calendarRefreshKey) return;
    previousCalendarRefreshKey.current = calendarRefreshKey;
    void loadCalendar(false);
  }, [calendarRefreshKey, loadCalendar]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/google/events")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("No se pudieron cargar los eventos de Google Calendar.");
        }
        return parseCalendarResponse(await res.json());
      })
      .then((calendar) => {
        if (cancelled) return;
        setGcalConnected(calendar.connected);
        setGcalEvents(calendar.events);
        setGcalError(null);
      })
      .catch((error: unknown) => {
        console.error("Could not load Google Calendar events.", error);
        if (cancelled) return;
        setGcalConnected(false);
        setGcalEvents([]);
        setGcalError("No se pudieron cargar los eventos de Google Calendar.");
      })
      .finally(() => {
        if (!cancelled) setGcalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      if (area !== GENERAL_AREA_ID) return getTasksByArea(area);
      const allTasks: Task[] = [];
      for (const candidate of areas) {
        allTasks.push(...(await getTasksByArea(candidate.slug)));
      }
      return allTasks;
    }

    loadTasks()
      .then((data) => {
        if (!cancelled) {
          if (!Array.isArray(data)) {
            setTasks([]);
            setTaskError("La respuesta de tareas no tiene el formato esperado.");
            return;
          }
          setTasks(data);
          setTaskError(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTasks([]);
        setTaskError(
          error instanceof Error ? error.message : "No se pudieron cargar las tareas."
        );
      })
      .finally(() => {
        if (!cancelled) setLoadedArea(area);
      });

    return () => {
      cancelled = true;
    };
  }, [area, areas, refreshKey]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (
      !title.trim() ||
      submitting ||
      uploadingTarget === "draft" ||
      (isGeneral && !taskAreaForNewTask)
    ) {
      return;
    }

    setSubmitting(true);
    setTaskError(null);
    try {
      const created = await createTask(
        isGeneral ? taskAreaForNewTask : area,
        title,
        dueDate || null,
        draftAttachments
      );
      setTasks((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
      setTitle("");
      setDueDate("");
      setDraftAttachments([]);
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error ? error.message : "No se pudo crear la tarea."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function startTaskEdit(task: Task) {
    setTaskError(null);
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditArea(task.area);
    setEditDueDate(toDateTimeLocal(task.due_date));
  }

  async function handleSaveTaskEdit(event: FormEvent, task: Task) {
    event.preventDefault();
    if (!editTitle.trim() || savingTaskId) return;

    setSavingTaskId(task.id);
    setTaskError(null);
    try {
      const updatedTask = await updateTask(task.id, {
        title: editTitle.trim(),
        due_date: editDueDate || null,
        ...(isGeneral ? { area: editArea } : {}),
      });
      setTasks((current) =>
        Array.isArray(current)
          ? current.map((item) => (item.id === task.id ? updatedTask : item))
          : []
      );
      setEditingTaskId(null);

      if (task.sync_to_gcal && task.gcal_event_id) {
        try {
          const response = await fetch("/api/google/events", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId: task.gcal_event_id,
              title: updatedTask.title,
              dueDate: updatedTask.due_date,
              area: updatedTask.area,
            }),
          });
          const data: unknown = await response.json();
          if (!response.ok) {
            const message =
              isRecord(data) && typeof data.error === "string"
                ? data.error
                : "No se pudo actualizar Google Calendar.";
            throw new Error(message);
          }
          await loadCalendar(false);
        } catch (error: unknown) {
          console.error("Task saved but Google Calendar sync failed.", error);
          setTaskError(
            error instanceof Error
              ? `La tarea se guardó, pero no se pudo sincronizar con Google Calendar: ${error.message}`
              : "La tarea se guardó, pero no se pudo sincronizar con Google Calendar."
          );
        }
      }
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la tarea."
      );
    } finally {
      setSavingTaskId(null);
    }
  }

  async function handleImportCalendarEvent(event: GCalEvent) {
    if (!event.id || importingEventId) return;

    setImportingEventId(event.id);
    setTaskError(null);
    try {
      const importedTask = await importCalendarEventAsTask(
        isGeneral ? taskAreaForNewTask : area,
        {
          id: event.id,
          summary: event.summary,
          start: event.start,
        }
      );
      if (isGeneral || importedTask.area === area) {
        setTasks((current) =>
          Array.isArray(current)
            ? current.some((item) => item.id === importedTask.id)
              ? current
              : [importedTask, ...current]
            : [importedTask]
        );
      } else {
        setLinkedEventIds((current) => new Set(current).add(event.id));
      }
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error
          ? error.message
          : "No se pudo importar el evento a tareas."
      );
    } finally {
      setImportingEventId(null);
    }
  }

  async function uploadFileToDrive(file: File): Promise<TaskAttachment> {
    validateDriveUploadSize(file);
    const response = await fetch("/api/google/drive", {
      method: "POST",
      headers: getDriveUploadHeaders(file),
      body: file,
    });
    const data = (await response.json()) as DriveApiResponse;
    if (!response.ok || !data.file) {
      const requiresReauth =
        response.status === 401 || Boolean(data.requiresReauth);
      setDriveNeedsReconnect(requiresReauth);
      throw new Error(data.error ?? "No se pudo subir el archivo a Google Drive.");
    }

    return {
      id: data.file.id,
      name: data.file.name,
      mimeType: data.file.mimeType,
      url: data.file.webViewLink,
    };
  }

  async function deleteDriveFile(fileId: string) {
    const response = await fetch(
      `/api/google/drive?fileId=${encodeURIComponent(fileId)}`,
      { method: "DELETE" }
    );
    const data = (await response.json()) as DriveApiResponse;
    if (!response.ok) {
      const requiresReauth =
        response.status === 401 || Boolean(data.requiresReauth);
      setDriveNeedsReconnect(requiresReauth);
      throw new Error(data.error ?? "No se pudo eliminar el archivo de Drive.");
    }
  }

  async function handleDraftUpload(files: File[]) {
    if (files.length === 0 || uploadingTarget) return;
    setUploadingTarget("draft");
    setDriveError(null);
    setDriveNeedsReconnect(false);
    try {
      for (const file of files) {
        const attachment = await uploadFileToDrive(file);
        setDraftAttachments((current) => [...current, attachment]);
      }
    } catch (error: unknown) {
      setDriveError(
        error instanceof Error ? error.message : "No se pudieron subir los archivos."
      );
    } finally {
      setUploadingTarget(null);
    }
  }

  async function handleTaskUpload(task: Task, files: File[]) {
    if (files.length === 0 || uploadingTarget) return;
    setUploadingTarget(task.id);
    setDriveError(null);
    setDriveNeedsReconnect(false);
    let attachments = [...(task.attachments ?? [])];

    try {
      for (const file of files) {
        const attachment = await uploadFileToDrive(file);
        const updatedAttachments = [...attachments, attachment];
        try {
          await updateTaskAttachments(task.id, updatedAttachments);
        } catch (error: unknown) {
          await deleteDriveFile(attachment.id);
          throw error;
        }
        attachments = updatedAttachments;
        setTasks((current) =>
          Array.isArray(current)
            ? current.map((item) =>
                item.id === task.id ? { ...item, attachments } : item
              )
            : []
        );
      }
    } catch (error: unknown) {
      setDriveError(
        error instanceof Error ? error.message : "No se pudieron subir los archivos."
      );
    } finally {
      setUploadingTarget(null);
    }
  }

  async function handleRemoveDraftAttachment(attachment: TaskAttachment) {
    setDeletingAttachmentId(attachment.id);
    setDriveError(null);
    setDriveNeedsReconnect(false);
    try {
      await deleteDriveFile(attachment.id);
      setDraftAttachments((current) =>
        current.filter((item) => item.id !== attachment.id)
      );
    } catch (error: unknown) {
      setDriveError(
        error instanceof Error ? error.message : "No se pudo quitar el archivo."
      );
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function handleRemoveTaskAttachment(
    task: Task,
    attachment: TaskAttachment
  ) {
    setDeletingAttachmentId(attachment.id);
    setDriveError(null);
    setDriveNeedsReconnect(false);
    try {
      await deleteDriveFile(attachment.id);
      const attachments = (task.attachments ?? []).filter(
        (item) => item.id !== attachment.id
      );
      await updateTaskAttachments(task.id, attachments);
      setTasks((current) =>
        Array.isArray(current)
          ? current.map((item) =>
              item.id === task.id ? { ...item, attachments } : item
            )
          : []
      );
    } catch (error: unknown) {
      setDriveError(
        error instanceof Error ? error.message : "No se pudo quitar el archivo."
      );
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function handleToggle(task: Task) {
    const nextState = !task.completed;
    setTasks((prev) =>
      Array.isArray(prev)
        ? prev.map((t) =>
            t.id === task.id ? { ...t, completed: nextState } : t
          )
        : []
    );
    await toggleTaskCompleted(task.id, nextState);
  }

  async function handleDelete(task: Task) {
    if (task.attachments?.length) {
      try {
        await Promise.all(
          task.attachments.map((attachment) => deleteDriveFile(attachment.id))
        );
      } catch (error: unknown) {
        setDriveError(
          error instanceof Error
            ? error.message
            : "No se pudieron eliminar los adjuntos de Drive."
        );
        throw error;
      }
    }

    if (task.gcal_event_id) {
      const res = await fetch(
        `/api/google/events?eventId=${encodeURIComponent(task.gcal_event_id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errData = await res.json();
        console.error("No se pudo borrar de Google Calendar:", errData);
      }
      await loadCalendar();
    }

    await deleteTask(task.id);
    setTasks((prev) =>
      Array.isArray(prev) ? prev.filter((item) => item.id !== task.id) : []
    );
  }

  async function confirmTaskDelete() {
    const task = taskPendingDelete;
    if (!task) return;

    setTaskDeleteLoading(true);
    setTaskDeleteError(null);
    setTaskError(null);
    try {
      await handleDelete(task);
      setTaskPendingDelete(null);
    } catch (error: unknown) {
      setTaskDeleteError(
        error instanceof Error ? error.message : "No se pudo eliminar la tarea."
      );
    } finally {
      setTaskDeleteLoading(false);
    }
  }

  function requestTaskDelete(task: Task) {
    setTaskDeleteError(null);
    setTaskError(null);
    setTaskPendingDelete(task);
  }

  async function handleSyncToGCal(task: Task) {
    if (syncingTaskId) return;
    setSyncingTaskId(task.id);
    setTaskError(null);
    try {
      const res = await fetch("/api/google/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          title: task.title,
          dueDate: task.due_date,
          area: task.area,
        }),
      });
      const data: unknown = await res.json();
      const eventId =
        isRecord(data) && typeof data.eventId === "string"
          ? data.eventId
          : null;
      if (!res.ok || eventId === null) {
        const message =
          isRecord(data) && typeof data.error === "string"
            ? data.error
            : "No se pudo sincronizar la tarea con Google Calendar.";
        throw new Error(message);
      }
      setTasks((prev) =>
        Array.isArray(prev)
          ? prev.map((t) =>
              t.id === task.id
                ? { ...t, sync_to_gcal: true, gcal_event_id: eventId }
                : t
            )
          : []
      );
      await loadCalendar();
    } catch (error: unknown) {
      setTaskError(
        error instanceof Error
          ? error.message
          : "No se pudo sincronizar la tarea con Google Calendar."
      );
    } finally {
      setSyncingTaskId(null);
    }
  }

  const taskList = Array.isArray(tasks) ? tasks : [];
  const calendarEvents = Array.isArray(gcalEvents) ? gcalEvents : [];
  const pendingTasks = taskList.filter((t) => !t.completed);
  const completedTasks = taskList.filter((t) => t.completed);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-1">
        {/* Columna izquierda: Entregas y tareas del área */}
        <div className="flex min-h-0 flex-col overflow-hidden px-5 py-6 md:px-8">
          <div className="shrink-0">
          <h2 className="text-xl font-semibold tracking-tight capitalize">
            Entregas y tareas — {areaName}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {pendingTasks.length} pendiente{pendingTasks.length === 1 ? "" : "s"}
          </p>
          </div>

        {driveError ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
          >
            <p>{driveError}</p>
            {driveNeedsReconnect ? (
              <a
                href="/api/google/auth"
                className="mt-1 inline-block font-medium text-amber-100 underline underline-offset-2"
              >
                Reconectar Google Drive
              </a>
            ) : null}
          </div>
        ) : null}
        {taskError ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-200"
          >
            {taskError}
          </div>
        ) : null}

        <form
          onSubmit={handleAdd}
          className="mt-5 flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {isGeneral ? (
              <select
                aria-label="Área de la nueva tarea"
                value={taskAreaForNewTask}
                onChange={(event) => setSelectedTaskArea(event.target.value)}
                required
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
              >
                {areas.map((candidate) => (
                  <option key={candidate.id} value={candidate.slug}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nueva entrega, parcial o pendiente…"
              className="h-9 flex-1 bg-transparent px-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-600 [color-scheme:dark]"
              />

              <label
                title="Adjuntar archivos a la nueva tarea"
                className={`flex h-9 cursor-pointer items-center justify-center rounded-lg border border-zinc-800 px-2.5 text-zinc-300 transition hover:border-zinc-600 hover:text-white ${
                  uploadingTarget === "draft" ? "opacity-50" : ""
                }`}
              >
                <Paperclip className="size-4" />
                <input
                  type="file"
                  multiple
                  aria-label="Adjuntar archivos a la nueva tarea"
                  disabled={uploadingTarget !== null}
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void handleDraftUpload(files);
                  }}
                />
              </label>

              <button
                type="submit"
                disabled={
                  !title.trim() ||
                  submitting ||
                  uploadingTarget === "draft" ||
                  (isGeneral && !taskAreaForNewTask)
                }
                className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 text-xs font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
              >
                <Plus className="size-3.5" />
                Agregar
              </button>
            </div>
          </div>
          {uploadingTarget === "draft" ? (
            <p className="px-2 text-[11px] text-zinc-500">Subiendo adjunto…</p>
          ) : null}
        </form>

        <div className="mt-2">
          <AttachmentChips
            attachments={draftAttachments}
            onRemove={handleRemoveDraftAttachment}
            onPreview={handlePreviewAttachment}
            disabled={uploadingTarget !== null || deletingAttachmentId !== null}
          />
        </div>

        <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto">
          {loading ? (
            <p className="py-10 text-center text-xs text-zinc-500">
              Cargando entregas…
            </p>
          ) : taskList.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-12 text-center text-xs text-zinc-500">
              No tenés entregas ni tareas cargadas en{" "}
              <span className="text-zinc-300">{areaName}</span>.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {pendingTasks.map((task) => {
                  const overdue = isOverdue(
                    task.due_date,
                    task.completed,
                    currentTime
                  );
                  const formatted = formatDueDate(task.due_date);
                  const taskArea = areaBySlug.get(task.area);
                  return (
                    <li
                      key={task.id}
                      className="group rounded-xl border border-zinc-800/90 border-l-4 bg-zinc-900/40 px-4 py-3 transition hover:border-zinc-700"
                      style={{
                        borderColor: taskArea?.color,
                        borderLeftColor: taskArea?.color,
                      }}
                    >
                      {isGeneral ? (
                        <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-zinc-950/70 px-2 py-1 text-[10px] text-zinc-300">
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: taskArea?.color }}
                          />
                          {taskArea?.name ?? task.area}
                        </span>
                      ) : null}
                      {editingTaskId === task.id ? (
                        <form
                          onSubmit={(event) =>
                            void handleSaveTaskEdit(event, task)
                          }
                          className="space-y-2"
                        >
                          <input
                            type="text"
                            aria-label="Título de la tarea"
                            value={editTitle}
                            onChange={(event) =>
                              setEditTitle(event.target.value)
                            }
                            className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            {isGeneral ? (
                              <select
                                aria-label="Área de la tarea"
                                value={editArea}
                                onChange={(event) => setEditArea(event.target.value)}
                                required
                                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                              >
                                {areas.map((candidate) => (
                                  <option key={candidate.id} value={candidate.slug}>
                                    {candidate.name}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <input
                              type="datetime-local"
                              aria-label="Fecha y hora de la tarea"
                              value={editDueDate}
                              onChange={(event) =>
                                setEditDueDate(event.target.value)
                              }
                              className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-600 [color-scheme:dark]"
                            />
                            <button
                              type="submit"
                              disabled={!editTitle.trim() || savingTaskId === task.id}
                              className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
                            >
                              <Check className="size-3.5" />
                              {savingTaskId === task.id
                                ? "Guardando…"
                                : "Guardar"}
                            </button>
                            <button
                              type="button"
                              disabled={savingTaskId === task.id}
                              onClick={() => setEditingTaskId(null)}
                              className="h-9 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggle(task)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <Circle className="size-4 shrink-0 text-zinc-500 transition hover:text-emerald-400" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-zinc-100">{task.title}</p>
                              {formatted ? (
                                <p
                                  className={`mt-1 flex items-center gap-1 text-xs ${
                                    overdue ? "text-red-400" : "text-zinc-500"
                                  }`}
                                >
                                  <Calendar className="size-3" />
                                  {formatted} {overdue ? "(Vencida)" : ""}
                                </p>
                              ) : null}
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            {gcalConnected ? (
                              task.sync_to_gcal ? (
                                <span
                                  title="Sincronizada en Google Calendar"
                                  className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400"
                                >
                                  <Check className="size-3" />
                                  En Calendar
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={syncingTaskId === task.id}
                                  onClick={() => handleSyncToGCal(task)}
                                  title="Enviar a Google Calendar"
                                  className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:opacity-50"
                                >
                                  <CalendarPlus className="size-3" />
                                  {syncingTaskId === task.id
                                    ? "Subiendo…"
                                    : "Agendar"}
                                </button>
                              )
                            ) : null}

                            <button
                              type="button"
                              aria-label={`Editar ${task.title}`}
                              title="Editar tarea"
                              onClick={() => startTaskEdit(task)}
                              className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                            >
                              <Pencil className="size-3.5" />
                            </button>

                            <label
                              title={
                                uploadingTarget === task.id
                                  ? "Subiendo adjunto…"
                                  : "Adjuntar archivos a esta tarea"
                              }
                              className={`cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 ${
                                uploadingTarget === task.id ? "animate-pulse" : ""
                              }`}
                            >
                              <Paperclip className="size-3.5" />
                              <input
                                type="file"
                                multiple
                                aria-label={`Adjuntar archivos a ${task.title}`}
                                disabled={uploadingTarget !== null}
                                className="sr-only"
                                onChange={(event) => {
                                  const files = Array.from(
                                    event.currentTarget.files ?? []
                                  );
                                  event.currentTarget.value = "";
                                  void handleTaskUpload(task, files);
                                }}
                              />
                            </label>

                            <button
                              type="button"
                              aria-label="Eliminar tarea"
                              onClick={() => requestTaskDelete(task)}
                              className="rounded p-1.5 text-zinc-600 opacity-100 transition hover:bg-zinc-800 hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="mt-2 space-y-2 pl-7">
                        <NoteSourceBadge
                          task={task}
                          notesById={notesById}
                          onSelectNote={onSelectNote}
                        />
                        <AttachmentChips
                          attachments={
                            Array.isArray(task.attachments) ? task.attachments : []
                          }
                          onRemove={(attachment) =>
                            void handleRemoveTaskAttachment(task, attachment)
                          }
                          onPreview={handlePreviewAttachment}
                          disabled={
                            uploadingTarget !== null ||
                            deletingAttachmentId !== null
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>

              {completedTasks.length > 0 ? (
                <div className="pt-2">
                  <p className="mb-2 text-xs font-medium text-zinc-500">
                    Completadas ({completedTasks.length})
                  </p>
                  <ul className="space-y-1.5">
                    {completedTasks.map((task) => {
                      const taskArea = areaBySlug.get(task.area);
                      return (
                      <li
                        key={task.id}
                        className="group rounded-lg border border-zinc-800/90 border-l-4 px-3 py-2 text-zinc-500 hover:bg-zinc-900/30"
                        style={{
                          borderColor: taskArea?.color,
                          borderLeftColor: taskArea?.color,
                        }}
                      >
                        {isGeneral ? (
                          <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-zinc-950/70 px-2 py-1 text-[10px] text-zinc-400">
                            <span
                              aria-hidden="true"
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: taskArea?.color }}
                            />
                            {taskArea?.name ?? task.area}
                          </span>
                        ) : null}
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggle(task)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500/80" />
                            <span className="truncate text-sm line-through">
                              {task.title}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Eliminar tarea"
                            onClick={() => requestTaskDelete(task)}
                            className="rounded p-1 text-zinc-600 opacity-100 transition hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 space-y-2 pl-7">
                          <NoteSourceBadge
                            task={task}
                            notesById={notesById}
                            onSelectNote={onSelectNote}
                          />
                          <AttachmentChips
                            attachments={
                              Array.isArray(task.attachments) ? task.attachments : []
                            }
                            onRemove={(attachment) =>
                              void handleRemoveTaskAttachment(task, attachment)
                            }
                            onPreview={handlePreviewAttachment}
                            disabled={
                              uploadingTarget !== null ||
                              deletingAttachmentId !== null
                            }
                          />
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Columna derecha: Agenda en vivo de Google Calendar */}
        <aside className="min-h-0 w-full overflow-y-auto border-t border-zinc-800 bg-zinc-900/20 px-5 py-6 lg:w-96 lg:border-t-0 lg:border-l">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Google Calendar
            </h3>
            <p className="text-[11px] text-zinc-500">Próximos eventos</p>
          </div>
          {gcalConnected ? (
            <button
              type="button"
              onClick={() => loadCalendar()}
              title="Actualizar eventos"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <RefreshCw
                className={`size-3.5 ${gcalLoading ? "animate-spin" : ""}`}
              />
            </button>
          ) : null}
        </div>

        <div className="mt-5 max-h-72 overflow-y-auto lg:max-h-none lg:overflow-visible">
          {gcalLoading ? (
            <p className="py-8 text-center text-xs text-zinc-500">
              Verificando conexión…
            </p>
          ) : !gcalConnected ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-5 text-center">
              <Calendar className="mx-auto size-7 text-zinc-600" />
              <p className="mt-3 text-xs leading-5 text-zinc-400">
                Conectá tu cuenta de Google para ver tus cursadas y reuniones acá
                y sincronizar entregas con un clic.
              </p>
              <a
                href="/api/google/auth"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-950 transition hover:bg-white"
              >
                Conectar Google Calendar
              </a>
            </div>
          ) : gcalError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-900/70 bg-red-950/30 p-4 text-center text-xs text-red-200"
            >
              {gcalError}
            </p>
          ) : calendarEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
              No tenés eventos próximos en tu calendario.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {calendarEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-zinc-200">
                      {ev.summary}
                    </p>
                    {ev.htmlLink ? (
                      <a
                        href={ev.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-zinc-500 hover:text-zinc-300"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {formatDueDate(ev.start) ?? ev.start}
                  </p>
                  {taskList.some((task) => task.gcal_event_id === ev.id) ||
                  linkedEventIds.has(ev.id) ? (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-400">
                      <Check className="size-3" />
                      Vinculado
                    </span>
                  ) : ev.id ? (
                    <button
                      type="button"
                      disabled={importingEventId !== null}
                      onClick={() => void handleImportCalendarEvent(ev)}
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
                    >
                      <ArrowDownLeft className="size-3" />
                      {importingEventId === ev.id
                        ? "Importando…"
                        : "Importar a tareas"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        </aside>
      </div>
      <MediaLightboxModal
        media={activeMedia}
        onClose={closeLightbox}
      />
      <ConfirmDeleteModal
        open={taskPendingDelete !== null}
        title={`¿Eliminar «${taskPendingDelete?.title || "Sin título"}»?`}
        description={
          taskDeleteError
            ? `${taskDeleteError} Esta acción no se puede deshacer.`
            : taskPendingDelete?.gcal_event_id
              ? "También se eliminará el evento vinculado en Google Calendar y sus adjuntos. Esta acción no se puede deshacer."
              : "No hay un evento vinculado en Google Calendar. Se eliminará la tarea y sus adjuntos; esta acción no se puede deshacer."
        }
        loading={taskDeleteLoading}
        onConfirm={confirmTaskDelete}
        onClose={() => {
          if (taskDeleteLoading) return;
          setTaskPendingDelete(null);
          setTaskDeleteError(null);
        }}
      />
    </div>
  );
}