import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

interface SubscriptionKeys {
  p256dh?: unknown;
  auth?: unknown;
}

interface SubscriptionPayload {
  endpoint?: unknown;
  keys?: SubscriptionKeys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getSubscriptionPayload(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) return null;
    const subscription = isRecord(body.subscription)
      ? (body.subscription as SubscriptionPayload)
      : (body as SubscriptionPayload);
    if (
      typeof subscription.endpoint !== "string" ||
      !subscription.endpoint.trim() ||
      typeof subscription.keys?.p256dh !== "string" ||
      !subscription.keys.p256dh ||
      typeof subscription.keys.auth !== "string" ||
      !subscription.keys.auth
    ) {
      return null;
    }

    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== "https:") return null;

    return {
      endpoint: endpoint.toString(),
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const subscription = await getSubscriptionPayload(request);
  if (!subscription) {
    return NextResponse.json(
      { error: "La suscripción Push no es válida." },
      { status: 400 }
    );
  }

  try {
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
      [user.id, subscription.endpoint, subscription.p256dh, subscription.auth]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving Push subscription:", error);
    return NextResponse.json(
      { error: "No se pudo guardar la suscripción Push." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const payload = await getSubscriptionPayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: "La suscripción Push no es válida." },
      { status: 400 }
    );
  }

  try {
    await query(
      "DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2",
      [user.id, payload.endpoint]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting Push subscription:", error);
    return NextResponse.json(
      { error: "No se pudo eliminar la suscripción Push." },
      { status: 500 }
    );
  }
}
