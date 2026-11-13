export interface NoteTemplate {
  id: string;
  name: string;
  title: string;
  content: string;
  areaSlugs?: string[];
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "class-notes",
    name: "Apunte de clase",
    title: "Apunte de clase",
    areaSlugs: ["facultad"],
    content:
      "## Materia\n\n## Fecha\n\n## Temas clave\n\n- \n\n## Notas de cursada\n\n## Checklist de repaso\n\n- [ ] ",
  },
  {
    id: "project-brief",
    name: "Brief / Proyecto",
    title: "Brief de proyecto",
    areaSlugs: ["trabajo", "proyectos"],
    content:
      "## Objetivo\n\n## Entregables\n\n- \n\n## Referencias / Links\n\n- \n\n## Próximos pasos\n\n- [ ] ",
  },
  {
    id: "quick-note",
    name: "Nota rápida / Idea",
    title: "Nota rápida",
    content: "## Resumen\n\n\n## Conexiones\n\n- [[...]]",
  },
  {
    id: "blank",
    name: "Nota en blanco",
    title: "Sin título",
    content: "",
  },
];

export function getNoteTemplatesForArea(areaSlug: string): NoteTemplate[] {
  const normalizedArea = areaSlug.toLowerCase();
  return NOTE_TEMPLATES.filter(
    (template) =>
      !template.areaSlugs || template.areaSlugs.includes(normalizedArea)
  );
}
