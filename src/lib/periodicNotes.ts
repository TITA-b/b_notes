import { createNote, getAllNotes, updateNote } from "@/services/notesService";
import { getTasksByArea } from "@/services/tasksService";
import type { Area, AreaId, Note } from "@/types/note";
import type { Task } from "@/types/task";

export type PeriodicNoteKind = "daily" | "weekly";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  htmlLink?: string;
}

interface CalendarResponse {
  connected: boolean;
  events: CalendarEvent[];
}

interface PeriodicSnapshot {
  days: Date[];
  events: CalendarEvent[];
  calendarNotice: string | null;
  tasks: Task[];
  taskNotice: string | null;
}

type ContentMode = "html" | "markdown";

interface HeadingRange {
  title: string;
  level: number;
  start: number;
  end: number;
}

const WEEKLY_KEY = "weekly:current";
const DAILY_TITLE_PREFIX = "Daily · ";
const WEEKLY_TITLE = "Semana Actual · Planificación";

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function dailyKey(date: Date): string {
  return `daily:${localDateKey(date)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("es") + value.slice(1);
}

function isValidCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<CalendarEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.summary === "string" &&
    typeof event.start === "string"
  );
}

async function loadCalendar(
  start: Date,
  end: Date
): Promise<Pick<PeriodicSnapshot, "events" | "calendarNotice">> {
  try {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
    });
    const response = await fetch(`/api/google/events?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Calendar request failed");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      throw new Error("Calendar returned an invalid response");
    }
    const result = data as Partial<CalendarResponse>;
    if (
      typeof result.connected !== "boolean" ||
      !Array.isArray(result.events) ||
      !result.events.every(isValidCalendarEvent)
    ) {
      throw new Error("Calendar returned an invalid response");
    }
    if (!result.connected) {
      return {
        events: [],
        calendarNotice: "Google Calendar no está conectado.",
      };
    }
    return { events: result.events, calendarNotice: null };
  } catch {
    return {
      events: [],
      calendarNotice: "No se pudo actualizar Google Calendar.",
    };
  }
}

async function loadTasks(
  areas: Area[]
): Promise<Pick<PeriodicSnapshot, "tasks" | "taskNotice">> {
  try {
    const taskGroups = await Promise.all(
      areas.map((area) => getTasksByArea(area.slug))
    );
    const uniqueTasks = new Map<string, Task>();
    for (const task of taskGroups.flat()) {
      if (!task.completed) uniqueTasks.set(task.id, task);
    }
    return { tasks: Array.from(uniqueTasks.values()), taskNotice: null };
  } catch {
    return {
      tasks: [],
      taskNotice: "No se pudieron cargar las tareas pendientes.",
    };
  }
}

async function loadSnapshot(
  kind: PeriodicNoteKind,
  areas: Area[]
): Promise<PeriodicSnapshot> {
  const today = localMidnight(new Date());
  const weekStart =
    kind === "weekly"
      ? addDays(today, -((today.getDay() + 6) % 7))
      : today;
  const days = Array.from({ length: kind === "daily" ? 1 : 7 }, (_, index) =>
    addDays(weekStart, index)
  );
  const [calendar, tasks] = await Promise.all([
    loadCalendar(weekStart, addDays(weekStart, days.length)),
    loadTasks(areas),
  ]);
  return { days, ...calendar, ...tasks };
}

function eventDateKey(event: CalendarEvent): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.start)) return event.start;
  const date = new Date(event.start);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function eventLabel(event: CalendarEvent): string {
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start);
  const time = isAllDay
    ? "Todo el día"
    : new Date(event.start).toLocaleTimeString("es", {
        hour: "2-digit",
        minute: "2-digit",
      });
  return `${isAllDay ? "📅" : "🕒"} ${time} · ${event.summary}`;
}

function taskDateKey(task: Task): string | null {
  if (!task.due_date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) return task.due_date;
  const date = new Date(task.due_date);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|>-])/g, "\\$1");
}

function makeHeading(level: number, title: string, mode: ContentMode): string {
  if (mode === "html") return `<h${level}>${escapeHtml(title)}</h${level}>`;
  return `${"#".repeat(level)} ${title}`;
}

function makeNotice(text: string, mode: ContentMode): string {
  if (mode === "html") return `<p><em>${escapeHtml(text)}</em></p>`;
  return `_${escapeMarkdown(text)}_`;
}

function makeList(items: string[], mode: ContentMode): string {
  if (mode === "html") {
    if (items.length === 0) return "";
    return `<ul>${items
      .map((item) => `<li><p>${escapeHtml(item)}</p></li>`)
      .join("")}</ul>`;
  }
  return items.map((item) => `- ${escapeMarkdown(item)}`).join("\n");
}

function makeTaskList(tasks: Task[], mode: ContentMode): string {
  if (tasks.length === 0) return "";
  if (mode === "html") {
    return `<ul data-type="taskList">${tasks
      .map(
        (task) =>
          `<li data-type="taskItem" data-checked="false"><label><input type="checkbox" /><span></span></label><div><p>${escapeHtml(task.title)}</p></div></li>`
      )
      .join("")}</ul>`;
  }
  return tasks.map((task) => `- [ ] ${escapeMarkdown(task.title)}`).join("\n");
}

function dailyContent(
  snapshot: PeriodicSnapshot,
  mode: ContentMode,
  journal = ""
): string {
  const todayKey = localDateKey(snapshot.days[0]);
  const events = snapshot.events
    .filter((event) => eventDateKey(event) === todayKey)
    .sort((a, b) => a.start.localeCompare(b.start));
  const tasks = snapshot.tasks
    .filter((task) => {
      const due = taskDateKey(task);
      return due !== null && due <= todayKey;
    })
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  const agendaBody = snapshot.calendarNotice
    ? makeNotice(snapshot.calendarNotice, mode)
    : events.length
      ? makeList(events.map(eventLabel), mode)
      : makeNotice("No hay eventos programados para hoy.", mode);
  const taskBody = snapshot.taskNotice
    ? makeNotice(snapshot.taskNotice, mode)
    : tasks.length
      ? makeTaskList(tasks, mode)
      : makeNotice("No hay tareas atrasadas ni con vencimiento hoy.", mode);
  return [
    makeHeading(2, "Agenda de hoy", mode),
    agendaBody,
    makeHeading(2, "Tareas pendientes / para hoy", mode),
    taskBody,
    makeHeading(2, "Bitácora / Notas rápidas del día", mode),
    journal || (mode === "html" ? "<p></p>" : ""),
  ]
    .filter(Boolean)
    .join("\n");
}

function weeklyContent(
  snapshot: PeriodicSnapshot,
  mode: ContentMode,
  preserved: {
    focus?: string;
    fixedNotes?: string;
    archive?: string;
    dayNotes?: Map<string, string>;
  } = {}
): string {
  const lastDay = localDateKey(snapshot.days[snapshot.days.length - 1]);
  const weeklyTasks = snapshot.tasks
    .filter((task) => {
      const due = taskDateKey(task);
      return due === null || due <= lastDay;
    })
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  const agendaParts: string[] = [];
  for (const day of snapshot.days) {
    const key = localDateKey(day);
    const events = snapshot.events
      .filter((event) => eventDateKey(event) === key)
      .sort((a, b) => a.start.localeCompare(b.start));
    const dayLabel = capitalize(
      day.toLocaleDateString("es", { weekday: "long", day: "2-digit", month: "2-digit" })
    );
    agendaParts.push(
      makeHeading(3, dayLabel, mode),
      makeHeading(4, "Agenda", mode),
      snapshot.calendarNotice
        ? makeNotice(snapshot.calendarNotice, mode)
        : events.length
          ? makeList(events.map(eventLabel), mode)
          : makeNotice("Sin eventos programados.", mode),
      makeHeading(4, `Notas del día: ${key}`, mode),
      preserved.dayNotes?.get(key) ?? (mode === "html" ? "<p></p>" : "")
    );
  }

  const taskBody = snapshot.taskNotice
    ? makeNotice(snapshot.taskNotice, mode)
    : weeklyTasks.length
      ? makeTaskList(weeklyTasks, mode)
      : makeNotice("No hay tareas abiertas para esta semana.", mode);

  return [
    makeHeading(2, "Foco de la semana", mode),
    preserved.focus ?? (mode === "html" ? "<p></p>" : ""),
    makeHeading(2, "Agenda y plan diario", mode),
    agendaParts.join("\n"),
    makeHeading(2, "Pendientes generales", mode),
    taskBody,
    makeHeading(2, "Notas fijas", mode),
    preserved.fixedNotes ?? (mode === "html" ? "<p></p>" : ""),
    ...(preserved.archive
      ? [makeHeading(2, "Archivo de completados", mode), preserved.archive]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function readHeadings(content: string): HeadingRange[] {
  const htmlHeadings = Array.from(
    content.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)
  );
  if (htmlHeadings.length) {
    return htmlHeadings.map((match) => ({
      title: (match[2] ?? "").replace(/<[^>]*>/g, "").trim(),
      level: Number(match[1]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));
  }
  return Array.from(content.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)).map(
    (match) => ({
      title: match[2].trim(),
      level: match[1].length,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  );
}

function findSection(
  content: string,
  title: string
): { heading: HeadingRange; bodyStart: number; end: number } | null {
  const headings = readHeadings(content);
  const heading = headings.find(
    (item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
  );
  if (!heading) return null;
  const nextHeading = headings.find(
    (item) => item.start > heading.start && item.level <= heading.level
  );
  return {
    heading,
    bodyStart: heading.end,
    end: nextHeading?.start ?? content.length,
  };
}

function extractSection(content: string, title: string): string | undefined {
  const section = findSection(content, title);
  if (!section) return undefined;
  return content.slice(section.bodyStart, section.end).trim();
}

function contentMode(content: string): ContentMode {
  return /<h[1-6]\b/i.test(content) ? "html" : "markdown";
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function completedTaskTitles(content: string): string[] {
  const completed = new Set<string>();
  const markdownTasks = content.matchAll(/^\s*[-*+]\s+\[x\]\s+(.+)$/gim);
  for (const match of markdownTasks) {
    const title = match[1].trim();
    if (title) completed.add(title);
  }
  const htmlItems = content.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi);
  for (const match of htmlItems) {
    if (
      !/data-checked=["']true["']/i.test(match[1]) &&
      !/<input\b[^>]*\bchecked\b/i.test(match[2])
    ) {
      continue;
    }
    const title = decodeHtml(match[2].replace(/<[^>]*>/g, "")).trim();
    if (title) completed.add(title);
  }
  return Array.from(completed);
}

function areaForNewNote(activeArea: AreaId, areas: Area[]): Area {
  const selected = areas.find((area) => area.slug === activeArea);
  const area = selected ?? areas[0];
  if (!area) throw new Error("Crea un área antes de generar una nota periódica.");
  return area;
}

function dailyTitle(date: Date): string {
  return `${DAILY_TITLE_PREFIX}${localDateKey(date)}`;
}

export async function createOrOpenPeriodicNote(
  kind: PeriodicNoteKind,
  activeArea: AreaId,
  areas: Area[]
): Promise<Note> {
  const today = localMidnight(new Date());
  const key = kind === "daily" ? dailyKey(today) : WEEKLY_KEY;
  const title = kind === "daily" ? dailyTitle(today) : WEEKLY_TITLE;
  const notes = await getAllNotes();
  const existing =
    notes.find((note) => note.periodic_key === key) ??
    notes.find((note) => note.title === title);
  if (existing) {
    if (existing.periodic_key === key) return existing;
    return updateNote(existing.id, { periodic_key: key });
  }

  const area = areaForNewNote(activeArea, areas);
  const snapshot = await loadSnapshot(kind, areas);
  const mode: ContentMode = "html";
  const content =
    kind === "daily"
      ? dailyContent(snapshot, mode)
      : weeklyContent(snapshot, mode);
  return createNote(area.slug, title, content, key);
}

export async function synchronizePeriodicNote(
  note: Note,
  areas: Area[]
): Promise<string> {
  const kind: PeriodicNoteKind =
    note.periodic_key?.startsWith("daily:") ? "daily" : "weekly";
  const snapshot = await loadSnapshot(kind, areas);
  const mode = contentMode(note.content);
  let content: string;

  if (kind === "daily") {
    const journal =
      extractSection(note.content, "Bitácora / Notas rápidas del día") ??
      (mode === "html" ? "<p></p>" : "");
    content = dailyContent(snapshot, mode, journal);
  } else {
    const dayNotes = new Map<string, string>();
    for (const day of snapshot.days) {
      const key = localDateKey(day);
      const saved = extractSection(note.content, `Notas del día: ${key}`);
      if (saved !== undefined) dayNotes.set(key, saved);
    }
    content = weeklyContent(snapshot, mode, {
      focus:
        extractSection(note.content, "Foco de la semana") ??
        (mode === "html" ? "<p></p>" : ""),
      fixedNotes:
        extractSection(note.content, "Notas fijas") ??
        (mode === "html" ? "<p></p>" : ""),
      archive: extractSection(note.content, "Archivo de completados"),
      dayNotes,
    });
  }

  return content;
}

export async function resetWeeklyNote(
  note: Note,
  areas: Area[]
): Promise<string> {
  const snapshot = await loadSnapshot("weekly", areas);
  const mode = contentMode(note.content);
  const completed = completedTaskTitles(note.content);
  const previousArchive = extractSection(note.content, "Archivo de completados");
  const newArchive = makeList(completed, mode);
  const archive = [previousArchive, newArchive].filter(Boolean).join("\n");
  return weeklyContent(snapshot, mode, {
    fixedNotes:
      extractSection(note.content, "Notas fijas") ??
      (mode === "html" ? "<p></p>" : ""),
    archive: archive || undefined,
  });
}
