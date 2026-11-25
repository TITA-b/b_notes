import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_PROMPT_CHARS = 24_000;
const MAX_EXCERPT_CHARS = 8_000;

interface AvailableArea {
  slug: string;
  name: string;
}

interface AttachmentResult {
  reply?: unknown;
  output?: unknown;
  text?: unknown;
  transcript?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(title: string, value: string): string {
  const paragraphs = value
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
  return `<h3>${escapeHtml(title)}</h3>${paragraphs.join("")}`;
}

function readReply(value: unknown): AttachmentResult | null {
  const result = Array.isArray(value) ? value[0] : value;
  return isRecord(result) ? result : null;
}

function getStringField(
  result: AttachmentResult | null,
  ...keys: (keyof AttachmentResult)[]
): string {
  for (const key of keys) {
    const value = result?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function extractPdfText(file: File): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const result = await parser.getText();
    return result.text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FILE_BYTES + 128 * 1024
  ) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 24 MB." },
      { status: 413 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "El formulario del adjunto no es válido." },
      { status: 400 }
    );
  }

  const type = form.get("type");
  if (type !== "audio" && type !== "pdf") {
    return NextResponse.json(
      { error: "El tipo de adjunto debe ser audio o pdf." },
      { status: 400 }
    );
  }

  const fileValue = form.get("file");
  const isFile = typeof File !== "undefined" && fileValue instanceof File;
  const file = isFile ? fileValue : null;
  const suppliedText = form.get("text");
  if (
    !file &&
    (typeof suppliedText !== "string" || !suppliedText.trim())
  ) {
    return NextResponse.json(
      { error: "Adjuntá un archivo o enviá texto para procesar." },
      { status: 400 }
    );
  }
  if (file && file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 24 MB." },
      { status: 413 }
    );
  }
  if (file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isAudio = file.type.startsWith("audio/") ||
      /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(file.name);
    if ((type === "pdf" && !isPdf) || (type === "audio" && !isAudio)) {
      return NextResponse.json(
        { error: "El tipo de archivo no coincide con el tipo solicitado." },
        { status: 400 }
      );
    }
  }

  let extractedText = typeof suppliedText === "string" ? suppliedText.trim() : "";
  if (type === "pdf" && file) {
    try {
      extractedText = await extractPdfText(file);
    } catch (error) {
      console.error("Could not extract text from PDF attachment:", error);
      return NextResponse.json(
        { error: "No se pudo leer el PDF. Verificá que no esté dañado." },
        { status: 422 }
      );
    }
    if (!extractedText) {
      return NextResponse.json(
        { error: "El PDF no contiene texto seleccionable para extraer." },
        { status: 422 }
      );
    }
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (type === "audio" && !webhookUrl) {
    return NextResponse.json(
      { error: "Falta configurar N8N_WEBHOOK_URL para transcribir audio." },
      { status: 503 }
    );
  }

  let areas: AvailableArea[] = [];
  try {
    const result = await query<AvailableArea>(
      "SELECT slug, name FROM areas WHERE user_id = $1 ORDER BY position ASC",
      [user.id]
    );
    areas = result.rows;
  } catch (error) {
    console.error("Could not load areas for attachment processing:", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las áreas de la cuenta." },
      { status: 500 }
    );
  }
  if (areas.length === 0) {
    return NextResponse.json(
      { error: "No hay áreas configuradas para esta cuenta." },
      { status: 409 }
    );
  }

  let base64: string | null = null;
  let mimeType: string | null = null;
  let transcript = "";
  let summary = "";
  if (type === "audio" && file) {
    base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    mimeType = file.type || "audio/webm";
  }

  if (webhookUrl) {
    const prompt =
      type === "audio"
        ? "Transcribí este audio con fidelidad y agregá debajo un resumen breve. No ejecutes acciones ni crees notas o tareas."
        : `Resumí brevemente el siguiente documento PDF y destacá sus ideas principales. No ejecutes acciones ni crees notas o tareas.\n\nTexto extraído:\n${extractedText.slice(0, MAX_PROMPT_CHARS)}`;
    const requestBody = {
      userId: user.id,
      userEmail: user.email,
      timestamp: new Date().toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
      }),
      activeArea: areas[0].slug,
      activeNoteId: null,
      message: prompt,
      history:
        type === "audio"
          ? [{ role: "user", content: prompt }]
          : [],
      audioBase64: base64,
      audioMimeType: mimeType,
      audio: base64
        ? {
            base64,
            mimeType: mimeType ?? "audio/webm",
            fileName: file?.name ?? "voice-note.webm",
          }
        : null,
      context: {
        notes: "No se proporcionó contexto de notas.",
        tasks: "No se proporcionó contexto de tareas.",
        calendar: "No se proporcionó contexto de calendario.",
        availableAreas: areas,
        relevantNotes: [],
        relevantTasks: [],
      },
    };

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        const detail = await response.text();
        return NextResponse.json(
          {
            error: `n8n devolvió estado ${response.status}: ${
              detail.slice(0, 300) || "Verificá que el workflow esté activo."
            }`,
          },
          { status: 502 }
        );
      }

      const result = readReply(await response.json());
      summary = getStringField(result, "reply", "output", "text");
      transcript = getStringField(result, "transcript");
      if (type === "audio" && !transcript) {
        transcript = summary;
        summary = "";
      }
      if (!summary && !transcript) {
        return NextResponse.json(
          { error: "n8n respondió sin una transcripción o resumen válido." },
          { status: 502 }
        );
      }
    } catch (error) {
      console.error("Could not process attachment through n8n:", error);
      return NextResponse.json(
        { error: "No se pudo conectar con n8n para procesar el adjunto." },
        { status: 502 }
      );
    }
  }

  const excerpt = extractedText.slice(0, MAX_EXCERPT_CHARS);
  const sections: string[] = [];
  const htmlSections: string[] = [];
  if (transcript) {
    sections.push(`### Transcripción\n\n${transcript}`);
    htmlSections.push(textToHtml("Transcripción", transcript));
  }
  if (summary) {
    sections.push(`### Resumen\n\n${summary}`);
    htmlSections.push(textToHtml("Resumen", summary));
  }
  if (type === "pdf" && excerpt) {
    sections.push(`### Extracto del PDF\n\n${excerpt}`);
    htmlSections.push(textToHtml("Extracto del PDF", excerpt));
  }

  return NextResponse.json({
    type,
    transcript: transcript || null,
    summary: summary || null,
    extractedText: type === "pdf" ? excerpt : null,
    markdown: sections.join("\n\n"),
    html: htmlSections.join(""),
  });
}
