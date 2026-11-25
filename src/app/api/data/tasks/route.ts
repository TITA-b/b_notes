import { NextResponse } from "next/server";
import type { Task } from "@/types/task";
import { authenticateDataRequest, invalidRequest, notFound } from "@/app/api/data/_lib";
import { query } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type TaskRow = Omit<Task, "noteId"> & { note_id: string | null };

function normalizeTask(task: TaskRow): Task {
  const { note_id, ...fields } = task;
  return {
    ...fields,
    noteId: note_id,
    attachments: Array.isArray(fields.attachments) ? fields.attachments : [],
  };
}

async function noteBelongsToUser(
  noteId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM notes WHERE id = $1 AND user_id = $2) AS exists",
    [noteId, userId]
  );
  return rows[0]?.exists === true;
}

export async function GET(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const area = url.searchParams.get("area");
  const eventId = url.searchParams.get("gcal_event_id");
  const noteId = url.searchParams.get("note_id");
  const values: unknown[] = [auth.user.id];
  const filters = ["user_id = $1"];
  if (area) {
    values.push(area);
    filters.push(`area = $${values.length}`);
  }
  if (eventId) {
    values.push(eventId);
    filters.push(`gcal_event_id = $${values.length}`);
  }
  if (noteId) {
    values.push(noteId);
    filters.push(`note_id = $${values.length}`);
  }
  try {
    const { rows } = await query<TaskRow>(
      `SELECT * FROM tasks WHERE ${filters.join(" AND ")} ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC`,
      values
    );
    return NextResponse.json(rows.map(normalizeTask));
  } catch (error) {
    console.error("Error listing tasks from PostgreSQL:", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las tareas." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return invalidRequest("El cuerpo de la solicitud no es válido.");
    }
    body = parsed;
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.area !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return invalidRequest("Faltan datos válidos para crear la tarea.");
  }
  if (body.due_date !== undefined && body.due_date !== null && !isValidDate(body.due_date)) {
    return invalidRequest("La fecha de vencimiento no es válida.");
  }
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
    return invalidRequest("Los adjuntos no son válidos.");
  }
  if (
    body.noteId !== undefined &&
    body.noteId !== null &&
    (typeof body.noteId !== "string" || !isUuid(body.noteId))
  ) {
    return invalidRequest("La nota asociada no es válida.");
  }

  try {
    const noteId = typeof body.noteId === "string" ? body.noteId : null;
    if (noteId && !(await noteBelongsToUser(noteId, auth.user.id))) {
      return invalidRequest("La nota asociada no existe.");
    }
    const { rows } = await query<TaskRow>(
      `INSERT INTO tasks
        (user_id, area, title, due_date, completed, sync_to_gcal, gcal_event_id, attachments, note_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        auth.user.id,
        body.area,
        body.title.trim(),
        body.due_date ?? null,
        body.completed === true,
        body.sync_to_gcal === true,
        typeof body.gcal_event_id === "string" ? body.gcal_event_id : null,
        JSON.stringify(body.attachments ?? []),
        noteId,
      ]
    );
    if (!rows[0]) {
      console.error("PostgreSQL returned no task after a successful insert.");
      return NextResponse.json(
        { error: "No se pudo crear la tarea." },
        { status: 500 }
      );
    }
    return NextResponse.json(normalizeTask(rows[0]), { status: 201 });
  } catch (error) {
    console.error("Error creating task in PostgreSQL:", error);
    return NextResponse.json(
      { error: "No se pudo crear la tarea." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return invalidRequest("El cuerpo de la solicitud no es válido.");
    }
    body = parsed;
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.id !== "string") return invalidRequest("Falta el identificador de la tarea.");

  const updates: Array<[string, unknown]> = [];
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return invalidRequest("El título de la tarea es obligatorio.");
    }
    updates.push(["title", body.title.trim()]);
  }
  if (typeof body.area === "string") updates.push(["area", body.area]);
  if (body.due_date !== undefined) {
    if (body.due_date !== null && !isValidDate(body.due_date)) {
      return invalidRequest("La fecha de vencimiento no es válida.");
    }
    updates.push(["due_date", body.due_date]);
  }
  if (typeof body.completed === "boolean") updates.push(["completed", body.completed]);
  if (typeof body.sync_to_gcal === "boolean") updates.push(["sync_to_gcal", body.sync_to_gcal]);
  if (body.gcal_event_id === null || typeof body.gcal_event_id === "string") {
    updates.push(["gcal_event_id", body.gcal_event_id]);
  }
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return invalidRequest("Los adjuntos no son válidos.");
    updates.push(["attachments", JSON.stringify(body.attachments)]);
  }
  if (body.noteId !== undefined) {
    if (
      body.noteId !== null &&
      (typeof body.noteId !== "string" || !isUuid(body.noteId))
    ) {
      return invalidRequest("La nota asociada no es válida.");
    }
    updates.push(["note_id", body.noteId]);
  }
  if (updates.length === 0) return invalidRequest("No hay cambios para guardar.");

  try {
    if (
      typeof body.noteId === "string" &&
      !(await noteBelongsToUser(body.noteId, auth.user.id))
    ) {
      return invalidRequest("La nota asociada no existe.");
    }
    const values: unknown[] = [auth.user.id, body.id];
    const assignments = updates.map(([key, value]) => {
      values.push(value);
      const placeholder = `$${values.length}`;
      return `${key} = ${key === "attachments" ? `${placeholder}::jsonb` : placeholder}`;
    });
    const { rows } = await query<TaskRow>(
      `UPDATE tasks SET ${assignments.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
      values
    );
    if (!rows[0]) return notFound("La tarea no existe.");
    return NextResponse.json(normalizeTask(rows[0]));
  } catch (error) {
    console.error("Error updating task in PostgreSQL:", error);
    return NextResponse.json(
      { error: "No se pudo actualizar la tarea." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return invalidRequest("Falta el identificador de la tarea.");

  try {
    await query("DELETE FROM tasks WHERE user_id = $1 AND id = $2", [auth.user.id, id]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting task from PostgreSQL:", error);
    return NextResponse.json(
      { error: "No se pudo eliminar la tarea." },
      { status: 500 }
    );
  }
}

function isValidDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
