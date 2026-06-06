#!/usr/bin/env bash
# Hush — pre-warm a pool of N branch projects so the demo never waits on
# a cold spin-up. State persists to .hush/pool.json (gitignored).
#
# Ticket: agents/inbox/0004-prewarm-branch-pool.md
#
# Usage:
#   scripts/prewarm.sh --count 2
#   scripts/prewarm.sh --teardown
#
# Requires: insforge CLI logged in and linked to the prod project.

set -euo pipefail

POOL_FILE=".hush/pool.json"
COUNT="${COUNT:-2}"
ACTION="prewarm"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --teardown) ACTION="teardown"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$POOL_FILE")"

# TODO(0004): implement
#   - insforge branch create hush-fork-<i> --from prod
#   - record { branchId, signingKey, claimedBy: null } in $POOL_FILE
#   - on --teardown: insforge branch delete each entry, rm $POOL_FILE
#   - idempotent: re-running with N entries already up is a no-op
#   - on consume (called from the edge fn): top up to keep N entries

echo "[hush] prewarm.sh: $ACTION (count=$COUNT) — not implemented yet, see ticket 0004" >&2
exit 1
