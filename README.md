# B_Notes

**B_Notes** es un espacio personal *local-first* para notas, tareas y conocimiento, con asistente de IA, voz y sincronización opcional con Google Calendar y Drive. El acceso remoto puede mantenerse privado con Tailscale.

## Arquitectura

| Servicio | Función | Puerto |
| --- | --- | --- |
| `b-notes` | Aplicación web y API (Next.js) | `3000` |
| `postgres` | PostgreSQL 16; datos persistidos en `postgres_data` | Interno |
| `n8n` | Automatizaciones y asistente de IA; datos en `n8n_data` | `5678` |
| `watchtower` | Actualiza la imagen de B_Notes desde GHCR | Interno |

## Inicio rápido

Requisitos: Git y Docker Compose v2 (Docker Desktop en Windows/macOS o Docker Engine en Linux).

1. Cloná el proyecto:

   ```sh
   git clone https://github.com/TITA-b/b_notes.git
   cd b_notes
   ```

2. Creá el archivo de configuración:

   ```sh
   cp .env.example .env
   ```

   En PowerShell, usá `Copy-Item .env.example .env`.

3. Editá `.env`: reemplazá `POSTGRES_PASSWORD` y `AUTH_SECRET` por valores aleatorios seguros. Las credenciales de Google son opcionales.
4. Iniciá los servicios:

   ```sh
   docker compose up -d
   ```

Abrí `http://localhost:3000` y creá tu cuenta local. Para publicar la aplicación en una Mini PC, conectar servicios externos o instalarla en el móvil, consultá la [guía de despliegue](docs/DEPLOYMENT.md). Para programar respaldos y migrar datos, seguí la [guía de backups](docs/BACKUPS.md).

## Variables de entorno

| Variable | Uso | Valor inicial / requisito |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL y conexión interna de la app | Obligatoria; reemplazar en `.env` |
| `AUTH_SECRET` | Firma de sesiones | Obligatoria; secreto aleatorio de al menos 32 caracteres |
| `N8N_WEBHOOK_URL` | Webhook del asistente | Opcional; `http://n8n:5678/webhook/b-notes-assistant` |
| `GOOGLE_CLIENT_ID` | Cliente OAuth de Google | Opcional |
| `GOOGLE_CLIENT_SECRET` | Secreto OAuth de Google | Opcional |
| `GOOGLE_REDIRECT_URI` | URI de retorno OAuth | `http://localhost:3000/api/google/callback`; cambiar al usar un dominio HTTPS |
| `BNOTES_BACKUP_DIR` | Carpeta destino de `backup-bnotes.ps1` / `backup-bnotes.sh` | Opcional; se detecta Google Drive en el script de Windows/macOS; si no, `./backups` |
| `DATABASE_URL` | Conexión para desarrollo local | Compose la construye a partir de `POSTGRES_PASSWORD`; `.env.example` la muestra como referencia |

## Documentación

- [Despliegue por sistema operativo, IA, Google y acceso móvil](docs/DEPLOYMENT.md)
- [Backups automáticos y restauración/migración](docs/BACKUPS.md)
