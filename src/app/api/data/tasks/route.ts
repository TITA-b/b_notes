import { NextResponse } from "next/server";
import type { Task } from "@/types/task";
import { authenticateDataRequest, invalidRequest, notFound } from "@/app/api/data/_lib";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const area = url.searchParams.get("area");
  const eventId = url.searchParams.get("gcal_event_id");
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
  const { rows } = await query<Task>(
    `SELECT * FROM tasks WHERE ${filters.join(" AND ")} ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC`,
    values
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: {
    area?: unknown;
    title?: unknown;
    due_date?: unknown;
    completed?: unknown;
    sync_to_gcal?: unknown;
    gcal_event_id?: unknown;
    attachments?: unknown;
  };
  try {
    body = await request.json();
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

  const { rows } = await query<Task>(
    `INSERT INTO tasks
      (user_id, area, title, due_date, completed, sync_to_gcal, gcal_event_id, attachments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      auth.user.id,
      body.area,
      body.title.trim(),
      body.due_date ?? null,
      body.completed === true,
      body.sync_to_gcal === true,
      typeof body.gcal_event_id === "string" ? body.gcal_event_id : null,
      body.attachments ?? [],
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: {
    id?: unknown;
    title?: unknown;
    area?: unknown;
    due_date?: unknown;
    completed?: unknown;
    sync_to_gcal?: unknown;
    gcal_event_id?: unknown;
    attachments?: unknown;
  };
  try {
    body = await request.json();
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
  if (updates.length === 0) return invalidRequest("No hay cambios para guardar.");

  const values: unknown[] = [auth.user.id, body.id];
  const assignments = updates.map(([key, value]) => {
    values.push(value);
    const placeholder = `$${values.length}`;
    return `${key} = ${key === "attachments" ? `${placeholder}::jsonb` : placeholder}`;
  });
  const { rows } = await query<Task>(
    `UPDATE tasks SET ${assignments.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
    values
  );
  if (!rows[0]) return notFound("La tarea no existe.");
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return invalidRequest("Falta el identificador de la tarea.");

  await query("DELETE FROM tasks WHERE user_id = $1 AND id = $2", [auth.user.id, id]);
  return new NextResponse(null, { status: 204 });
}

function isValidDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
