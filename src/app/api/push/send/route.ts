import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendNotification, setVapidDetails } from "web-push";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInternalAuthorization(candidate: string | null): boolean {
  const expected = process.env.INTERNAL_PUSH_SECRET;
  if (!expected || !candidate) return false;
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

function parsePayload(value: unknown): PushPayload | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.body !== "string" ||
    typeof value.url !== "string"
  ) {
    return null;
  }

  try {
    const parsedUrl = new URL(value.url, "https://bnotes.invalid");
    if (parsedUrl.origin !== "https://bnotes.invalid") return null;
    return {
      title: value.title.trim().slice(0, 120),
      body: value.body.trim().slice(0, 500),
      url: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const internalAuthorization = hasInternalAuthorization(
    request.headers.get("x-internal-secret")
  );
  const user = internalAuthorization ? null : await getCurrentUser();
  if (!internalAuthorization && !user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json(
      { error: "Falta configurar las claves VAPID del servidor." },
      { status: 503 }
    );
  }

  let payload: PushPayload | null = null;
  try {
    payload = parsePayload(await request.json());
  } catch {
    payload = null;
  }
  if (!payload) {
    return NextResponse.json(
      { error: "El contenido de la notificación no es válido." },
      { status: 400 }
    );
  }

  try {
    setVapidDetails(subject, publicKey, privateKey);
  } catch (error) {
    console.error("VAPID configuration is invalid:", error);
    return NextResponse.json(
      { error: "La configuración VAPID no es válida." },
      { status: 500 }
    );
  }

  try {
    const values: unknown[] = [];
    const userFilter = user ? "WHERE user_id = $1" : "";
    if (user) values.push(user.id);
    const { rows } = await query<PushSubscriptionRow>(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions ${userFilter}`,
      values
    );
    const results = await Promise.all(
      rows.map(async (subscription) => {
        try {
          await sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: payload.title,
              body: payload.body,
              data: { url: payload.url },
            })
          );
          return { endpoint: subscription.endpoint, sent: true };
        } catch (error) {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
              ? error.statusCode
              : null;
          if (statusCode === 404 || statusCode === 410) {
            await query(
              "DELETE FROM push_subscriptions WHERE endpoint = $1",
              [subscription.endpoint]
            );
            return { endpoint: subscription.endpoint, sent: false, expired: true };
          }
          console.error("Could not send Push notification:", error);
          return { endpoint: subscription.endpoint, sent: false };
        }
      })
    );
    return NextResponse.json({
      ok: true,
      sent: results.filter((result) => result.sent).length,
      expired: results.filter((result) => "expired" in result).length,
      failed: results.filter(
        (result) => !result.sent && !("expired" in result)
      ).length,
    });
  } catch (error) {
    console.error("Error sending Push notifications:", error);
    return NextResponse.json(
      { error: "No se pudieron enviar las notificaciones Push." },
      { status: 500 }
    );
  }
}
