import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getAuthenticatedCalendar } from "@/lib/google";
import type { Note } from "@/types/note";
import type { Task } from "@/types/task";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiAction {
  type:
    | "create_task"
    | "create_note"
    | "append_to_active_note"
    | "create_calendar_event";
  area?: string;
  title?: string;
  content?: string;
  due_date?: string | null;
  start_time?: string;
  end_time?: string;
}

interface AvailableArea {
  slug: string;
  name: string;
}

function addOneHour(dateTime: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(dateTime);
  const parsed = new Date(hasTimezone ? dateTime : `${dateTime}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("La fecha de inicio del evento no es válida.");
  }

  const endDate = new Date(parsed.getTime() + 60 * 60 * 1000).toISOString();
  return hasTimezone ? endDate : endDate.slice(0, -1);
}

function extractWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  return [...new Set([...matches].map((match) => match[1].trim()).filter(Boolean))];
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

export async function POST(request: Request) {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Falta configurar N8N_WEBHOOK_URL en el archivo .env.local" },
        { status: 500 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { rows: availableAreas } = await query<AvailableArea>(
      "SELECT slug, name FROM areas WHERE user_id = $1 ORDER BY position ASC",
      [user.id]
    );
    if (availableAreas.length === 0) {
      return NextResponse.json(
        { error: "No hay áreas configuradas para esta cuenta." },
        { status: 409 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(isChatMessage).slice(-12)
      : [];
    const requestedActiveArea =
      typeof body.activeArea === "string" ? body.activeArea.toLowerCase() : "";
    const activeArea =
      availableAreas.find(
        (area) => area.slug.toLowerCase() === requestedActiveArea
      )?.slug ?? availableAreas[0].slug;
    const activeNoteId =
      typeof body.activeNoteId === "string" ? body.activeNoteId : null;
    const audioBase64 =
      typeof body.audioBase64 === "string" ? body.audioBase64 : null;
    const audioMimeType =
      typeof body.audioMimeType === "string" ? body.audioMimeType : null;

    const { rows: notes } = await query<
      Pick<Note, "id" | "title" | "content" | "updated_at">
    >(
      `SELECT id, title, content, updated_at FROM notes
       WHERE user_id = $1 AND area = $2
       ORDER BY updated_at DESC LIMIT 12`,
      [user.id, activeArea]
    );
    const { rows: tasks } = await query<
      Pick<Task, "area" | "title" | "due_date" | "completed">
    >(
      `SELECT area, title, due_date, completed FROM tasks
       WHERE user_id = $1 AND completed = false
       ORDER BY due_date ASC NULLS LAST LIMIT 20`,
      [user.id]
    );

    let calendarSummary = "Google Calendar no conectado.";
    try {
      const calendar = await getAuthenticatedCalendar();
      if (calendar) {
        const res = await calendar.events.list({
          calendarId: "primary",
          timeMin: new Date().toISOString(),
          maxResults: 10,
          singleEvents: true,
          orderBy: "startTime",
        });
        const items = res.data.items ?? [];
        calendarSummary =
          items.length === 0
            ? "Sin eventos próximos en Google Calendar."
            : items
                .map(
                  (event) =>
                    `- ${event.summary ?? "Sin título"} (${
                      event.start?.dateTime ?? event.start?.date ?? ""
                    })`
                )
                .join("\n");
      }
    } catch {
      calendarSummary = "No se pudieron leer eventos de Calendar en este turno.";
    }

    const notesContext =
      notes.length > 0
        ? notes
            .map((note) => {
              const isCurrent =
                note.id === activeNoteId ? " [NOTA ABIERTA ACTUALMENTE]" : "";
              return `### ${note.title}${isCurrent}\n${note.content.slice(0, 2500)}`;
            })
            .join("\n\n---\n\n")
        : "No hay notas guardadas en esta área todavía.";
    const tasksContext =
      tasks.length > 0
        ? tasks
            .map((task) => {
              const areaName =
                availableAreas.find((area) => area.slug === task.area)?.name ??
                task.area;
              return `- [${areaName}] ${task.title}${
                task.due_date ? ` (Vence: ${task.due_date})` : ""
              }`;
            })
            .join("\n")
        : "No hay tareas pendientes.";
    const lastUserMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        userEmail: user.email,
        timestamp: new Date().toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
        }),
        activeArea,
        activeNoteId,
        message: lastUserMessage,
        history: messages,
        audio: audioBase64
          ? {
              base64: audioBase64,
              mimeType: audioMimeType ?? "audio/webm",
              fileName: "voice-note.webm",
            }
          : null,
        context: {
          notes: notesContext,
          tasks: tasksContext,
          calendar: calendarSummary,
          availableAreas: availableAreas.map(({ slug, name }) => ({
            slug,
            name,
          })),
        },
      }),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      return NextResponse.json(
        {
          error: `n8n devolvió estado ${n8nResponse.status}: ${
            errorText || "Verificá que el workflow esté activo"
          }`,
        },
        { status: 502 }
      );
    }

    const data = await n8nResponse.json();
    const reply: string | null =
      data.reply ??
      data.output ??
      data.text ??
      (typeof data === "string" ? data : null);
    if (!reply) {
      return NextResponse.json(
        { error: "n8n respondió sin un campo 'reply' válido." },
        { status: 502 }
      );
    }

    const actions: AiAction[] = Array.isArray(data.actions)
      ? data.actions
      : [];
    const executedActions: string[] = [];
    const createdNotes: Note[] = [];
    const createdTasks: Task[] = [];
    let updatedNote: Note | null = null;

    for (const action of actions) {
      const requestedArea = action.area?.trim().toLowerCase();
      const targetArea =
        availableAreas.find(
          (area) =>
            area.slug.toLowerCase() === requestedArea ||
            area.name.toLowerCase() === requestedArea
        )?.slug ?? activeArea;

      if (action.type === "create_task" && action.title) {
        const { rows } = await query<Task>(
          `INSERT INTO tasks (user_id, area, title, due_date, completed)
           VALUES ($1, $2, $3, $4, false) RETURNING *`,
          [
            user.id,
            targetArea,
            action.title.trim(),
            action.due_date || null,
          ]
        );
        createdTasks.push(rows[0]);
        executedActions.push(`Tarea creada: "${action.title}" (${targetArea})`);
      } else if (action.type === "create_note" && action.title) {
        const content = action.content ?? "";
        const { rows } = await query<Note>(
          `INSERT INTO notes (user_id, area, title, content, links)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            user.id,
            targetArea,
            action.title.trim(),
            content,
            JSON.stringify(extractWikilinks(content)),
          ]
        );
        createdNotes.push(rows[0]);
        executedActions.push(`Nota creada: "${action.title}" (${targetArea})`);
      } else if (
        action.type === "append_to_active_note" &&
        activeNoteId &&
        action.content
      ) {
        const { rows: currentRows } = await query<{ content: string }>(
          "SELECT content FROM notes WHERE user_id = $1 AND id = $2",
          [user.id, activeNoteId]
        );
        const currentNote = currentRows[0];
        if (currentNote) {
          const separator = currentNote.content.trim() ? "\n\n" : "";
          const content = `${currentNote.content}${separator}${action.content}`;
          const { rows } = await query<Note>(
            `UPDATE notes SET content = $1, links = $2, updated_at = now()
             WHERE user_id = $3 AND id = $4 RETURNING *`,
            [content, JSON.stringify(extractWikilinks(content)), user.id, activeNoteId]
          );
          if (rows[0]) {
            updatedNote = rows[0];
            executedActions.push("Contenido agregado a la nota abierta");
          }
        }
      } else if (
        action.type === "create_calendar_event" &&
        action.title &&
        action.start_time
      ) {
        const calendar = await getAuthenticatedCalendar();
        if (!calendar) {
          executedActions.push(
            `Evento no creado: Google Calendar no conectado ("${action.title}")`
          );
          continue;
        }

        const endTime = action.end_time ?? addOneHour(action.start_time);
        const createdEvent = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: action.title.trim(),
            start: {
              dateTime: action.start_time,
              timeZone: "America/Argentina/Buenos_Aires",
            },
            end: {
              dateTime: endTime,
              timeZone: "America/Argentina/Buenos_Aires",
            },
          },
        });
        executedActions.push(
          `Evento creado: "${action.title}" (${createdEvent.data.id ?? "Google Calendar"})`
        );
      }
    }

    return NextResponse.json({
      reply,
      transcript: data.transcript ?? null,
      executedActions,
      createdNotes,
      createdTasks,
      updatedNote,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error conectando con n8n";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
