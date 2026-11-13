import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedCalendar } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const calendar = await getAuthenticatedCalendar();
    if (!calendar) {
      return NextResponse.json({
        connected: false,
        reason: "no_token_in_supabase",
        events: [],
      });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: startOfToday.toISOString(),
      maxResults: 50,
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
      const supabase = await createClient();
      await supabase
        .from("tasks")
        .update({ sync_to_gcal: true, gcal_event_id: eventId })
        .eq("id", taskId);
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