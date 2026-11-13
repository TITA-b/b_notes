import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedCalendar } from "@/lib/google";

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

const VALID_AREAS = ["facultad", "weedo", "personal", "finanzas"];

function addOneHour(dateTime: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(dateTime);
  const parsed = new Date(hasTimezone ? dateTime : `${dateTime}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("La fecha de inicio del evento no es válida.");
  }

  const endDate = new Date(parsed.getTime() + 60 * 60 * 1000).toISOString();
  return hasTimezone ? endDate : endDate.slice(0, -1);
}

export async function POST(request: NextRequest) {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Falta configurar N8N_WEBHOOK_URL en el archivo .env.local" },
        { status: 500 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const messages: ChatMessage[] = body.messages ?? [];
    const activeArea: string = body.activeArea ?? "facultad";
    const activeNoteId: string | null = body.activeNoteId ?? null;
    const audioBase64: string | null = body.audioBase64 ?? null;
    const audioMimeType: string | null = body.audioMimeType ?? null;

    // 1. Traer notas del área actual
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title, content, updated_at")
      .eq("area", activeArea)
      .order("updated_at", { ascending: false })
      .limit(12);

    // 2. Traer tareas pendientes de todas las áreas
    const { data: tasks } = await supabase
      .from("tasks")
      .select("area, title, due_date, completed")
      .eq("completed", false)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(20);

    // 3. Traer próximos eventos de Google Calendar
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
                  (ev) =>
                    `- ${ev.summary ?? "Sin título"} (${
                      ev.start?.dateTime ?? ev.start?.date ?? ""
                    })`
                )
                .join("\n");
      }
    } catch {
      calendarSummary = "No se pudieron leer eventos de Calendar en este turno.";
    }

    const notesContext =
      notes && notes.length > 0
        ? notes
            .map((n) => {
              const isCurrent =
                n.id === activeNoteId ? " [NOTA ABIERTA ACTUALMENTE]" : "";
              return `### ${n.title}${isCurrent}\n${n.content.slice(0, 2500)}`;
            })
            .join("\n\n---\n\n")
        : "No hay notas guardadas en esta área todavía.";

    const tasksContext =
      tasks && tasks.length > 0
        ? tasks
            .map(
              (t) =>
                `- [${t.area.toUpperCase()}] ${t.title}${
                  t.due_date ? ` (Vence: ${t.due_date})` : ""
                }`
            )
            .join("\n")
        : "No hay tareas pendientes.";

    const lastUserMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    // Enviar payload estructurado al Webhook de n8n
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

    // Ejecutar acciones solicitadas por el agente en Supabase
    const actions: AiAction[] = Array.isArray(data.actions) ? data.actions : [];
    const executedActions: string[] = [];
    const createdNotes = [];
    const createdTasks = [];
    let updatedNote = null;

    for (const action of actions) {
      const targetArea =
        action.area && VALID_AREAS.includes(action.area.toLowerCase())
          ? action.area.toLowerCase()
          : activeArea;

      if (action.type === "create_task" && action.title) {
        const { data: newTask, error } = await supabase
          .from("tasks")
          .insert({
            user_id: user.id,
            area: targetArea,
            title: action.title.trim(),
            due_date: action.due_date || null,
            completed: false,
          })
          .select("*")
          .single();

        if (!error && newTask) {
          createdTasks.push(newTask);
          executedActions.push(`Tarea creada: "${action.title}" (${targetArea})`);
        }
      } else if (action.type === "create_note" && action.title) {
        const { data: newNote, error } = await supabase
          .from("notes")
          .insert({
            user_id: user.id,
            area: targetArea,
            title: action.title.trim(),
            content: action.content ?? "",
          })
          .select("*")
          .single();

        if (!error && newNote) {
          createdNotes.push(newNote);
          executedActions.push(`Nota creada: "${action.title}" (${targetArea})`);
        }
      } else if (
        action.type === "append_to_active_note" &&
        activeNoteId &&
        action.content
      ) {
        const { data: currentNote } = await supabase
          .from("notes")
          .select("content")
          .eq("id", activeNoteId)
          .single();

        if (currentNote) {
          const separator = currentNote.content.trim() ? "\n\n" : "";
          const { data: modNote, error } = await supabase
            .from("notes")
            .update({
              content: `${currentNote.content}${separator}${action.content}`,
            })
            .eq("id", activeNoteId)
            .select("*")
            .single();

          if (!error && modNote) {
            updatedNote = modNote;
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error conectando con n8n";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}