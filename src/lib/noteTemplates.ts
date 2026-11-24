import type { NoteTemplate } from "@/types/note";

export type { NoteTemplate } from "@/types/note";

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "class-notes",
    name: "Apunte de clase",
    area_slug: null,
    default_title: "Apunte de clase",
    content:
      "## Materia\n\n## Fecha\n\n## Temas clave\n\n- \n\n## Notas de cursada\n\n## Checklist de repaso\n\n- [ ] ",
    position: 0,
    is_default: true,
  },
  {
    id: "project-brief",
    name: "Brief / Proyecto",
    area_slug: null,
    default_title: "Brief de proyecto",
    content:
      "## Objetivo\n\n## Entregables\n\n- \n\n## Referencias / Links\n\n- \n\n## Próximos pasos\n\n- [ ] ",
    position: 1,
    is_default: true,
  },
  {
    id: "quick-note",
    name: "Nota rápida / Idea",
    area_slug: null,
    default_title: "Nota rápida",
    content: "## Resumen\n\n\n## Conexiones\n\n- [[...]]",
    position: 2,
    is_default: true,
  },
];

export function getNoteTemplatesForArea(
  areaSlug: string,
  templates: NoteTemplate[] = NOTE_TEMPLATES
): NoteTemplate[] {
  return templates.filter(
    (template) => template.area_slug === null || template.area_slug === areaSlug
  );
}
