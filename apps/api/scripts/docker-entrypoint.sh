#!/bin/sh
set -eu

echo "[entrypoint] waiting for application bootstrap (DB healthcheck handled by Compose)"

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running TypeORM migrations"
  npm run migration:run
fi

echo "[entrypoint] starting: $*"
exec "$@"
