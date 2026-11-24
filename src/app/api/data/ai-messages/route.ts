import { NextResponse } from "next/server";
import { authenticateDataRequest, invalidRequest } from "@/app/api/data/_lib";
import { query } from "@/lib/db";
import type { AiMessage } from "@/services/aiMessagesService";

export async function GET(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 200)
    : 50;

  const { rows } = await query<AiMessage>(
    `SELECT id, user_id, role, content, area, created_at
     FROM ai_messages WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [auth.user.id, limit]
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  let body: { role?: unknown; content?: unknown; area?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalidRequest("El cuerpo de la solicitud no es válido.");
  }
  if (
    (body.role !== "user" && body.role !== "assistant") ||
    typeof body.content !== "string" ||
    (body.area !== undefined && body.area !== null && typeof body.area !== "string")
  ) {
    return invalidRequest("Los datos del mensaje no son válidos.");
  }
  const { rows } = await query<AiMessage>(
    `INSERT INTO ai_messages (user_id, role, content, area)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, role, content, area, created_at`,
    [auth.user.id, body.role, body.content, body.area ?? null]
  );
  return NextResponse.json(rows[0], { status: 201 });
}

export async function DELETE() {
  const auth = await authenticateDataRequest();
  if (auth.response) return auth.response;
  await query("DELETE FROM ai_messages WHERE user_id = $1", [auth.user.id]);
  return new NextResponse(null, { status: 204 });
}
