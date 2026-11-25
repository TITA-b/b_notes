import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import { getCurrentUser } from "@/lib/auth";
import { getAuthenticatedDrive } from "@/lib/google";
import { extractDriveFileId } from "@/lib/driveMedia";
import { query } from "@/lib/db";

const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 15_000;
const MAX_EXCERPT_CHARS = 8_000;

type AttachmentType = "audio" | "pdf";

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

interface AttachmentInput {
  type: AttachmentType;
  fileName: string;
  mimeType: string;
  buffer: Buffer | null;
  suppliedText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferAttachmentType(
  fileName: string,
  mimeType: string
): AttachmentType | null {
  if (
    mimeType.startsWith("audio/") ||
    /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(fileName)) {
    return "audio";
  }
  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) {
    return "pdf";
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdownLabel(value: string): string {
  return value
    .replace(/[\r\n]/g, " ")
    .replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function formatQuote(
  label: string,
  fileName: string,
  value: string
): { markdown: string; html: string } {
  const cleanValue = value.trim();
  const markdown = `> **${label} (${escapeMarkdownLabel(fileName)}):**\n${cleanValue
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")}`;
  const htmlValue = escapeHtml(cleanValue).replace(/\r?\n/g, "<br>");
  const html = `<blockquote><p><strong>${escapeHtml(label)} (${escapeHtml(fileName)}):</strong><br>${htmlValue}</p></blockquote>`;
  return { markdown, html };
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

async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await extractText(new Uint8Array(buffer), {
    mergePages: true,
  });
  return result.text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

async function readAttachment(
  request: Request
): Promise<AttachmentInput | NextResponse> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  let fileName = "";
  let mimeType = "";
  let buffer: Buffer | null = null;
  let suppliedType: string | null = null;
  let suppliedText = "";

  if (contentType.includes("application/json")) {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "El cuerpo JSON del adjunto no es válido." },
        { status: 400 }
      );
    }
    if (!isRecord(payload)) {
      return NextResponse.json(
        { error: "Los datos del adjunto no son válidos." },
        { status: 400 }
      );
    }

    const fileId =
      (typeof payload.fileId === "string"
        ? extractDriveFileId(payload.fileId)
        : null) ??
      (typeof payload.url === "string"
        ? extractDriveFileId(payload.url)
        : null);
    if (!fileId) {
      return NextResponse.json(
        { error: "Falta un identificador válido del archivo de Google Drive." },
        { status: 400 }
      );
    }

    const drive = await getAuthenticatedDrive();
    if (!drive) {
      return NextResponse.json(
        { error: "Iniciá sesión y conectá Google Drive." },
        { status: 401 }
      );
    }

    const metadata = await drive.files.get({
      fileId,
      fields: "mimeType,name,size",
    });
    const driveSize = Number(metadata.data.size);
    if (Number.isFinite(driveSize) && driveSize > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el límite de 24 MB." },
        { status: 413 }
      );
    }

    const content = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    buffer = Buffer.from(content.data as ArrayBuffer);
    if (buffer.byteLength > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el límite de 24 MB." },
        { status: 413 }
      );
    }
    fileName =
      typeof payload.fileName === "string" && payload.fileName.trim()
        ? payload.fileName.trim()
        : metadata.data.name ?? "adjunto";
    mimeType =
      metadata.data.mimeType ||
      (typeof payload.mimeType === "string" ? payload.mimeType : "");
    suppliedType = typeof payload.type === "string" ? payload.type : null;
  } else if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "El formulario del adjunto no es válido." },
        { status: 400 }
      );
    }

    const fileValue = form.get("file");
    if (typeof File !== "undefined" && fileValue instanceof File) {
      if (fileValue.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "El archivo supera el límite de 24 MB." },
          { status: 413 }
        );
      }
      fileName = fileValue.name;
      mimeType = fileValue.type;
      buffer = Buffer.from(await fileValue.arrayBuffer());
    }
    const typeValue = form.get("type");
    suppliedType = typeof typeValue === "string" ? typeValue : null;
    const textValue = form.get("text");
    suppliedText = typeof textValue === "string" ? textValue.trim() : "";
  } else {
    return NextResponse.json(
      { error: "El adjunto debe enviarse como FormData o application/json." },
      { status: 415 }
    );
  }

  const inferredType = inferAttachmentType(fileName, mimeType);
  const requestedType =
    suppliedType === "audio" || suppliedType === "pdf" ? suppliedType : null;
  if (
    (suppliedType && !requestedType) ||
    (inferredType && requestedType && inferredType !== requestedType)
  ) {
    return NextResponse.json(
      { error: "El tipo de archivo no coincide con el tipo solicitado." },
      { status: 400 }
    );
  }
  const type = inferredType ?? requestedType;
  if (!type) {
    return NextResponse.json(
      { error: "El tipo de archivo no coincide con el tipo solicitado." },
      { status: 400 }
    );
  }
  if (!buffer && !(type === "pdf" && suppliedText)) {
    return NextResponse.json(
      { error: "Adjuntá un archivo válido para procesar." },
      { status: 400 }
    );
  }
  if (type === "audio" && !buffer) {
    return NextResponse.json(
      { error: "Adjuntá un archivo de audio para transcribir." },
      { status: 400 }
    );
  }

  return { type, fileName, mimeType, buffer, suppliedText };
}

async function processAttachment(request: Request): Promise<NextResponse> {
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

  const attachment = await readAttachment(request);
  if (attachment instanceof NextResponse) return attachment;

  let extractedText = attachment.suppliedText;
  if (attachment.type === "pdf" && attachment.buffer) {
    extractedText = await extractPdfText(attachment.buffer);
    if (!extractedText) {
      return NextResponse.json(
        {
          error:
            "El PDF no contiene texto seleccionable (puede ser un documento escaneado).",
        },
        { status: 422 }
      );
    }
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "Falta configurar N8N_WEBHOOK_URL para procesar el adjunto." },
      { status: 503 }
    );
  }

  const areasResult = await query<AvailableArea>(
    "SELECT slug, name FROM areas WHERE user_id = $1 ORDER BY position ASC",
    [user.id]
  );
  const areas = areasResult.rows;
  if (areas.length === 0) {
    return NextResponse.json(
      { error: "No hay áreas configuradas para esta cuenta." },
      { status: 409 }
    );
  }

  const audioBase64 =
    attachment.type === "audio" && attachment.buffer
      ? attachment.buffer.toString("base64")
      : null;
  const audioMimeType =
    attachment.mimeType ||
    (attachment.fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/webm");
  const prompt =
    attachment.type === "audio"
      ? "Transcribí este audio con fidelidad y agregá debajo un resumen breve. No ejecutes acciones ni crees notas o tareas."
      : `Resumí de forma estructurada en español el siguiente documento PDF:\n\n${extractedText}`;
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
      attachment.type === "audio"
        ? [{ role: "user", content: prompt }]
        : [],
    audioBase64,
    audioMimeType: attachment.type === "audio" ? audioMimeType : null,
    audio: audioBase64
      ? {
          base64: audioBase64,
          mimeType: audioMimeType,
          fileName: attachment.fileName || "voice-note.webm",
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

  let transcript = "";
  let summary = "";
  const n8nRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(90_000),
  });
  const rawText = await n8nRes.text();
  if (!n8nRes.ok) {
    throw new Error(rawText || `n8n devolvió estado ${n8nRes.status}.`);
  }
  if (!rawText.trim()) {
    throw new Error("n8n devolvió una respuesta vacía al procesar el adjunto.");
  }

  const responseBody: unknown = JSON.parse(rawText);
  const result = readReply(responseBody);
  summary = getStringField(result, "reply", "output", "text");
  transcript = getStringField(result, "transcript");
  if (attachment.type === "audio" && !transcript) {
    transcript = summary;
    summary = "";
  }
  if (!summary && !transcript) {
    throw new Error("n8n respondió sin una transcripción o resumen válido.");
  }

  const sections: { markdown: string; html: string }[] = [];
  if (transcript) {
    sections.push(formatQuote("Transcripción IA", attachment.fileName, transcript));
  }
  if (summary) {
    sections.push(formatQuote("Resumen IA", attachment.fileName, summary));
  }
  const excerpt =
    attachment.type === "pdf"
      ? extractedText.slice(0, MAX_EXCERPT_CHARS)
      : "";
  let markdown = sections.map((section) => section.markdown).join("\n\n");
  let html = sections.map((section) => section.html).join("");
  if (excerpt) {
    markdown += `\n\n### Extracto del PDF\n\n${excerpt}`;
    const paragraphs = excerpt
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
    html += `<h3>Extracto del PDF</h3>${paragraphs.join("")}`;
  }
  return NextResponse.json({
    type: attachment.type,
    transcript: transcript || null,
    summary: summary || null,
    extractedText: excerpt || null,
    markdown,
    html,
  });
}

export async function POST(request: Request) {
  try {
    return await processAttachment(request);
  } catch (err: unknown) {
    console.error("[process-attachment]", err);
    const errorMessage =
      err instanceof Error
        ? err.message
        : isRecord(err) && typeof err.message === "string"
          ? err.message
          : "";
    return NextResponse.json(
      {
        error:
          errorMessage || String(err) || "Error interno desconocido",
      },
      { status: 500 }
    );
  }
}
