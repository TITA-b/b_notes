import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedCalendar } from "@/lib/google";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const calendar = await getAuthenticatedCalendar();
    if (!calendar) {
      return NextResponse.json({
        connected: false,
        reason: "no_google_token",
        events: [],
      });
    }

    const timeMinParam = request.nextUrl.searchParams.get("timeMin");
    const timeMaxParam = request.nextUrl.searchParams.get("timeMax");
    if (Boolean(timeMinParam) !== Boolean(timeMaxParam)) {
      return NextResponse.json(
        { error: "timeMin y timeMax deben enviarse juntos." },
        { status: 400 }
      );
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const timeMin = timeMinParam ? new Date(timeMinParam) : startOfToday;
    const timeMax = timeMaxParam ? new Date(timeMaxParam) : undefined;
    if (
      Number.isNaN(timeMin.getTime()) ||
      (timeMax &&
        (Number.isNaN(timeMax.getTime()) ||
          timeMax <= timeMin ||
          timeMax.getTime() - timeMin.getTime() > 31 * 24 * 60 * 60 * 1000))
    ) {
      return NextResponse.json(
        { error: "El rango de fechas de Calendar no es válido." },
        { status: 400 }
      );
    }

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin.toISOString(),
      ...(timeMax ? { timeMax: timeMax.toISOString() } : {}),
      maxResults: timeMax ? 250 : 50,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (res.data.items ?? []).map((ev) => ({
      id: ev.id ?? "",
      summary: ev.summary ?? "Evento sin título",
      start: ev.start?.dateTime ?? ev.start?.date ?? "",
      htmlLink: ev.htmlLink ?? "",
    }));

    return NextResponse.json({ connected: true, events });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      connected: false,
      reason: message,
      events: [],
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const calendar = await getAuthenticatedCalendar();
    if (!calendar) {
      return NextResponse.json(
        { error: "Google Calendar no está conectado" },
        { status: 401 }
      );
    }

    const { taskId, title, dueDate, area } = await request.json();
    const startDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 3600000);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hora

    const created = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: `[${String(area).toUpperCase()}] ${title}`,
        description: "Sincronizado desde B_Notes",
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      },
    });

    const eventId = created.data.id ?? null;

    if (taskId && eventId) {
      const user = await getCurrentUser();
      if (user) {
        await query(
          "UPDATE tasks SET sync_to_gcal = true, gcal_event_id = $1 WHERE id = $2 AND user_id = $3",
          [eventId, taskId, user.id]
        );
      }
    }

    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al crear evento";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      eventId?: unknown;
      title?: unknown;
      dueDate?: unknown;
      area?: unknown;
    };
    if (
      typeof body.eventId !== "string" ||
      typeof body.title !== "string" ||
      typeof body.area !== "string"
    ) {
      return NextResponse.json(
        { error: "Faltan eventId, title o area." },
        { status: 400 }
      );
    }

    const calendar = await getAuthenticatedCalendar();
    if (!calendar) {
      return NextResponse.json(
        { error: "Google Calendar no está conectado." },
        { status: 401 }
      );
    }

    const requestBody: {
      summary: string;
      start?: { dateTime: string };
      end?: { dateTime: string };
    } = {
      summary: `[${body.area.toUpperCase()}] ${body.title}`,
    };

    if (typeof body.dueDate === "string" && body.dueDate) {
      const startDate = new Date(body.dueDate);
      if (Number.isNaN(startDate.getTime())) {
        return NextResponse.json(
          { error: "La fecha del evento no es válida." },
          { status: 400 }
        );
      }
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      requestBody.start = { dateTime: startDate.toISOString() };
      requestBody.end = { dateTime: endDate.toISOString() };
    } else if (
      body.dueDate !== undefined &&
      body.dueDate !== null &&
      body.dueDate !== ""
    ) {
      return NextResponse.json(
        { error: "La fecha del evento no es válida." },
        { status: 400 }
      );
    }

    const updated = await calendar.events.patch({
      calendarId: "primary",
      eventId: body.eventId,
      requestBody,
    });

    return NextResponse.json({
      ok: true,
      eventId: updated.data.id ?? body.eventId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al actualizar evento";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const eventId = request.nextUrl.searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ ok: false, reason: "missing_event_id" });
    }

    const calendar = await getAuthenticatedCalendar();
    if (!calendar) {
      return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
    }

    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error eliminando evento de Google Calendar:", message);
    return NextResponse.json({ ok: false, reason: message }, { status: 500 });
  }
}