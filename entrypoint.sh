#!/bin/bash
set -e

CMS_ROOT="/var/www/html"

echo "Checking FusionCMS writable permissions..."

if [ ! -f "$CMS_ROOT/writable/.permissions_fixed" ]; then
    mkdir -p "$CMS_ROOT/writable"

    chown -R www-data:www-data "$CMS_ROOT/writable"
    chmod -R 775 "$CMS_ROOT/writable"

    touch "$CMS_ROOT/writable/.permissions_fixed"

    echo "Writable permissions fixed."
else
    echo "Writable permissions already configured."
fi

# Start Apache
exec apache2-foreground
