# B_Notes

Sistema personal de notas, tareas, grafos y asistente IA.

## Desarrollo local

Instalá las dependencias y ejecutá el servidor de desarrollo:

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000) para usar B_Notes.

## Configuración

Configurá las variables de entorno de Supabase, Google Calendar/Drive y el
webhook de n8n en `.env.local` antes de iniciar la aplicación. Habilitá Google
Drive API en el proyecto de Google Cloud; B_Notes solicita los scopes
`calendar.events` y `drive.file` al conectar Google.

Antes de usar adjuntos en tareas, aplicá
[`20261113110000_add_task_attachments.sql`](./supabase/migrations/20261113110000_add_task_attachments.sql)
en la base de Supabase para crear la columna JSONB `tasks.attachments`.

## Producción

Validá y compilá la aplicación con:

```bash
npm run build
```
