import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedDrive } from "@/lib/google";

interface GoogleDriveError extends Error {
  code?: number;
  response?: { status?: number };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  if (!fileId) {
    return NextResponse.json({ error: "Falta el identificador del archivo." }, { status: 400 });
  }

  try {
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
    const content = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(content.data as ArrayBuffer);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": metadata.data.mimeType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    const googleError =
      error instanceof Error ? (error as GoogleDriveError) : null;
    const status =
      googleError?.response?.status ??
      googleError?.code ??
      500;
    console.error(
      "Error obteniendo archivo de Google Drive:",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { error: "No se pudo obtener el archivo de Google Drive." },
      {
        status:
          status === 401 || status === 403 || status === 404 ? status : 500,
      }
    );
  }
}
