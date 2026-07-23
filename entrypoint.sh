#!/bin/bash
set -e

CMS_ROOT="/var/www/html"

echo "Setting FusionCMS permissions..."

# FusionCMS writable directories
DIRS=(
    "$CMS_ROOT/writable/cache"
    "$CMS_ROOT/writable/backups"
    "$CMS_ROOT/writable/logs"
    "$CMS_ROOT/writable/uploads"
)

for DIR in "${DIRS[@]}"; do
    mkdir -p "$DIR"
    chown -R www-data:www-data "$DIR"
    chmod -R 775 "$DIR"
done

# Application directories FusionCMS needs writable
for DIR in \
    "$CMS_ROOT/application/config" \
    "$CMS_ROOT/application/modules"
do
    chown -R www-data:www-data "$DIR"
    chmod -R 775 "$DIR"
done

echo "FusionCMS permissions complete."

exec apache2-foreground
