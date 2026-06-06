#!/usr/bin/env bash
# Hush — apply the deterministic demo seed to a target project (ticket 0010).
#
# The same seed goes to the demo prod project and to every pre-warmed fork, so
# prod/fork row counts are identical at t=0. After that, only the RLS policy
# differs — which is the entire point of the demo.
#
# Usage:
#   scripts/seed.sh --env prod              # seed the linked prod project
#   scripts/seed.sh --env <branchId>        # seed one pre-warmed fork
#
# Requires: insforge CLI logged in and linked.

set -euo pipefail

SEED_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/seed/demo.sql"
ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "error: --env <prod|branchId> is required" >&2
  exit 2
fi

if [[ ! -f "$SEED_FILE" ]]; then
  echo "error: seed file not found at $SEED_FILE" >&2
  exit 1
fi

echo "[hush] seeding '$ENV' from $SEED_FILE"

if [[ "$ENV" == "prod" ]]; then
  insforge db execute --file "$SEED_FILE"
else
  insforge db execute --branch "$ENV" --file "$SEED_FILE"
fi

echo "[hush] done. Expected state: 3 orders for Acme, 0 for Globex."
echo "[hush] reminder: prod policy still returns 0 (buggy); a patched fork returns 3 (fixed)."
