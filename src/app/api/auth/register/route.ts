import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { assertAuthConfiguration, setSessionCookie } from "@/lib/auth";
import { DEFAULT_AREAS } from "@/lib/defaultAreas";
import { NOTE_TEMPLATES } from "@/lib/noteTemplates";
import { withTransaction } from "@/lib/db";

export async function POST(request: Request) {
  assertAuthConfiguration();
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Completá el correo y la contraseña." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Ingresá un correo válido." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }

  const passwordHash = await hash(password, 12);
  try {
    const user = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; email: string }>(
        "INSERT INTO users (email, password_hash, templates_seeded) VALUES ($1, $2, true) RETURNING id, email",
        [email, passwordHash]
      );
      const createdUser = rows[0];
      for (const [position, area] of DEFAULT_AREAS.entries()) {
        await client.query(
          "INSERT INTO areas (user_id, slug, name, icon, color, position) VALUES ($1, $2, $3, $4, $5, $6)",
          [createdUser.id, area.slug, area.name, area.icon, area.color, position]
        );
      }
      for (const template of NOTE_TEMPLATES) {
        await client.query(
          "INSERT INTO note_templates (id, user_id, name, area_slug, default_title, content, position, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [
            template.id,
            createdUser.id,
            template.name,
            template.area_slug,
            template.default_title,
            template.content,
            template.position,
            true,
          ]
        );
      }
      return createdUser;
    });

    await setSessionCookie(user);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
    }
    throw error;
  }
}
