#!/bin/bash
set -e

echo "Fixing FusionCMS writable permissions..."

# Ensure writable directory exists
mkdir -p /var/www/html/writable

# Give Apache/PHP ownership
chown -R www-data:www-data /var/www/html/writable

# Allow FusionCMS to write logs/cache/config files
chmod -R 775 /var/www/html/writable

echo "Writable permissions fixed."

# Start the original container command
exec "$@"
