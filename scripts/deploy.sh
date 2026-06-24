#!/bin/bash
set -e

echo "=== Science Agent Deployment ==="

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "Error: Docker Compose is not installed"
    exit 1
fi

# Check .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

# Source .env for DOMAIN variable
source .env 2>/dev/null || true
DOMAIN=${DOMAIN:-science-agent.ru}

# Process nginx template
echo "Processing nginx config for domain: $DOMAIN"
export DOMAIN
envsubst '$DOMAIN' < nginx/conf.d/default.conf > nginx/conf.d/default.conf.processed
mv nginx/conf.d/default.conf.processed nginx/conf.d/default.conf

# Build and start services
echo "Building application..."
docker compose build app

echo "Starting services..."
docker compose up -d

# Wait for PostgreSQL
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec postgres pg_isready -U postgres -q 2>/dev/null; then
    echo "PostgreSQL is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: PostgreSQL did not become ready"
    exit 1
  fi
  sleep 1
done

# Run database migrations
echo "Running database migrations..."
docker compose exec app npx drizzle-kit migrate

echo ""
echo "=== Deployment Complete ==="
echo "Application is running at http://localhost:3000"
echo ""
echo "To setup SSL:"
echo "  ./scripts/setup-ssl.sh your-domain.com your-email@example.com"
echo ""
echo "To view logs:"
echo "  docker compose logs -f app"
echo ""
echo "To stop services:"
echo "  docker compose down"
