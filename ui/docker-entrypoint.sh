#!/bin/sh
set -e
cd /app
if [ ! -x node_modules/.bin/vite ]; then
  echo "riskops-frontend: syncing node_modules from image (no npm ci on cold start)..."
  mkdir -p node_modules
  cp -a /opt/node_modules/. node_modules/
fi
exec npm run dev -- --host 0.0.0.0 --port 5173
