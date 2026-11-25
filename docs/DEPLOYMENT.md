# Despliegue de B_Notes

## Requisitos compartidos

- Una copia del repositorio y Docker Compose v2.
- Los puertos `3000` (B_Notes) y `5678` (n8n) disponibles en el equipo servidor.
- Una copia de `.env.example` llamada `.env`. Definí un `POSTGRES_PASSWORD` seguro y un `AUTH_SECRET` aleatorio de al menos 32 caracteres antes de iniciar los servicios.

## Despliegue del servidor

### Windows — Docker Desktop

1. Instalá Docker Desktop y habilitá el backend WSL 2 si está disponible.
2. Cloná el repositorio y abrí PowerShell en la carpeta:

   ```powershell
   git clone https://github.com/TITA-b/b_notes.git
   Set-Location b_notes
   Copy-Item .env.example .env
   ```

3. Editá `.env` con un editor de texto y configurá `POSTGRES_PASSWORD` y `AUTH_SECRET`.
4. Iniciá el stack:

   ```powershell
   docker compose up -d
   docker compose ps
   ```

5. Abrí `http://localhost:3000` y creá una cuenta local. La interfaz de n8n queda en `http://localhost:5678`.

### macOS — Docker Desktop u OrbStack

1. Instalá Docker Desktop para Mac u OrbStack y asegurate de que el motor Docker esté iniciado.
2. En Terminal, cloná el repositorio, creá `.env` y editá sus secretos:

   ```sh
   git clone https://github.com/TITA-b/b_notes.git
   cd b_notes
   cp .env.example .env
   ```

3. Iniciá el stack y comprobá su estado:

   ```sh
   docker compose up -d
   docker compose ps
   ```

4. Abrí `http://localhost:3000`; n8n está disponible en `http://localhost:5678`.

### Linux / Mini PC

1. Instalá Docker Engine y el plugin Docker Compose v2 para tu distribución. Incorporá tu usuario al grupo `docker` solo si entendés que ese grupo otorga privilegios equivalentes a root; alternativamente, anteponé `sudo` a los comandos Docker.
2. Cloná el repositorio y prepará los valores secretos:

   ```sh
   git clone https://github.com/TITA-b/b_notes.git
   cd b_notes
   cp .env.example .env
   ```

3. Editá `.env`, iniciá los servicios y revisá su estado:

   ```sh
   docker compose up -d
   docker compose ps
   ```

4. Accedé desde la red local con `http://IP_DE_LA_MINI_PC:3000`. Restringí el acceso al servidor con el firewall; para acceso remoto, preferí Tailscale HTTPS en lugar de publicar los puertos directamente en Internet.

En las tres plataformas, Compose conserva PostgreSQL y n8n en volúmenes nombrados. Los datos no están dentro del contenedor de la aplicación. Para actualizar o ver logs, usá `docker compose pull`, `docker compose up -d` y `docker compose logs -f b-notes`.

## Configuración de IA — n8n + Groq

1. Abrí `http://localhost:5678` (o la URL del servidor) y creá el usuario administrador local de n8n.
2. En n8n, elegí **Import from File** y seleccioná `n8n/b-notes-assistant.json` del repositorio.
3. Creá una credencial **Header Auth**:
   - **Name:** `Authorization`
   - **Value:** `Bearer TU_API_KEY_DE_GROQ`
4. Asigná la credencial a los nodos **Groq LLM** y **Groq Whisper**.
5. Publicá/activá el workflow y verificá que la URL del webhook coincida con `N8N_WEBHOOK_URL` en `.env` (por defecto, `http://n8n:5678/webhook/b-notes-assistant`).

## Google Calendar y Drive — OAuth 2.0

La integración es opcional. En [Google Cloud Console](https://console.cloud.google.com/):

1. Creá o elegí un proyecto y habilitá **Google Calendar API** y **Google Drive API**.
2. Configurá la pantalla de consentimiento y creá un ID de cliente OAuth de tipo **Aplicación web**.
3. Agregá como **URI de redireccionamiento autorizada** la URI exacta que usará B_Notes:
   - Local: `http://localhost:3000/api/google/callback`
   - Tailscale HTTPS: `https://NOMBRE-EQUIPO.NOMBRE-TAILNET.ts.net/api/google/callback`
4. Configurá `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` en `.env`. `GOOGLE_REDIRECT_URI` debe ser idéntica a la URI registrada, incluyendo esquema, host y ruta. Para cambiar el dominio, usá también ese mismo dominio en el navegador.
5. Aplicá la configuración recreando el servicio: `docker compose up -d --force-recreate b-notes`.

B_Notes solicita los scopes `https://www.googleapis.com/auth/calendar.events` y `https://www.googleapis.com/auth/drive.file`. El segundo limita el acceso de Drive a archivos creados o abiertos por la aplicación.

## Acceso móvil privado — Tailscale HTTPS

1. Instalá Tailscale en el servidor y en el teléfono/tablet, e iniciá sesión en el mismo tailnet.
2. En la consola de administración de Tailscale, habilitá MagicDNS y HTTPS Certificates.
3. En el servidor, publicá el puerto local de B_Notes en HTTPS privado:

   ```sh
   tailscale serve --bg 3000
   ```

4. Usá la URL HTTPS de Tailscale que corresponda a ese servidor. Para OAuth de Google, registrá además esa URL de callback y establecé el mismo valor en `GOOGLE_REDIRECT_URI`.

### Android — Chrome

Abrí la URL HTTPS en Chrome, iniciá sesión y elegí **Instalar aplicación** en el menú del navegador (o **Agregar a pantalla principal**, según la versión). Aceptá la instalación de la PWA.

### iOS / iPadOS — Safari

Abrí la URL HTTPS en Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**. Confirmá para instalar el acceso de B_Notes.

El acceso al micrófono desde el navegador requiere un contexto seguro, normalmente HTTPS (o `localhost`). Una URL HTTP de la red local puede dejar sin habilitar el micrófono. Si no querés configurar HTTPS, como alternativa manual podés usar **Atajos** para dictar texto, copiarlo y abrir la URL de B_Notes para pegarlo; ese atajo no conecta directamente con el micrófono de la PWA.
