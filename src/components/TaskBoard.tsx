"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  createTask,
  deleteTask,
  getTasksByArea,
  toggleTaskCompleted,
} from "@/services/tasksService";
import type { AreaId } from "@/types/note";
import type { Task } from "@/types/task";

interface TaskBoardProps {
  area: AreaId;
}

interface GCalEvent {
  id: string;
  summary: string;
  start: string;
  htmlLink: string;
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

function isOverdue(iso: string | null, completed: boolean) {
  if (!iso || completed) return false;
  return new Date(iso).getTime() < Date.now();
}

export function TaskBoard({ area }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadedArea, setLoadedArea] = useState<AreaId | null>(null);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Estado de Google Calendar
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(true);
  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);

  const loading = loadedArea !== area;
const loadCalendar = useCallback(async (withSpinner = true) => {
    if (withSpinner) setGcalLoading(true);
    try {
      const res = await fetch("/api/google/events");
      const data = await res.json();
      setGcalConnected(Boolean(data.connected));
      setGcalEvents(data.events ?? []);
    } finally {
      setGcalLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/google/events")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setGcalConnected(Boolean(data.connected));
        setGcalEvents(data.events ?? []);
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

    getTasksByArea(area)
      .then((data) => {
        if (!cancelled) setTasks(data);
      })
      .finally(() => {
        if (!cancelled) setLoadedArea(area);
      });

    return () => {
      cancelled = true;
    };
  }, [area]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;

    setSubmitting(true);
    try {
      const created = await createTask(area, title, dueDate || null);
      setTasks((prev) => [created, ...prev]);
      setTitle("");
      setDueDate("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(task: Task) {
    const nextState = !task.completed;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: nextState } : t))
    );
    await toggleTaskCompleted(task.id, nextState);
  }

  async function handleDelete(task: Task) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

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
  }

  async function handleSyncToGCal(task: Task) {
    if (syncingTaskId) return;
    setSyncingTaskId(task.id);
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
      if (res.ok) {
        const data = await res.json();
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, sync_to_gcal: true, gcal_event_id: data.eventId }
              : t
          )
        );
        await loadCalendar();
      }
    } finally {
      setSyncingTaskId(null);
    }
  }

  const pendingTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* Columna izquierda: Entregas y tareas del área */}
      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight capitalize">
            Entregas y tareas — {area}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {pendingTasks.length} pendiente{pendingTasks.length === 1 ? "" : "s"}
          </p>
        </div>

        <form
          onSubmit={handleAdd}
          className="mt-5 flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 sm:flex-row sm:items-center"
        >
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

            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 text-xs font-medium text-zinc-950 transition hover:bg-white disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              Agregar
            </button>
          </div>
        </form>

        <div className="mt-6 space-y-6">
          {loading ? (
            <p className="py-10 text-center text-xs text-zinc-500">
              Cargando entregas…
            </p>
          ) : tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-12 text-center text-xs text-zinc-500">
              No tenés entregas ni tareas cargadas en{" "}
              <span className="capitalize text-zinc-300">{area}</span>.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {pendingTasks.map((task) => {
                  const overdue = isOverdue(task.due_date, task.completed);
                  const formatted = formatDueDate(task.due_date);
                  return (
                    <li
                      key={task.id}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/40 px-4 py-3 transition hover:border-zinc-700"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggle(task)}
                        className="flex flex-1 items-center gap-3 text-left"
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

                      <div className="flex items-center gap-1">
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
                          aria-label="Eliminar tarea"
                          onClick={() => handleDelete(task)}
                          className="rounded p-1.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-red-300 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
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
                    {completedTasks.map((task) => (
                      <li
                        key={task.id}
                        className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-900/30"
                      >
                        <button
                          type="button"
                          onClick={() => handleToggle(task)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500/80" />
                          <span className="text-sm line-through">
                            {task.title}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label="Eliminar tarea"
                          onClick={() => handleDelete(task)}
                          className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Columna derecha: Agenda en vivo de Google Calendar */}
      <aside className="w-full border-t border-zinc-800 bg-zinc-900/20 px-5 py-6 lg:w-96 lg:overflow-y-auto lg:border-t-0 lg:border-l">
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

        <div className="mt-5">
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
          ) : gcalEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
              No tenés eventos próximos en tu calendario.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {gcalEvents.map((ev) => (
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}