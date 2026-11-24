import { NextResponse } from "next/server";
import { authenticateDataRequest, invalidRequest, notFound } from "@/app/api/data/_lib";
import { DEFAULT_AREAS } from "@/lib/defaultAreas";
import { query, withTransaction } from "@/lib/db";
import type { Area } from "@/types/note";

export async function GET() {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  const areas = await withTransaction(async (client) => {
    let { rows } = await client.query<Area>(
      "SELECT * FROM areas WHERE user_id = $1 ORDER BY position ASC",
      [auth.user.id]
    );
    if (rows.length === 0) {
      for (const [position, area] of DEFAULT_AREAS.entries()) {
        await client.query(
          "INSERT INTO areas (user_id, slug, name, icon, color, position) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, slug) DO NOTHING",
          [auth.user.id, area.slug, area.name, area.icon, area.color, position]
        );
      }
      ({ rows } = await client.query<Area>(
        "SELECT * FROM areas WHERE user_id = $1 ORDER BY position ASC",
        [auth.user.id]
      ));
    }
    return rows;
  });
  return NextResponse.json(areas);
}

export async function POST(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: { slug?: unknown; name?: unknown; icon?: unknown; color?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (
    typeof body.slug !== "string" ||
    typeof body.name !== "string" ||
    typeof body.icon !== "string" ||
    typeof body.color !== "string" ||
    !body.slug.trim() ||
    !body.name.trim()
  ) {
    return invalidRequest("Faltan datos válidos para crear el área.");
  }

  const { rows: positionRows } = await query<{ position: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM areas WHERE user_id = $1",
    [auth.user.id]
  );
  try {
    const { rows } = await query<Area>(
      "INSERT INTO areas (user_id, slug, name, icon, color, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [auth.user.id, body.slug.trim(), body.name.trim(), body.icon, body.color, positionRows[0].position]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "Ya existe un área con ese nombre." }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: {
    id?: unknown;
    name?: unknown;
    icon?: unknown;
    color?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.id !== "string") return invalidRequest("Falta el identificador del área.");

  const updates: Array<[string, unknown]> = [];
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return invalidRequest("El nombre del área es obligatorio.");
    }
    updates.push(["name", body.name.trim()]);
  }
  if (typeof body.icon === "string") updates.push(["icon", body.icon]);
  if (typeof body.color === "string") updates.push(["color", body.color]);
  if (updates.length === 0) return invalidRequest("No hay cambios para guardar.");

  const values: unknown[] = [auth.user.id, body.id];
  const assignments = updates.map(([key, value]) => {
    values.push(value);
    return `${key} = $${values.length}`;
  });
  const { rows } = await query<Area>(
    `UPDATE areas SET ${assignments.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
    values
  );
  if (!rows[0]) return notFound("El área no existe.");
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: { id?: unknown; fallbackSlug?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.id !== "string" || typeof body.fallbackSlug !== "string") {
    return invalidRequest("Faltan el área y el área de reemplazo.");
  }

  const result = await withTransaction(async (client) => {
    const { rows: areaRows } = await client.query<{ slug: string }>(
      "SELECT slug FROM areas WHERE user_id = $1 AND id = $2 FOR UPDATE",
      [auth.user.id, body.id]
    );
    const area = areaRows[0];
    if (!area) return { error: "El área no existe.", status: 404 };
    if (area.slug === body.fallbackSlug) {
      return { error: "El área de reemplazo debe ser diferente.", status: 400 };
    }
    const { rows: fallbackRows } = await client.query<{ slug: string }>(
      "SELECT slug FROM areas WHERE user_id = $1 AND slug = $2",
      [auth.user.id, body.fallbackSlug]
    );
    if (!fallbackRows[0]) return { error: "El área de reemplazo ya no existe.", status: 404 };

    await client.query(
      "UPDATE notes SET area = $1 WHERE user_id = $2 AND area = $3",
      [body.fallbackSlug, auth.user.id, area.slug]
    );
    await client.query(
      "UPDATE tasks SET area = $1 WHERE user_id = $2 AND area = $3",
      [body.fallbackSlug, auth.user.id, area.slug]
    );
    await client.query(
      "UPDATE note_templates SET area_slug = $1 WHERE user_id = $2 AND area_slug = $3",
      [body.fallbackSlug, auth.user.id, area.slug]
    );
    await client.query("DELETE FROM areas WHERE user_id = $1 AND id = $2", [
      auth.user.id,
      body.id,
    ]);
    return { error: null, status: 204 };
  });

  if (result.error) {
    return result.status === 404
      ? notFound(result.error)
      : invalidRequest(result.error);
  }
  return new NextResponse(null, { status: 204 });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
