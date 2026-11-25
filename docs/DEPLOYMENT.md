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

## Configuración de Notificaciones Web Push (VAPID)

Las notificaciones requieren HTTPS en los dispositivos (localhost también es seguro para desarrollo).

1. Desde la raíz del proyecto, generá el par de claves VAPID. Guardá la salida de forma segura; no la compartas ni la agregues al repositorio.

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Completá estas variables en el archivo `.env`, reemplazando los marcadores por tus propios valores:

   ```dotenv
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<CLAVE_PUBLICA_GENERADA>
   VAPID_PRIVATE_KEY=<CLAVE_PRIVADA_GENERADA>
   VAPID_SUBJECT=mailto:tu-correo@dominio.com
   INTERNAL_PUSH_SECRET=<TOKEN_ALEATORIO_LARGO>
   ```

   `VAPID_PRIVATE_KEY` e `INTERNAL_PUSH_SECRET` son secretos: no los publiques ni los guardes en el workflow de n8n como texto visible. El asunto VAPID puede ser una dirección `mailto:` o una URL HTTPS. El cliente obtiene la clave pública desde `/api/push/config` en tiempo de ejecución; el contenedor recibe las variables desde Compose.

3. Reconstruí y recreá B_Notes para aplicar la configuración del `.env` al servicio:

   ```sh
   docker compose up -d --build b-notes
   ```

4. En Android, accedé a B_Notes mediante la URL HTTPS de Tailscale, instalá la PWA desde Chrome y activá **Notificaciones Push** desde la barra lateral. La misma sección permite enviar una notificación de prueba. En iOS/iPadOS, instalá primero la PWA desde Safari con **Compartir → Agregar a pantalla de inicio**.

5. Para enviar notificaciones desde n8n, agregá un nodo **HTTP Request** con método `POST` y URL `http://b-notes:3000/api/push/send`. Configurá el header `x-internal-secret` con el valor de `INTERNAL_PUSH_SECRET` almacenado en las credenciales de n8n y enviá un cuerpo JSON como el siguiente:

   ```json
   {
     "title": "B_Notes",
     "body": "Tenés tareas pendientes",
     "url": "/"
   }
   ```

   `url` debe ser una ruta dentro de la aplicación. El endpoint elimina automáticamente las suscripciones expiradas.

## Procesamiento IA de audio y PDF

Desde el editor de notas o la captura rápida, adjuntá un audio o PDF y elegí **Transcribir / Resumir con IA**. Los audios se procesan con Groq Whisper a través del workflow de n8n; los PDF se extraen en el servidor y, si n8n está configurado, también se resumen con IA. Los PDF escaneados sin texto seleccionable no tienen OCR. Para compartir archivos desde Android, usá **Compartir** y seleccioná B_Notes; la captura rápida permite procesarlos y guardar el resultado en una nota.

## Acceso móvil privado — Tailscale HTTPS

1. Instalá Tailscale en el servidor y en el teléfono/tablet, e iniciá sesión en el mismo tailnet.
2. En la consola de administración de Tailscale, habilitá MagicDNS y HTTPS Certificates.
3. En el servidor, publicá el puerto local de B_Notes en HTTPS privado:

   ```sh
   tailscale serve --bg 3000
   ```

4. Usá la URL HTTPS de Tailscale que corresponda a ese servidor. Para OAuth de Google, registrá además esa URL de callback y establecé el mismo valor en `GOOGLE_REDIRECT_URI`.

### Android — Chrome

Abrí la URL HTTPS en Chrome, iniciá sesión y elegí **Instalar aplicación** en el menú del navegador (o **Agregar a pantalla principal**, según la versión). Aceptá la instalación de la PWA. Para compartir audio o PDF desde Android, usá **Compartir** y seleccioná B_Notes; la captura rápida permite procesar el archivo y guardar el resultado en una nota.

### iOS / iPadOS — Safari

Abrí la URL HTTPS en Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**. Confirmá para instalar el acceso de B_Notes.

El acceso al micrófono desde el navegador requiere un contexto seguro, normalmente HTTPS (o `localhost`). Una URL HTTP de la red local puede dejar sin habilitar el micrófono. Si no querés configurar HTTPS, como alternativa manual podés usar **Atajos** para dictar texto, copiarlo y abrir la URL de B_Notes para pegarlo; ese atajo no conecta directamente con el micrófono de la PWA.

## Checklist de despliegue y primer backup

- [ ] Cloná el repositorio en el servidor o Mini PC y confirmá que estén `docker-compose.yml`, `Dockerfile` y `scripts/backup-bnotes.ps1` / `scripts/backup-bnotes.sh`.
- [ ] Instalá Docker Engine/Desktop y Compose v2; comprobá que el servidor tenga espacio persistente y que los puertos requeridos estén disponibles.
- [ ] Copiá `.env.example` a `.env`; definí `POSTGRES_PASSWORD` y `AUTH_SECRET` seguros. No agregues `.env` al repositorio.
- [ ] Si vas a usar IA o Google, configurá `N8N_WEBHOOK_URL`, credenciales de Groq, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y la URI OAuth del dominio elegido.
- [ ] Iniciá los servicios con `docker compose up -d` y revisá `docker compose ps`; PostgreSQL y B_Notes deben quedar saludables.
- [ ] Abrí B_Notes en `http://localhost:3000`, creá la cuenta local y verificá la creación de una nota y una tarea.
- [ ] Si necesitás acceso remoto, configurá Tailscale HTTPS, validá la URL desde otro dispositivo y registrá esa URL como callback OAuth si corresponde.
- [ ] Probá el workflow de n8n y las integraciones opcionales de Calendar/Drive antes de depender de ellas.
- [ ] Elegí un destino de backup protegido: Google Drive `Backups_B_Notes`, `BNOTES_BACKUP_DIR` o la carpeta local `backups/`.
- [ ] Ejecutá manualmente el script del sistema operativo y confirmá que genere tanto el dump PostgreSQL como el archivo del volumen `n8n_data`:
  - Windows: `.\scripts\backup-bnotes.ps1`
  - macOS/Linux: `./scripts/backup-bnotes.sh`
- [ ] Revisá que ambos archivos de la misma fecha existan, tengan tamaño mayor que cero y se puedan listar/descomprimir. Tratá los respaldos como datos privados.
- [ ] Programá la ejecución diaria con Task Scheduler (Windows) o `crontab` (macOS/Linux), usando el mismo usuario que tiene acceso a Docker y al destino.
- [ ] Ejecutá la tarea programada una vez y confirmá su resultado, fecha de los archivos y retención de respaldos antiguos.
- [ ] Antes de migrar a otra Mini PC, seguí el procedimiento de [restauración y migración](BACKUPS.md#restaurar-o-migrar-a-otro-equipo) y probalo en un entorno separado.
