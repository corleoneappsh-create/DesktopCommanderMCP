#!/bin/sh
set -u
NODE="${NODE:-$(command -v node)}"
ENTRY="${ENTRY:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/dist/index.js}"
LOG="${LOG:-$(dirname -- "$0")/desktop-commander-remote.log}"
RETRY_SECONDS="${RETRY_SECONDS:-5}"

while :; do
  "$NODE" "$ENTRY" remote --persist-session >> "$LOG" 2>&1
  code=$?
  printf '%s EXIT code=%s; retrying in %s seconds\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" "$RETRY_SECONDS" >> "$LOG"
  sleep "$RETRY_SECONDS"
done
