#!/bin/sh
set -eu

# A hosting volume can replace the folder owned by node in the image.
if [ "$(id -u)" = "0" ]; then
  data_dir=$(dirname "${DATABASE_FILE:-/app/data/app.db}")
  mkdir -p "$data_dir"
  chown node:node "$data_dir"
  exec gosu node "$@"
fi

exec "$@"
