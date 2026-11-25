export const MAX_DRIVE_UPLOAD_SIZE = 250 * 1024 * 1024;
export const DRIVE_UPLOAD_SIZE_ERROR = "El archivo supera el límite de 250 MB.";

export function validateDriveUploadSize(file: Pick<File, "size">) {
  if (file.size > MAX_DRIVE_UPLOAD_SIZE) {
    throw new Error(DRIVE_UPLOAD_SIZE_ERROR);
  }
}

export function getDriveUploadHeaders(file: File) {
  return {
    "Content-Type": file.type || "application/octet-stream",
    "X-Upload-File-Name": encodeURIComponent(file.name),
    "X-Upload-File-Size": String(file.size),
  };
}
