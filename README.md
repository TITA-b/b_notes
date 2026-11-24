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

Para ejecutar con `npm run dev`, configurá PostgreSQL y las variables de
entorno en `.env.local`:

```dotenv
DATABASE_URL=postgresql://bnotes:bnotes_secret@localhost:5432/bnotes
AUTH_SECRET=una-clave-aleatoria-de-al-menos-32-caracteres
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
N8N_WEBHOOK_URL=...
```

B_Notes crea las tablas locales automáticamente al conectarse por primera vez.
La cuenta se crea desde la pantalla de inicio de sesión con **Crear cuenta
local**. Los registros de una instancia anterior de Supabase no se importan
automáticamente. Habilitá Google Drive API en el proyecto de Google Cloud;
B_Notes solicita los scopes `calendar.events` y `drive.file` al conectar Google.

## Instalación con Docker Compose

Se necesita Docker con Docker Compose v2 y conexión a Internet para descargar la
imagen inicial y permitir que Watchtower busque actualizaciones. Después de la
primera publicación, hacé público el paquete `b_notes` en GitHub Packages para
que cualquier equipo pueda descargarlo sin autenticación.

En una carpeta nueva, descargá únicamente estos dos archivos:

```bash
curl -LO https://raw.githubusercontent.com/TITA-b/b_notes/main/docker-compose.yml
curl -LO https://raw.githubusercontent.com/TITA-b/b_notes/main/.env.example
cp .env.example .env
```

En Windows PowerShell, el último comando puede ser `Copy-Item .env.example .env`.
Editá `.env`: reemplazá `POSTGRES_PASSWORD` por una contraseña larga
alfanumérica y `AUTH_SECRET` por una clave aleatoria de al menos 32 caracteres.
Las credenciales de Google son opcionales; completalas si vas a usar Calendar o
Drive. El webhook de n8n tiene un valor por defecto, pero necesitás crear en n8n
un workflow con el webhook `b-notes-assistant`.

Iniciá el stack:

```bash
docker compose up -d
```

B_Notes queda disponible en `http://localhost:3000` y n8n en
`http://localhost:5678`. PostgreSQL y n8n conservan sus datos en los volúmenes
`postgres_data` y `n8n_data`; actualizar o recrear el contenedor de B_Notes no
los elimina. Para revisar el estado, ejecutá `docker compose ps` o
`docker compose logs -f b-notes`.

Cada `git push` a `main` ejecuta
[`docker-publish.yml`](./.github/workflows/docker-publish.yml), que construye y
publica `ghcr.io/tita-b/b_notes:latest`. Watchtower consulta GHCR cada cinco
minutos y actualiza únicamente el contenedor de B_Notes; no modifica los
volúmenes de datos. También podés lanzar la publicación manualmente desde
GitHub Actions con `workflow_dispatch`.

Si clonaste el repositorio y querés construir la imagen en ese equipo en lugar
de descargarla de GHCR, ejecutá `docker compose up -d --build`.

## Producción

Validá y compilá la aplicación con:

```bash
npm run build
```
