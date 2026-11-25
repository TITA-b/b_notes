#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BNOTES_BACKUP_DIR:-}"

if [[ -z "$BACKUP_DIR" && "$(uname -s)" == "Darwin" ]]; then
  for drive_dir in "$HOME"/Library/CloudStorage/GoogleDrive-*; do
    [[ -d "$drive_dir" ]] || continue
    for drive_name in "My Drive" "Mi unidad"; do
      candidate="$drive_dir/$drive_name/Backups_B_Notes"
      if [[ -d "$drive_dir/$drive_name" ]]; then
        BACKUP_DIR="$candidate"
        break 2
      fi
    done
  done
fi

if [[ -z "$BACKUP_DIR" ]]; then
  BACKUP_DIR="$PROJECT_DIR/backups"
elif [[ "$BACKUP_DIR" != /* ]]; then
  BACKUP_DIR="$PROJECT_DIR/$BACKUP_DIR"
fi

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
DATE="$(date +%Y-%m-%d_%H-%M-%S)"
POSTGRES_ARCHIVE="$BACKUP_DIR/bnotes_postgres_$DATE.sql.gz"
N8N_ARCHIVE="$BACKUP_DIR/n8n_data_$DATE.tar.gz"

cd "$PROJECT_DIR"
n8n_container="$(docker compose ps -a -q n8n)"
if [[ -z "$n8n_container" ]]; then
  printf '%s\n' "No existe el contenedor de n8n. Iniciá el stack antes de respaldar." >&2
  exit 1
fi

n8n_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.n8n"}}{{.Name}}{{end}}{{end}}' "$n8n_container")"
if [[ -z "$n8n_volume" ]]; then
  printf '%s\n' "No se encontró el volumen montado en /home/node/.n8n." >&2
  exit 1
fi

docker compose exec -T postgres pg_dump -U bnotes bnotes | gzip > "$POSTGRES_ARCHIVE"
docker run --rm -v "$n8n_volume:/data:ro" alpine tar -czf - -C /data . > "$N8N_ARCHIVE"

find "$BACKUP_DIR" -type f \( \
  -name 'bnotes_postgres_*.sql.gz' -o \
  -name 'n8n_data_*.tar.gz' \
\) -mtime +14 -delete

printf 'Backup PostgreSQL: %s\n' "$POSTGRES_ARCHIVE"
printf 'Backup n8n: %s\n' "$N8N_ARCHIVE"
