#!/bin/bash
set -e

DOMAIN=${1:-science-agent.ru}
EMAIL=${2:-admin@science-agent.ru}

echo "Setting up SSL for domain: $DOMAIN"

# Create dummy certificate for Nginx to start
mkdir -p nginx/ssl
openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
  -keyout nginx/ssl/dummy.key \
  -out nginx/ssl/dummy.crt \
  -subj "/CN=localhost" 2>/dev/null

# Start services
docker compose up -d nginx

# Request real certificate
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Remove dummy certificate
rm -f nginx/ssl/dummy.key nginx/ssl/dummy.crt

# Restart nginx with real certificate
docker compose restart nginx

echo "SSL setup complete for $DOMAIN"
echo "Certificate will auto-renew via certbot container"
