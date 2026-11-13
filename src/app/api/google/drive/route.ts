import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedDrive } from "@/lib/google";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const UPLOAD_FOLDER_NAME = "B_Notes_Uploads";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

interface GoogleApiError extends Error {
  code?: number;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
  };
}

function getErrorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { status: undefined, message: String(error), reason: "" };
  }

  const googleError = error as GoogleApiError;
  const apiError = googleError.response?.data?.error;
  return {
    status: googleError.response?.status ?? googleError.code,
    message: apiError?.message ?? error.message,
    reason: apiError?.errors?.map((item) => item.reason ?? "").join(" ") ?? "",
  };
}

function isMissingDriveScope(message: string, reason: string) {
  return /insufficient.*(scope|permission)|scope.*insufficient/i.test(
    `${message} ${reason}`
  );
}

function googleErrorResponse(error: unknown, operation: string) {
  const { status, message, reason } = getErrorDetails(error);
  if (status === 401 || isMissingDriveScope(message, reason)) {
    return NextResponse.json(
      {
        error: "Reconectá Google para habilitar el acceso a Drive.",
        requiresReauth: true,
      },
      { status: status === 401 ? 401 : 403 }
    );
  }

  console.error(`Error ${operation} en Google Drive:`, message);
  return NextResponse.json(
    { error: message || `No se pudo completar la operación en Google Drive.` },
    { status: status === 403 ? 403 : 500 }
  );
}

async function findOrCreateUploadFolder(
  drive: NonNullable<Awaited<ReturnType<typeof getAuthenticatedDrive>>>
) {
  const result = await drive.files.list({
    q: `name = '${UPLOAD_FOLDER_NAME}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    pageSize: 1,
    fields: "files(id)",
  });
  const folderId = result.data.files?.[0]?.id;
  if (folderId) return folderId;

  const created = await drive.files.create({
    requestBody: {
      name: UPLOAD_FOLDER_NAME,
      mimeType: FOLDER_MIME_TYPE,
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error("Google Drive no devolvió el identificador de la carpeta.");
  }
  return created.data.id;
}

export async function POST(request: Request) {
  let drive: Awaited<ReturnType<typeof getAuthenticatedDrive>>;
  try {
    drive = await getAuthenticatedDrive();
  } catch (error: unknown) {
    return googleErrorResponse(error, "autenticando");
  }
  if (!drive) {
    return NextResponse.json(
      {
        error: "Conectá Google para subir archivos a Drive.",
        requiresReauth: true,
      },
      { status: 401 }
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FILE_SIZE + 128 * 1024
  ) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 25 MB." },
      { status: 413 }
    );
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data;")
  ) {
    return NextResponse.json(
      { error: "El cuerpo debe ser multipart/form-data." },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo debe ser multipart/form-data." },
      { status: 400 }
    );
  }
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Falta el archivo en el campo «file»." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "El archivo supera el límite de 25 MB." },
      { status: 413 }
    );
  }

  try {
    const folderId = await findOrCreateUploadFolder(drive);
    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());
    const created = await drive.files.create({
      requestBody: {
        name: file.name,
        mimeType,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: Readable.from([buffer]),
      },
      fields: "id,name,mimeType,webViewLink,thumbnailLink",
    });

    if (!created.data.id) {
      throw new Error("Google Drive no devolvió el identificador del archivo.");
    }

    try {
      await drive.permissions.create({
        fileId: created.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (error: unknown) {
      try {
        await drive.files.delete({ fileId: created.data.id });
      } catch (cleanupError: unknown) {
        const cleanupDetails = getErrorDetails(cleanupError);
        console.error(
          "No se pudo limpiar el archivo cuya publicación falló en Drive:",
          cleanupDetails.message
        );
      }
      throw error;
    }

    const uploadedMimeType = created.data.mimeType ?? mimeType;
    return NextResponse.json({
      ok: true,
      file: {
        id: created.data.id,
        name: created.data.name ?? file.name,
        mimeType: uploadedMimeType,
        webViewLink:
          created.data.webViewLink ??
          `https://drive.google.com/file/d/${created.data.id}/view`,
        isVideo: uploadedMimeType.startsWith("video/"),
        thumbnailUrl: `/api/google/drive/file/${encodeURIComponent(created.data.id)}`,
      },
    });
  } catch (error: unknown) {
    return googleErrorResponse(error, "subiendo archivo");
  }
}

export async function DELETE(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json(
      { error: "Falta el parámetro fileId." },
      { status: 400 }
    );
  }

  try {
    const drive = await getAuthenticatedDrive();
    if (!drive) {
      return NextResponse.json(
        {
          error: "Conectá Google para administrar archivos de Drive.",
          requiresReauth: true,
        },
        { status: 401 }
      );
    }

    await drive.files.delete({ fileId });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return googleErrorResponse(error, "eliminando archivo");
  }
}
