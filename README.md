# B_Notes

Sistema personal *local-first* de notas, tareas, grafo de conocimiento y asistente IA con soporte de voz, sincronización con Google Calendar/Drive y acceso móvil privado.

## Arquitectura del Stack

* **Frontend & API (`b-notes`):** Next.js (Standalone) en el puerto `3000`.
* **Base de datos (`postgres`):** PostgreSQL 16 con volumen persistente (`postgres_data`).
* **Automatización e IA (`n8n`):** Motor de flujos en el puerto `5678` con volumen persistente (`n8n_data`).
* **Actualizaciones (`watchtower`):** Vigila GitHub Container Registry (`ghcr.io`) cada 5 minutos y actualiza únicamente el contenedor de B_Notes sin tocar los volúmenes de datos.

---

## 1. Instalación rápida con Docker Compose (Recomendada)

Ideal para desplegar en tu PC principal o migrar a una Mini PC sin instalar Node.js ni dependencias en el sistema anfitrión.

### Requisitos previos

* **Docker Desktop** (Windows/macOS) o **Docker Engine + Docker Compose v2** (Linux).
* Conexión a Internet para descargar las imágenes iniciales.

### Paso a paso

1. **Creá una carpeta para la aplicación y descargá los archivos base:**

   ```bash
   mkdir b-notes && cd b-notes
   curl -LO https://raw.githubusercontent.com/TITA-b/b_notes/main/docker-compose.yml
   curl -LO https://raw.githubusercontent.com/TITA-b/b_notes/main/.env.example
   curl -L --create-dirs -o n8n/b-notes-assistant.json https://raw.githubusercontent.com/TITA-b/b_notes/main/n8n/b-notes-assistant.json
   ```

2. **Creá el archivo `.env` a partir de la plantilla:**

   - **Linux / macOS:**

     ```bash
     cp .env.example .env
     ```

   - **Windows (PowerShell):**

     ```powershell
     Copy-Item .env.example .env
     ```

3. **Editá `.env` con tus claves:**

   - `POSTGRES_PASSWORD`: contraseña segura para PostgreSQL (reemplazá por una clave aleatoria).
   - `AUTH_SECRET`: clave aleatoria de al menos 32 caracteres para firmar las sesiones.
   - `N8N_WEBHOOK_URL`: dejar por defecto (`http://n8n:5678/webhook/b-notes-assistant`).
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`: *(Opcional)* necesarios solo si vas a sincronizar Google Calendar y Google Drive.

4. **Levantá todos los servicios:**

   ```bash
   docker compose up -d
   ```

5. **Creá tu cuenta local:**

   - Abrí `http://localhost:3000` (no uses `0.0.0.0:3000`).
   - Seleccioná **Crear cuenta local**, registrá tu usuario y contraseña. Las tablas y áreas iniciales (`Facultad`, `Trabajo`, `Proyectos`, `Hobbies`) se crean automáticamente.

> **Nota para administradores del repositorio:** Si el repositorio es privado, recordá mantener el paquete `b_notes` en visibilidad **Public** dentro de *GitHub Packages* para que Watchtower y otros equipos descarguen la imagen sin autenticación.

## 2. Configuración del Asistente IA (n8n + Groq)

1. Abrí `http://localhost:5678` y creá tu usuario administrador local de n8n.
2. Creá un workflow nuevo → menú superior derecho **`⋮`** → **Import from File** → seleccioná `n8n/b-notes-assistant.json`.
3. Creá una credencial de tipo **Header Auth** con los siguientes datos:

   - **Name:** `Authorization`
   - **Value:** `Bearer TU_API_KEY_DE_GROQ`

4. Asigná esa credencial en los nodos **Groq LLM** y **Groq Whisper**.
5. Activá el interruptor **Published / Active** en la esquina superior derecha del flujo.

## 3. Integración con Google Calendar y Drive (Opcional)

1. En [Google Cloud Console](https://console.cloud.google.com/), habilitá **Google Calendar API** y **Google Drive API**.
2. Creá credenciales OAuth 2.0 (Aplicación web) y agregá en **URIs de redireccionamiento autorizados**:

   - `http://localhost:3000/api/google/callback`
   - *(Si usás Tailscale HTTPS en móvil)* `[https://TU-EQUIPO.tailXXXX.ts.net/api/google/callback](https://TU-EQUIPO.tailXXXX.ts.net/api/google/callback)`

3. Cargá `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en tu `.env` y recreá el contenedor:

   ```bash
   docker compose up -d b-notes
   ```

4. En B_Notes, entrá a **Tareas y Agenda** → **Conectar Google Calendar**. Los scopes solicitados son `calendar.events` y `drive.file`.

## 4. Acceso remoto e instalación móvil (Tailscale PWA)

Para usar B_Notes desde el celular fuera de tu red local (con micrófono habilitado y menú *Compartir* de Android):

1. Instalá **Tailscale** en el servidor/PC y en tu teléfono iniciando sesión con la misma cuenta.
2. En el panel DNS de Tailscale, activá **MagicDNS** y **HTTPS Certificates**.
3. En la terminal de tu PC/servidor, exponé el puerto `3000` por HTTPS privado:

   ```bash
   tailscale serve --bg 3000
   ```

4. Abrí la URL generada (`[https://TU-EQUIPO.tailXXXX.ts.net](https://TU-EQUIPO.tailXXXX.ts.net)`) en Chrome de Android, iniciá sesión y tocá **`⋮` → Instalar aplicación**.

## 5. Respaldos automáticos y restauración

### Backup diario en Windows (`backup-bnotes.ps1`)

El script `backup-bnotes.ps1` genera un dump comprimido de PostgreSQL (usuario `bnotes`) y un archivo `.tar.gz` del volumen `n8n_data`, guardándolos en `$env:BNOTES_BACKUP_DIR` (o automáticamente en Google Drive `G:\` / `.\backups`) con retención de 14 días.

- **Ejecución manual:**

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\backup-bnotes.ps1
  ```

- **Tarea programada:** `Backup_B_Notes_GoogleDrive` corre automáticamente todos los días a las `23:00`.

### Restaurar en otro equipo (Migración a Mini PC)

1. Copiá tu `.env`, `docker-compose.yml` y el último respaldo (`.sql.zip` y `.tar.gz`) al nuevo equipo.
2. Levantá el stack y detené temporalmente la app:

   ```bash
   docker compose up -d
   docker compose stop b-notes
   ```
3. Extraé el archivo `.sql` del ZIP e importalo en PostgreSQL:

   ```bash
   docker compose exec -T postgres psql -U bnotes -d bnotes < bnotes_postgres_FECHA.sql
   ```

4. *(Opcional)* Restaurá el volumen de n8n:

   ```bash
   docker compose stop n8n
   docker run --rm -v b-notes_n8n_data:/data -v "${PWD}:/backup" alpine sh -c "rm -rf /data/* && tar xzf /backup/n8n_data_FECHA.tar.gz -C /data"
   docker compose start n8n b-notes
   ```

## 6. Comandos útiles de mantenimiento

- **Ver estado de los contenedores:**

  ```bash
  docker compose ps
  ```

- **Ver logs en tiempo real:**

  ```bash
  docker compose logs -f b-notes
  ```

- **Construir imagen localmente (sin descargar de GHCR):**

  ```bash
  docker compose up -d --build
  ```

- **Desarrollo local (sin Docker):**

  ```bash
  npm install
  npm run dev   # Requiere .env.local con DATABASE_URL apuntando a PostgreSQL local
  npm run build # Validación de compilación para producción
  ```
