import { NextResponse } from "next/server";
import type { Note } from "@/types/note";
import { authenticateDataRequest, invalidRequest, notFound } from "@/app/api/data/_lib";
import { query, withTransaction } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const area = url.searchParams.get("area");
  const title = url.searchParams.get("title");
  const values: unknown[] = [auth.user.id];
  const filters = ["user_id = $1"];
  if (area) {
    values.push(area);
    filters.push(`area = $${values.length}`);
  }
  if (title) {
    values.push(title);
    filters.push(`lower(title) = lower($${values.length})`);
  }
  const { rows } = await query<Note>(
    `SELECT * FROM notes WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC`,
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
    content?: unknown;
    links?: unknown;
    periodic_key?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (
    typeof body.area !== "string" ||
    typeof body.title !== "string" ||
    !body.title.trim() ||
    (body.content !== undefined && typeof body.content !== "string") ||
    (body.links !== undefined && !Array.isArray(body.links)) ||
    (body.periodic_key !== undefined &&
      body.periodic_key !== null &&
      (typeof body.periodic_key !== "string" ||
        !/^(?:daily:\d{4}-\d{2}-\d{2}|weekly:current)$/.test(
          body.periodic_key
        )))
  ) {
    return invalidRequest("Faltan datos válidos para crear la nota.");
  }

  const periodicKey =
    typeof body.periodic_key === "string" ? body.periodic_key : null;
  const { rows } = await query<Note>(
    `INSERT INTO notes (user_id, area, title, content, links, periodic_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ${
       periodicKey
         ? "ON CONFLICT (user_id, periodic_key) WHERE periodic_key IS NOT NULL DO NOTHING"
         : ""
     }
     RETURNING *`,
    [
      auth.user.id,
      body.area,
      body.title.trim(),
      body.content ?? "",
      body.links ?? [],
      periodicKey,
    ]
  );
  if (rows[0]) return NextResponse.json(rows[0], { status: 201 });
  const existing = await query<Note>(
    "SELECT * FROM notes WHERE user_id = $1 AND periodic_key = $2",
    [auth.user.id, periodicKey]
  );
  if (!existing.rows[0]) {
    console.error("Periodic note conflict returned no existing note.");
    return NextResponse.json(
      { error: "No se pudo recuperar la nota periódica." },
      { status: 500 }
    );
  }
  return NextResponse.json(existing.rows[0]);
}

export async function PATCH(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: {
    id?: unknown;
    title?: unknown;
    content?: unknown;
    links?: unknown;
    periodic_key?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.id !== "string") return invalidRequest("Falta el identificador de la nota.");

  const updates: Array<[string, unknown]> = [];
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return invalidRequest("El título de la nota es obligatorio.");
    }
    updates.push(["title", body.title.trim()]);
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") return invalidRequest("El contenido no es válido.");
    updates.push(["content", body.content]);
  }
  if (body.links !== undefined) {
    if (!Array.isArray(body.links) || !body.links.every((link) => typeof link === "string")) {
      return invalidRequest("Los enlaces de la nota no son válidos.");
    }
    updates.push(["links", JSON.stringify(body.links)]);
  }
  if (body.periodic_key !== undefined) {
    if (
      body.periodic_key !== null &&
      (typeof body.periodic_key !== "string" ||
        !/^(?:daily:\d{4}-\d{2}-\d{2}|weekly:current)$/.test(
          body.periodic_key
        ))
    ) {
      return invalidRequest("La clave de nota periódica no es válida.");
    }
    updates.push(["periodic_key", body.periodic_key]);
  }
  if (updates.length === 0) return invalidRequest("No hay cambios para guardar.");

  const values: unknown[] = [auth.user.id, body.id];
  const assignments = updates.map(([key, value]) => {
    values.push(value);
    const placeholder = `$${values.length}`;
    return `${key} = ${key === "links" ? `${placeholder}::jsonb` : placeholder}`;
  });
  values.push(new Date().toISOString());
  assignments.push(`updated_at = $${values.length}`);
  const { rows } = await query<Note>(
    `UPDATE notes SET ${assignments.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
    values
  );
  if (!rows[0]) return notFound("La nota no existe.");
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return invalidRequest("Falta el identificador de la nota.");

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM notes WHERE user_id = $1 AND id = $2 FOR UPDATE",
        [auth.user.id, id]
      );
      if (!rows[0]) return;
      await client.query(
        "UPDATE tasks SET note_id = NULL WHERE user_id = $1 AND note_id = $2",
        [auth.user.id, id]
      );
      await client.query(
        "DELETE FROM notes WHERE user_id = $1 AND id = $2",
        [auth.user.id, id]
      );
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting note from PostgreSQL:", error);
    return NextResponse.json(
      { error: "No se pudo eliminar la nota." },
      { status: 500 }
    );
  }
}
