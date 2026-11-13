const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "lh3.googleusercontent.com",
]);

export function extractDriveFileId(urlOrId: string): string | null {
  const value = urlOrId.trim();
  if (!value) return null;

  const internalPathMatch = value.match(
    /(?:^|\/)api\/google\/drive\/file\/([^/?#]+)/
  );
  if (internalPathMatch) {
    try {
      return decodeURIComponent(internalPathMatch[1]);
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase();
    if (DRIVE_HOSTS.has(hostname)) {
      const queryId = url.searchParams.get("id");
      if (queryId) return queryId;

      const pathMatch = url.pathname.match(/\/(?:file\/d|document\/d|d)\/([^/]+)/);
      if (pathMatch) {
        return decodeURIComponent(pathMatch[1]).split("=")[0];
      }
    }
  } catch {
    if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  }

  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function getDriveViewUrl(urlOrId: string): string {
  const fileId = extractDriveFileId(urlOrId);
  return fileId
    ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
    : urlOrId;
}

export function getDriveImagePreviewUrl(urlOrId: string): string {
  const fileId = extractDriveFileId(urlOrId);
  return fileId
    ? `/api/google/drive/file/${encodeURIComponent(fileId)}`
    : urlOrId;
}

export function getDriveVideoEmbedUrl(urlOrId: string): string {
  const fileId = extractDriveFileId(urlOrId);
  return fileId
    ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
    : urlOrId;
}
