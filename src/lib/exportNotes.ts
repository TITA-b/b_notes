import JSZip from "jszip";
import type { Area, Note } from "@/types/note";

function sanitizeFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  const safeName = sanitized || "Nota";

  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safeName)
    ? `_${safeName}`
    : safeName;
}

function formatMarkdown(note: Note): string {
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `area: ${JSON.stringify(note.area)}`,
    `updated_at: ${JSON.stringify(note.updated_at)}`,
    "---",
  ].join("\n");
  const content = note.content
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]");

  return `${frontmatter}\n\n${content}\n`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadNoteAsMarkdown(note: Note): void {
  const blob = new Blob([formatMarkdown(note)], {
    type: "text/markdown;charset=utf-8",
  });
  downloadBlob(blob, `${sanitizeFileName(note.title)}.md`);
}

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function downloadAllNotesAsZip(
  notes: Note[],
  areas: Area[]
): Promise<void> {
  const areaNames = new Map(areas.map((area) => [area.slug, area.name]));
  const zip = new JSZip();
  const usedPaths = new Set<string>();

  for (const note of notes) {
    const areaName = areaNames.get(note.area) ?? note.area;
    const folder = sanitizeFileName(areaName || "Sin área");
    const baseName = sanitizeFileName(note.title);
    let fileName = `${folder}/${baseName}.md`;
    let duplicateIndex = 1;

    while (usedPaths.has(fileName.toLowerCase())) {
      const suffix =
        duplicateIndex === 1
          ? note.id.slice(0, 8)
          : `${note.id.slice(0, 8)}-${duplicateIndex}`;
      fileName = `${folder}/${baseName}-${suffix}.md`;
      duplicateIndex += 1;
    }

    usedPaths.add(fileName.toLowerCase());
    zip.file(fileName, formatMarkdown(note));
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  downloadBlob(blob, `B_Notes_Backup_${getLocalDate()}.zip`);
}
