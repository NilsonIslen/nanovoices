#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname -- "$SCRIPT_DIR")}"
BRANCH="${BRANCH:-main}"
WEB_SERVICE="${WEB_SERVICE:-nanovoices-home.service}"
WORKER_SERVICE="${WORKER_SERVICE:-nanovoices-worker-home.service}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://10.77.0.2:8790}"

echo "Entrando a ${APP_DIR}"
cd "$APP_DIR"

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

echo "Descargando cambios desde GitHub (${BRANCH})"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "Instalando dependencias"
npm ci

echo "Aplicando migraciones"
npm run db:deploy

echo "Construyendo aplicación"
npm run build

echo "Reiniciando servicios"
systemctl restart "$WEB_SERVICE"
systemctl restart "$WORKER_SERVICE"

if command -v nginx >/dev/null 2>&1; then
  echo "Recargando Nginx"
  nginx -t
  systemctl reload nginx
else
  echo "Nginx no está instalado en este host; se omite su recarga"
fi

echo "Verificando servicios"
systemctl is-active --quiet "$WEB_SERVICE"
systemctl is-active --quiet "$WORKER_SERVICE"
if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  systemctl is-active --quiet nginx
fi

for attempt in {1..15}; do
  if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
    break
  fi

  if [ "$attempt" -eq 15 ]; then
    echo "NanoVoices no respondió después del reinicio."
    exit 1
  fi

  sleep 1
done

echo "Despliegue completado"
