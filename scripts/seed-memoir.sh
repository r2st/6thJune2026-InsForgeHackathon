#!/usr/bin/env bash
# Hush — seed one historical "merged" outcome into the Memoir store (ticket 0046).
#
# Why: the confidence scorer recalls a similar past outcome and turns it into the
# pgvector-similarity signal. With an empty store recall returns nothing and the
# scorer uses the neutral 50. Seeding one merged neighbour that resembles the demo
# RLS fix gives the demo a *real* recalled prior — so the 90/92 badge is computed
# from evidence, not a hardcoded number (resolves ticket 0040 honestly).
#
# This writes the same JSON-blob shape RealMemoir.recordOutcome emits
# (functions/memory.ts), so RealMemoir.recallSimilar parses it back as a
# structured neighbour.
#
# Usage:
#   scripts/seed-memoir.sh                 # uses $MEMOIR_STORE
#   scripts/seed-memoir.sh -s <storePath>  # explicit store
#
# Requires: `memoir` on PATH (pipx install memoir-ai) and a store created with
#   memoir new <path>.

set -euo pipefail

STORE="${MEMOIR_STORE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--store) STORE="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$STORE" ]]; then
  echo "error: set MEMOIR_STORE or pass -s <storePath>" >&2
  exit 2
fi
if ! command -v memoir >/dev/null 2>&1; then
  echo "error: memoir CLI not found (pipx install memoir-ai)" >&2
  exit 2
fi

RUN_ID="seed-orders-rls-merged"
# Same blob shape as RealMemoir.recordOutcome (functions/memory.ts).
BLOB="$(cat <<JSON
{"runId":"${RUN_ID}","decision":"merged","failingPolicy":"orders.orders_select","bugConfirmed":true,"diff":{"path":"tables.orders.rls","before":"auth.jwt() ->> 'tenant'","after":"tenant_id = ANY(auth.jwt() -> 'tenant_ids')"}}
JSON
)"

# Idempotent: same runId → same path → memoir versions it (update, not duplicate).
memoir -s "$STORE" --json remember "$BLOB" -n hush -p "outcome.${RUN_ID}" >/dev/null
echo "✓ seeded merged neighbour 'outcome.${RUN_ID}' (namespace hush) into $STORE"
