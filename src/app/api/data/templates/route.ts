import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import type { NoteTemplate } from "@/types/note";
import { authenticateDataRequest, invalidRequest, notFound } from "@/app/api/data/_lib";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import { query, withTransaction } from "@/lib/db";

type TemplateUpdate = Partial<
  Pick<NoteTemplate, "name" | "area_slug" | "default_title" | "content" | "position">
>;

export async function GET() {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  const templates = await withTransaction(async (client) => {
    const { rows } = await client.query<NoteTemplate>(
      `SELECT id, name, area_slug, default_title, content, position, is_default
       FROM note_templates WHERE user_id = $1 ORDER BY position ASC`,
      [auth.user.id]
    );
    if (rows.length === 0) {
      const { rows: userRows } = await client.query<{ templates_seeded: boolean }>(
        "SELECT templates_seeded FROM users WHERE id = $1 FOR UPDATE",
        [auth.user.id]
      );
      if (userRows[0] && !userRows[0].templates_seeded) {
        await insertDefaultTemplates(client, auth.user.id);
        await client.query("UPDATE users SET templates_seeded = true WHERE id = $1", [
          auth.user.id,
        ]);
      }
    }
    await insertMissingPeriodicTemplates(client, auth.user.id);
    const { rows: currentTemplates } = await client.query<NoteTemplate>(
      `SELECT id, name, area_slug, default_title, content, position, is_default
       FROM note_templates WHERE user_id = $1 ORDER BY position ASC`,
      [auth.user.id]
    );
    return currentTemplates;
  });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: {
    action?: unknown;
    name?: unknown;
    area_slug?: unknown;
    default_title?: unknown;
    content?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }

  if (body.action === "resetDefaultTemplates") {
    const templates = await withTransaction(async (client) => {
      await client.query(
        "DELETE FROM note_templates WHERE user_id = $1 AND is_default = true",
        [auth.user.id]
      );
      await insertDefaultTemplates(client, auth.user.id);
      await client.query("UPDATE users SET templates_seeded = true WHERE id = $1", [
        auth.user.id,
      ]);
      const { rows } = await client.query<NoteTemplate>(
        `SELECT id, name, area_slug, default_title, content, position, is_default
         FROM note_templates WHERE user_id = $1 ORDER BY position ASC`,
        [auth.user.id]
      );
      return rows;
    });
    return NextResponse.json(templates);
  }

  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    (body.area_slug !== null && typeof body.area_slug !== "string") ||
    typeof body.default_title !== "string" ||
    typeof body.content !== "string"
  ) {
    return invalidRequest("Faltan datos válidos para crear la plantilla.");
  }
  const { rows: positionRows } = await query<{ position: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM note_templates WHERE user_id = $1",
    [auth.user.id]
  );
  const { rows } = await query<NoteTemplate>(
    `INSERT INTO note_templates
      (id, user_id, name, area_slug, default_title, content, position, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING id, name, area_slug, default_title, content, position, is_default`,
    [
      randomUUID(),
      auth.user.id,
      body.name.trim(),
      body.area_slug,
      body.default_title,
      body.content,
      positionRows[0].position,
    ]
  );
  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;

  let body: { id?: unknown } & TemplateUpdate;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (typeof body.id !== "string") return invalidRequest("Falta el identificador de la plantilla.");

  const updates: Array<[keyof TemplateUpdate, unknown]> = [];
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return invalidRequest("El nombre de la plantilla es obligatorio.");
    }
    updates.push(["name", body.name.trim()]);
  }
  if (body.area_slug === null || typeof body.area_slug === "string") {
    updates.push(["area_slug", body.area_slug]);
  }
  if (typeof body.default_title === "string") updates.push(["default_title", body.default_title]);
  if (typeof body.content === "string") updates.push(["content", body.content]);
  if (typeof body.position === "number" && Number.isInteger(body.position)) {
    updates.push(["position", body.position]);
  }
  if (updates.length === 0) return invalidRequest("No hay cambios para guardar.");

  const values: unknown[] = [auth.user.id, body.id];
  const assignments = updates.map(([key, value]) => {
    values.push(value);
    return `${key} = $${values.length}`;
  });
  const { rows } = await query<NoteTemplate>(
    `UPDATE note_templates SET ${assignments.join(", ")}
     WHERE user_id = $1 AND id = $2
     RETURNING id, name, area_slug, default_title, content, position, is_default`,
    values
  );
  if (!rows[0]) return notFound("La plantilla no existe.");
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return invalidRequest("Falta el identificador de la plantilla.");

  await query("DELETE FROM note_templates WHERE user_id = $1 AND id = $2", [
    auth.user.id,
    id,
  ]);
  return new NextResponse(null, { status: 204 });
}

async function insertDefaultTemplates(
  client: PoolClient,
  userId: string
): Promise<void> {
  for (const template of NOTE_TEMPLATES) {
    await client.query(
      `INSERT INTO note_templates
        (id, user_id, name, area_slug, default_title, content, position, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [
        template.id,
        userId,
        template.name,
        template.area_slug,
        template.default_title,
        template.content,
        template.position,
      ]
    );
  }
}

async function insertMissingPeriodicTemplates(
  client: PoolClient,
  userId: string
): Promise<void> {
  for (const template of NOTE_TEMPLATES.filter((item) =>
    ["periodic-daily", "periodic-weekly"].includes(item.id)
  )) {
    await client.query(
      `INSERT INTO note_templates
        (id, user_id, name, area_slug, default_title, content, position, is_default)
       SELECT $1, $2, $3, $4, $5, $6, $7, true
       WHERE NOT EXISTS (
         SELECT 1 FROM note_templates
         WHERE user_id = $2 AND lower(btrim(name)) = lower($3)
       )
       ON CONFLICT (user_id, id) DO NOTHING`,
      [
        template.id,
        userId,
        template.name,
        template.area_slug,
        template.default_title,
        template.content,
        template.position,
      ]
    );
  }
}
