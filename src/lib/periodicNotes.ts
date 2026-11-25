import { createNote, getAllNotes, updateNote } from "@/services/notesService";
import { getTasksByArea } from "@/services/tasksService";
import { getTemplates } from "@/services/templatesService";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import type { Area, AreaId, Note, NoteTemplate } from "@/types/note";
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

function eventMarkdown(event: CalendarEvent): string {
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start);
  const time = isAllDay
    ? "Todo el día"
    : new Date(event.start).toLocaleTimeString("es", {
        hour: "2-digit",
        minute: "2-digit",
      });
  return `- ${isAllDay ? "📅" : "🕒"} **${time}** · ${escapeMarkdown(event.summary)}`;
}

function taskDateKey(task: Task): string | null {
  if (!task.due_date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) return task.due_date;
  const date = new Date(task.due_date);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|>-])/g, "\\$1");
}

function makeHeading(level: number, title: string): string {
  return `${"#".repeat(level)} ${title}`;
}

function makeNotice(text: string): string {
  return `_${escapeMarkdown(text)}_`;
}

function makeList(items: string[]): string {
  return items.map((item) => `- ${escapeMarkdown(item)}`).join("\n");
}

function makeTaskList(tasks: Task[]): string {
  return tasks.map((task) => `- [ ] ${escapeMarkdown(task.title)}`).join("\n");
}

interface TemplateSection {
  title: string;
  placeholder: string;
  body: string | undefined;
  required?: boolean;
}

function replaceSectionBody(
  content: string,
  title: string,
  body: string
): string {
  const section = findSection(content, title);
  if (!section) {
    return `${content.trim()}\n\n${makeHeading(2, title)}\n\n${body}`.trim();
  }
  return `${content.slice(0, section.bodyStart)}\n\n${body}\n\n${content.slice(
    section.end
  )}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTemplate(
  templateContent: string,
  date: string,
  sections: TemplateSection[]
): string {
  let content = normalizeMarkdown(templateContent).replace(/\{\{fecha\}\}/gi, date);
  for (const section of sections) {
    const placeholder = `{{${section.placeholder}}}`;
    if (content.includes(placeholder)) {
      content = content.replaceAll(placeholder, section.body ?? "");
    } else if (section.body !== undefined || section.required) {
      content = replaceSectionBody(content, section.title, section.body ?? "");
    }
  }
  return normalizeMarkdown(content);
}

function dailyContent(
  snapshot: PeriodicSnapshot,
  templateContent: string,
  journal?: string
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
    ? makeNotice(snapshot.calendarNotice)
    : events.length
      ? events.map(eventMarkdown).join("\n")
      : makeNotice("No hay eventos programados para hoy.");
  const taskBody = snapshot.taskNotice
    ? makeNotice(snapshot.taskNotice)
    : tasks.length
      ? makeTaskList(tasks)
      : makeNotice("No hay tareas atrasadas ni con vencimiento hoy.");
  return renderTemplate(templateContent, todayKey, [
    {
      title: "Agenda de hoy",
      placeholder: "agenda",
      body: agendaBody,
      required: true,
    },
    {
      title: "Tareas pendientes / para hoy",
      placeholder: "tareas",
      body: taskBody,
      required: true,
    },
    {
      title: "Bitácora / Notas rápidas del día",
      placeholder: "bitacora",
      body: journal,
    },
  ]);
}

function weeklyContent(
  snapshot: PeriodicSnapshot,
  templateContent: string,
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
      makeHeading(3, dayLabel),
      makeHeading(4, "Agenda"),
      snapshot.calendarNotice
        ? makeNotice(snapshot.calendarNotice)
        : events.length
          ? events.map(eventMarkdown).join("\n")
          : makeNotice("Sin eventos programados."),
      makeHeading(4, `Notas del día: ${key}`),
      preserved.dayNotes?.get(key) ?? ""
    );
  }

  const taskBody = snapshot.taskNotice
    ? makeNotice(snapshot.taskNotice)
    : weeklyTasks.length
      ? makeTaskList(weeklyTasks)
      : makeNotice("No hay tareas abiertas para esta semana.");

  return renderTemplate(templateContent, localDateKey(snapshot.days[0]), [
    {
      title: "Foco de la semana",
      placeholder: "foco",
      body: preserved.focus,
    },
    {
      title: "Agenda y plan diario",
      placeholder: "agenda_semanal",
      body: agendaParts.join("\n\n"),
      required: true,
    },
    {
      title: "Pendientes generales",
      placeholder: "tareas",
      body: taskBody,
      required: true,
    },
    {
      title: "Notas fijas",
      placeholder: "notas_fijas",
      body: preserved.fixedNotes,
    },
    {
      title: "Archivo de completados",
      placeholder: "archivo",
      body: preserved.archive,
    },
  ]);
}

function readHeadings(content: string): HeadingRange[] {
  return Array.from(content.matchAll(/^[ \t]*(#{1,6})\s+(.+?)\s*$/gm)).map(
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const codePoint = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/&amp;/g, "&");
}

function htmlInlineToMarkdown(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        "[$2]($1)"
      )
      .replace(/<[^>]*>/g, "")
  );
}

function normalizeMarkdown(content: string): string {
  return content
    .replace(
      /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi,
      (_list: string, attributes: string, body: string) => {
        const isTaskList = /data-type=["']taskList["']/i.test(attributes);
        const items = Array.from(
          body.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)
        );
        return items
          .map((item) => {
            const itemAttributes = item[1] ?? "";
            const rawItemBody = item[2] ?? "";
            const itemBody = rawItemBody.replace(
              /<label\b[^>]*>[\s\S]*?<\/label>/gi,
              ""
            );
            const isTask =
              isTaskList || /data-type=["']taskItem["']/i.test(itemAttributes);
            const checked =
              /data-checked=["']true["']/i.test(itemAttributes) ||
              /<input\b[^>]*\bchecked\b/i.test(rawItemBody);
            const title = htmlInlineToMarkdown(itemBody).trim();
            return `- ${isTask ? `[${checked ? "x" : " "}] ` : ""}${title}`;
          })
          .join("\n");
      }
    )
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_heading, level: string, text: string) =>
        `${"#".repeat(Number(level))} ${htmlInlineToMarkdown(text).trim()}`
    )
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_paragraph, text: string) =>
      htmlInlineToMarkdown(text).trim()
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:div|section|article)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function completedTaskTitles(content: string): string[] {
  const completed = new Set<string>();
  const markdownTasks = normalizeMarkdown(content).matchAll(
    /^\s*[-*+]\s+\[x\]\s+(.+)$/gim
  );
  for (const match of markdownTasks) {
    const title = match[1].trim();
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

async function getPeriodicTemplate(kind: PeriodicNoteKind): Promise<NoteTemplate> {
  const expectedName =
    kind === "daily" ? "Nota diaria" : "Planificación semanal";
  const templates = await getTemplates();
  const template = templates.find(
    (item) => item.name.trim().toLocaleLowerCase("es") === expectedName.toLocaleLowerCase("es")
  );
  if (template) return template;

  const fallback = NOTE_TEMPLATES.find(
    (item) => item.name.toLocaleLowerCase("es") === expectedName.toLocaleLowerCase("es")
  );
  if (!fallback) {
    throw new Error(`No se encontró la plantilla predeterminada "${expectedName}".`);
  }
  return fallback;
}

function carryForwardCustomSections(
  templateContent: string,
  existingContent: string,
  generatedTitles: string[]
): string {
  let content = normalizeMarkdown(templateContent);
  const existing = normalizeMarkdown(existingContent);
  const generated = new Set(generatedTitles.map((title) => title.toLocaleLowerCase("es")));

  for (const heading of readHeadings(existing).filter((item) => item.level === 2)) {
    const title = heading.title.toLocaleLowerCase("es");
    if (generated.has(title) || findSection(content, heading.title)) continue;
    const section = findSection(existing, heading.title);
    if (!section) continue;
    const savedSection = existing.slice(heading.start, section.end).trim();
    if (savedSection) content = `${content.trim()}\n\n${savedSection}`;
  }
  return content;
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
  const [template, snapshot] = await Promise.all([
    getPeriodicTemplate(kind),
    loadSnapshot(kind, areas),
  ]);
  const content =
    kind === "daily"
      ? dailyContent(snapshot, template.content)
      : weeklyContent(snapshot, template.content);
  return createNote(area.slug, title, content, key);
}

export async function synchronizePeriodicNote(
  note: Note,
  areas: Area[]
): Promise<string> {
  const kind: PeriodicNoteKind =
    note.periodic_key?.startsWith("daily:") ? "daily" : "weekly";
  const [template, snapshot] = await Promise.all([
    getPeriodicTemplate(kind),
    loadSnapshot(kind, areas),
  ]);
  const existingContent = normalizeMarkdown(note.content);
  let content: string;

  if (kind === "daily") {
    const templateContent = carryForwardCustomSections(
      template.content,
      existingContent,
      [
        "Agenda de hoy",
        "Tareas pendientes / para hoy",
        "Bitácora / Notas rápidas del día",
      ]
    );
    const journal = extractSection(
      existingContent,
      "Bitácora / Notas rápidas del día"
    );
    content = dailyContent(snapshot, templateContent, journal);
  } else {
    const dayNotes = new Map<string, string>();
    for (const day of snapshot.days) {
      const key = localDateKey(day);
      const saved = extractSection(existingContent, `Notas del día: ${key}`);
      if (saved !== undefined) dayNotes.set(key, saved);
    }
    const templateContent = carryForwardCustomSections(
      template.content,
      existingContent,
      [
        "Foco de la semana",
        "Agenda y plan diario",
        "Pendientes generales",
        "Notas fijas",
        "Archivo de completados",
      ]
    );
    content = weeklyContent(snapshot, templateContent, {
      focus: extractSection(existingContent, "Foco de la semana"),
      fixedNotes: extractSection(existingContent, "Notas fijas"),
      archive: extractSection(existingContent, "Archivo de completados"),
      dayNotes,
    });
  }

  return content;
}

export async function resetWeeklyNote(
  note: Note,
  areas: Area[]
): Promise<string> {
  const [template, snapshot] = await Promise.all([
    getPeriodicTemplate("weekly"),
    loadSnapshot("weekly", areas),
  ]);
  const existingContent = normalizeMarkdown(note.content);
  const completed = completedTaskTitles(existingContent);
  const previousArchive = extractSection(existingContent, "Archivo de completados");
  const newArchive = makeList(completed);
  const archive = [previousArchive, newArchive].filter(Boolean).join("\n");
  const templateContent = carryForwardCustomSections(
    template.content,
    existingContent,
    [
      "Foco de la semana",
      "Agenda y plan diario",
      "Pendientes generales",
      "Notas fijas",
      "Archivo de completados",
    ]
  );
  return weeklyContent(snapshot, templateContent, {
    fixedNotes: extractSection(existingContent, "Notas fijas"),
    archive: archive || undefined,
  });
}
