#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE="${NODE:-$(command -v node)}"
exec "$NODE" "$SCRIPT_DIR/supervisor.mjs"
