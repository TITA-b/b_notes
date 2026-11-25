import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthenticatedDrive,
  getAuthenticatedDriveWithOAuthClient,
} from "@/lib/google";
import {
  DRIVE_UPLOAD_SIZE_ERROR,
  MAX_DRIVE_UPLOAD_SIZE,
} from "@/lib/driveUpload";

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
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

async function throwGoogleUploadError(response: Response): Promise<never> {
  const responseBody = await response.text();
  let message = responseBody || `Google Drive respondió ${response.status}.`;
  let reasons: Array<{ reason?: string }> = [];

  if (responseBody) {
    try {
      const parsed: unknown = JSON.parse(responseBody);
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        const apiError = parsed.error;
        if (typeof apiError === "object" && apiError !== null) {
          if ("message" in apiError && typeof apiError.message === "string") {
            message = apiError.message;
          }
          if ("errors" in apiError && Array.isArray(apiError.errors)) {
            reasons = apiError.errors.filter(
              (item): item is { reason?: string } =>
                typeof item === "object" &&
                item !== null &&
                (!("reason" in item) || typeof item.reason === "string")
            );
          }
        }
      }
    } catch {
      // Keep the response body as the error message when it isn't JSON.
    }
  }

  const error = new Error(message) as GoogleApiError;
  error.code = response.status;
  error.response = {
    status: response.status,
    data: { error: { message, errors: reasons } },
  };
  throw error;
}

async function uploadFileResumable(
  oauthClient: NonNullable<
    Awaited<ReturnType<typeof getAuthenticatedDriveWithOAuthClient>>
  >["oauthClient"],
  body: ReadableStream<Uint8Array> | null,
  fileName: string,
  fileSize: number,
  folderId: string,
  mimeType: string
) {
  const { token } = await oauthClient.getAccessToken();
  if (!token) {
    throw new Error("No se pudo obtener acceso a Google Drive.");
  }

  const uploadUrl = new URL(
    "https://www.googleapis.com/upload/drive/v3/files"
  );
  uploadUrl.searchParams.set("uploadType", "resumable");
  uploadUrl.searchParams.set(
    "fields",
    "id,name,mimeType,webViewLink,thumbnailLink"
  );

  const sessionResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(fileSize),
    },
    body: JSON.stringify({
      name: fileName,
      mimeType,
      parents: [folderId],
    }),
  });
  if (!sessionResponse.ok) {
    await throwGoogleUploadError(sessionResponse);
  }

  const sessionUrl = sessionResponse.headers.get("location");
  if (!sessionUrl) {
    throw new Error("Google Drive no devolvió la URL de subida resumible.");
  }

  let uploadedBytes = 0;
  for await (const chunk of readUploadChunks(body, fileSize)) {
    const end = uploadedBytes + chunk.byteLength - 1;
    const chunkResponse = await fetch(sessionUrl, {
      method: "PUT",
      redirect: "manual",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Range":
          fileSize === 0
            ? "bytes */0"
            : `bytes ${uploadedBytes}-${end}/${fileSize}`,
        "Content-Type": mimeType,
      },
      body: chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ),
    });

    if (chunkResponse.status === 308 && end < fileSize - 1) {
      uploadedBytes += chunk.byteLength;
      continue;
    }
    if (!chunkResponse.ok) {
      await throwGoogleUploadError(chunkResponse);
    }

    const uploadedFile: unknown = await chunkResponse.json();
    if (
      typeof uploadedFile !== "object" ||
      uploadedFile === null ||
      !("id" in uploadedFile) ||
      typeof uploadedFile.id !== "string"
    ) {
      throw new Error("Google Drive no devolvió el identificador del archivo.");
    }
    return uploadedFile as {
      id: string;
      name?: string | null;
      mimeType?: string | null;
      webViewLink?: string | null;
      thumbnailLink?: string | null;
    };
  }

  throw new Error("La subida a Google Drive terminó sin respuesta final.");
}

async function* readUploadChunks(
  body: ReadableStream<Uint8Array> | null,
  expectedSize: number
) {
  if (!body) {
    if (expectedSize !== 0) {
      throw new Error("Falta el contenido del archivo.");
    }
    yield new Uint8Array();
    return;
  }

  const reader = body.getReader();
  let parts: Uint8Array[] = [];
  let pendingSize = 0;
  let receivedSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedSize += value.byteLength;
      if (receivedSize > expectedSize) {
        throw new Error("El tamaño recibido no coincide con el del archivo.");
      }

      let offset = 0;
      while (offset < value.byteLength) {
        const partSize = Math.min(
          UPLOAD_CHUNK_SIZE - pendingSize,
          value.byteLength - offset
        );
        parts.push(value.subarray(offset, offset + partSize));
        pendingSize += partSize;
        offset += partSize;

        if (pendingSize === UPLOAD_CHUNK_SIZE) {
          yield combineUploadParts(parts, pendingSize);
          parts = [];
          pendingSize = 0;
        }
      }
    }

    if (receivedSize !== expectedSize) {
      throw new Error("El tamaño recibido no coincide con el del archivo.");
    }
    if (pendingSize > 0 || expectedSize === 0) {
      yield combineUploadParts(parts, pendingSize);
    }
  } finally {
    reader.releaseLock();
  }
}

function combineUploadParts(parts: Uint8Array[], size: number) {
  const chunk = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    chunk.set(part, offset);
    offset += part.byteLength;
  }
  return chunk;
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
  let authenticated: Awaited<
    ReturnType<typeof getAuthenticatedDriveWithOAuthClient>
  >;
  try {
    authenticated = await getAuthenticatedDriveWithOAuthClient();
  } catch (error: unknown) {
    return googleErrorResponse(error, "autenticando");
  }
  if (!authenticated) {
    return NextResponse.json(
      {
        error: "Conectá Google para subir archivos a Drive.",
        requiresReauth: true,
      },
      { status: 401 }
    );
  }
  const { drive, oauthClient } = authenticated;
  if (!drive) {
    return NextResponse.json(
      {
        error: "Conectá Google para subir archivos a Drive.",
        requiresReauth: true,
      },
      { status: 401 }
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  const fileSizeHeader = request.headers.get("x-upload-file-size");
  const fileSize = Number(fileSizeHeader);
  const encodedFileName = request.headers.get("x-upload-file-name");
  if (
    (contentLengthHeader && Number.isFinite(contentLength) &&
      contentLength > MAX_DRIVE_UPLOAD_SIZE) ||
    !fileSizeHeader ||
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    fileSize > MAX_DRIVE_UPLOAD_SIZE
  ) {
    return NextResponse.json(
      { error: DRIVE_UPLOAD_SIZE_ERROR },
      { status: 413 }
    );
  }
  if (contentLengthHeader && contentLength !== fileSize) {
    return NextResponse.json(
      { error: "El tamaño declarado no coincide con el del archivo." },
      { status: 400 }
    );
  }
  if (!encodedFileName) {
    return NextResponse.json(
      { error: "Falta el nombre del archivo." },
      { status: 400 }
    );
  }
  let fileName: string;
  try {
    fileName = decodeURIComponent(encodedFileName);
  } catch {
    return NextResponse.json(
      { error: "El nombre del archivo no es válido." },
      { status: 400 }
    );
  }
  if (!fileName) {
    return NextResponse.json(
      { error: "El nombre del archivo no es válido." },
      { status: 400 }
    );
  }

  try {
    const folderId = await findOrCreateUploadFolder(drive);
    const mimeType =
      request.headers.get("content-type") || "application/octet-stream";
    const created = await uploadFileResumable(
      oauthClient,
      request.body,
      fileName,
      fileSize,
      folderId,
      mimeType
    );

    try {
      await drive.permissions.create({
        fileId: created.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
    } catch (error: unknown) {
      try {
        await drive.files.delete({ fileId: created.id });
      } catch (cleanupError: unknown) {
        const cleanupDetails = getErrorDetails(cleanupError);
        console.error(
          "No se pudo limpiar el archivo cuya publicación falló en Drive:",
          cleanupDetails.message
        );
      }
      throw error;
    }

    const uploadedMimeType = created.mimeType ?? mimeType;
    return NextResponse.json({
      ok: true,
      file: {
        id: created.id,
        name: created.name ?? fileName,
        mimeType: uploadedMimeType,
        webViewLink:
          created.webViewLink ??
          `https://drive.google.com/file/d/${created.id}/view`,
        isVideo: uploadedMimeType.startsWith("video/"),
        thumbnailUrl: `/api/google/drive/file/${encodeURIComponent(created.id)}`,
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
