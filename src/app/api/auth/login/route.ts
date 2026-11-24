import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  assertAuthConfiguration,
  setSessionCookie,
  type AuthenticatedUser,
} from "@/lib/auth";

interface LoginRow extends AuthenticatedUser {
  password_hash: string;
}

export async function POST(request: Request) {
  assertAuthConfiguration();
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    !body.email.trim() ||
    !body.password
  ) {
    return NextResponse.json({ error: "Completá el correo y la contraseña." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const { rows } = await query<LoginRow>(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  if (!user || !(await compare(body.password, user.password_hash))) {
    return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
  }

  await setSessionCookie({ id: user.id, email: user.email });
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}
