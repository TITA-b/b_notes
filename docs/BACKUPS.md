# Backups y restauración

Los respaldos protegen la base PostgreSQL y el volumen de n8n, que contienen datos distintos. Guardá copias fuera del equipo servidor y verificá periódicamente que se puedan leer. Los archivos de backup contienen datos privados; protegé la carpeta y la cuenta de Google Drive.

## Windows — `scripts/backup-bnotes.ps1` + Task Scheduler

El script `scripts/backup-bnotes.ps1` genera un dump SQL comprimido como ZIP (`bnotes_FECHA.sql.zip`) y un archivo `n8n_FECHA.tar.gz`. Guarda los archivos en `BNOTES_BACKUP_DIR` si la variable está definida; en caso contrario detecta la carpeta de Google Drive (`G:\My Drive\Backups_B_Notes` o `G:\Mi unidad\Backups_B_Notes`) y cae en `backups/` en la raíz del proyecto. Conserva 14 días.

1. Iniciá Docker Desktop y comprobá que B_Notes esté funcionando.
2. En PowerShell, desde la raíz del proyecto, probá el backup manualmente:

   ```powershell
   .\scripts\backup-bnotes.ps1
   ```

   Si la política local bloquea el script, podés ejecutarlo para esa invocación con:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\backup-bnotes.ps1
   ```

3. Abrí **Task Scheduler** → **Create Task**. En **Triggers**, agregá un horario diario (por ejemplo, 23:00). En **Actions**, elegí **Start a program**:
   - **Program/script:** `powershell.exe`
   - **Arguments:** `-NoProfile -ExecutionPolicy Bypass -File "C:\ruta\b_notes\scripts\backup-bnotes.ps1"`
   - **Start in:** `C:\ruta\b_notes`
4. En **General**, elegí una cuenta que pueda acceder a Docker Desktop y al destino de backup. Hacé clic derecho en la tarea y elegí **Run** para probarla; revisá los archivos de salida y el historial de la tarea.

Si ya existe la tarea `Backup_B_Notes_GoogleDrive`, actualizá la ruta de **Program/script** a `C:\ruta\b_notes\scripts\backup-bnotes.ps1`. El script resuelve la raíz del repositorio desde su propia ubicación, así que **Start in** puede seguir apuntando a la raíz del proyecto.

Para cambiar la carpeta destino, definí `BNOTES_BACKUP_DIR` en las variables de entorno de Windows para la cuenta que ejecuta la tarea. No la guardes en un archivo versionado.

## macOS / Linux — `scripts/backup-bnotes.sh` + crontab

El script genera `bnotes_postgres_FECHA.sql.gz` y `n8n_data_FECHA.tar.gz`; elimina esos tipos de archivo cuando superan 14 días. Respeta `BNOTES_BACKUP_DIR` si está definida. En macOS intenta detectar `~/Library/CloudStorage/GoogleDrive-*/My Drive/Backups_B_Notes` o `Mi unidad/Backups_B_Notes`; si no encuentra Google Drive, usa `backups/` junto al script. En Linux usa el destino definido o `backups/`.

1. Asegurate de que Docker esté iniciado y que los servicios estén creados. Desde la raíz del repositorio:

   ```sh
   chmod +x scripts/backup-bnotes.sh
   ./scripts/backup-bnotes.sh
   ```

2. Editá el crontab del mismo usuario que tiene acceso a Docker:

   ```sh
   crontab -e
   ```

3. Agregá una ejecución diaria a las 23:00 (ajustá la ruta a la ubicación real del clon):

   ```cron
   0 23 * * * /ruta/a/b_notes/scripts/backup-bnotes.sh >> /ruta/a/b_notes/backup.log 2>&1
   ```

Cron tiene un entorno reducido. Si el directorio de backup está en otra ubicación, definí `BNOTES_BACKUP_DIR` en la línea de cron o al comienzo de un wrapper privado, no en el repositorio. Para fijar el destino desde cron:

```cron
0 23 * * * BNOTES_BACKUP_DIR="/ruta/segura/Backups_B_Notes" /ruta/a/b_notes/scripts/backup-bnotes.sh >> /ruta/a/b_notes/backup.log 2>&1
```

En Linux, Google Drive no se detecta automáticamente. Elegí una carpeta montada con `BNOTES_BACKUP_DIR` o sincronizá `backups/` mediante tu herramienta de almacenamiento.

## Restaurar o migrar a otro equipo

Necesitás el mismo archivo `docker-compose.yml`, el `.env` original (guardado de forma segura) y los dos archivos de backup de una misma fecha. Los formatos admitidos son los del backup de Windows (`bnotes_*.sql.zip`, `n8n_*.tar.gz`) y los de macOS/Linux (`bnotes_postgres_*.sql.gz`, `n8n_data_*.tar.gz`).

1. Instalá Docker y Compose en el equipo nuevo. Copiá el proyecto, `.env` y los dos backups; nunca publiques `.env`. Desde la carpeta del proyecto, inicia únicamente los servicios de datos:

   ```sh
   docker compose up -d postgres n8n
   docker compose stop b-notes
   ```

2. Restaurá PostgreSQL. Reemplazá el nombre del archivo por el correspondiente:

   **macOS/Linux (dump `.sql.gz`):**

   ```sh
   docker compose exec -T postgres psql -U bnotes -d postgres -c 'DROP DATABASE IF EXISTS bnotes WITH (FORCE)'
   docker compose exec -T postgres psql -U bnotes -d postgres -c 'CREATE DATABASE bnotes OWNER bnotes'
   gzip -dc "/ruta/al/bnotes_postgres_FECHA.sql.gz" | docker compose exec -T postgres psql -U bnotes -d bnotes
   ```

   **Windows (dump `.sql.zip`, PowerShell):**

   ```powershell
   Expand-Archive -LiteralPath .\bnotes_FECHA.sql.zip -DestinationPath .\restore-sql -Force
   $container = docker compose ps -q postgres
   docker cp .\restore-sql\bnotes_FECHA.sql "${container}:/tmp/bnotes.sql"
   docker compose exec -T postgres psql -U bnotes -d postgres -c "DROP DATABASE IF EXISTS bnotes WITH (FORCE)"
   docker compose exec -T postgres psql -U bnotes -d postgres -c "CREATE DATABASE bnotes OWNER bnotes"
   docker compose exec -T postgres psql -U bnotes -d bnotes -f /tmp/bnotes.sql
   docker compose exec -T postgres rm -f /tmp/bnotes.sql
   Remove-Item .\restore-sql -Recurse
   ```

   Si el nombre del `.sql` extraído difiere, actualizá la ruta usada por `docker cp`.

3. Restaurá `n8n_data` en el volumen del proyecto. El archivo debe coincidir con la fecha elegida para PostgreSQL. Detené n8n antes de reemplazar sus datos.

   **macOS/Linux:**

   ```sh
   docker compose stop n8n
   N8N_CONTAINER="$(docker compose ps -a -q n8n)"
   N8N_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.n8n"}}{{.Name}}{{end}}{{end}}' "$N8N_CONTAINER")"
   docker run --rm -v "$N8N_VOLUME:/data" -v "$PWD:/backup:ro" alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null; tar xzf /backup/n8n_data_FECHA.tar.gz -C /data'
   ```

   **Windows (PowerShell):**

   ```powershell
   docker compose stop n8n
   $container = docker compose ps -a -q n8n
   $volume = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.n8n"}}{{.Name}}{{end}}{{end}}' $container
   docker run --rm --volume "${volume}:/data" --volume "${PWD}:/backup:ro" alpine sh -c "rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null; tar xzf /backup/n8n_FECHA.tar.gz -C /data"
   ```

   Para Windows, usá el nombre real del archivo `n8n_*.tar.gz` producido por `scripts/backup-bnotes.ps1`. Para macOS/Linux, usá `n8n_data_*.tar.gz`.

4. Arrancá los servicios y revisá su estado:

   ```sh
   docker compose up -d
   docker compose ps
   docker compose logs --tail=100 postgres n8n b-notes
   ```

5. Probá iniciar sesión y abrir notas, tareas y el asistente. Las credenciales OAuth de Google y de Groq pertenecen a cada servicio externo; si cambian los dominios o credenciales, revisá [DEPLOYMENT.md](DEPLOYMENT.md).

**Importante:** restaurar el volumen reemplaza los datos actuales de n8n. Confirmá que el backup es el correcto antes de ejecutar el paso; conservá una copia del estado previo si el equipo destino ya tenía datos.
