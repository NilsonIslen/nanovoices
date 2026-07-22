#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/nanovoices}"
BRANCH="${BRANCH:-main}"
WEB_SERVICE="${WEB_SERVICE:-nanovoices-web.service}"
WORKER_SERVICE="${WORKER_SERVICE:-nanovoices-worker.service}"

echo "Entrando a ${APP_DIR}"
cd "$APP_DIR"

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

echo "Recargando Nginx"
nginx -t
systemctl reload nginx

echo "Verificando servicios"
systemctl is-active --quiet "$WEB_SERVICE"
systemctl is-active --quiet "$WORKER_SERVICE"
systemctl is-active --quiet nginx

for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:8790 >/dev/null; then
    break
  fi

  if [ "$attempt" -eq 15 ]; then
    echo "NanoVoices no respondió después del reinicio."
    exit 1
  fi

  sleep 1
done

echo "Despliegue completado"
