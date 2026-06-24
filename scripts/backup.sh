#!/bin/bash
set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating backup: $FILENAME"

docker compose exec -T postgres pg_dump -U postgres science_agent | gzip > "$BACKUP_DIR/$FILENAME"

FILESIZE=$(du -h "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "Backup saved: $BACKUP_DIR/$FILENAME ($FILESIZE)"

# Keep only last 7 backups
cd "$BACKUP_DIR"
ls -t backup_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm --
echo "Old backups cleaned (keeping last 7)"
