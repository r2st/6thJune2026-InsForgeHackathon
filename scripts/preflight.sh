#!/usr/bin/env bash
# Hush — pre-pitch sanity checks. Run T-15 minutes from demo.
# Should print all green or exit non-zero with a specific failure.
#
# Usage:
#   scripts/preflight.sh
#   pnpm preflight

set -euo pipefail

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAILED=1; }

FAILED=0

echo "// hush preflight · $(date -Iseconds)"
echo

echo "[env]"
for v in INSFORGE_PROJECT_ID INSFORGE_SERVICE_KEY INSFORGE_ANON_KEY \
         INSFORGE_BRANCH_PROJECT_ID OPENROUTER_API_KEY \
         DEVIN_API_KEY GITHUB_TOKEN; do
  if [[ -n "${!v:-}" ]]; then ok "$v set"; else fail "$v missing"; fi
done

echo
echo "[clis]"
for c in insforge vercel gh node pnpm; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c"; else fail "$c missing"; fi
done

echo
echo "[pool]"
if [[ -s .hush/pool.json ]]; then
  ok ".hush/pool.json present"
else
  warn ".hush/pool.json missing — run scripts/prewarm.sh --count 2"
fi

echo
echo "[deck]"
if [[ -s demo/slides/index.html ]]; then ok "deck present"; else fail "deck missing"; fi
if [[ -s demo/recordings/*.mp4 2>/dev/null ]]; then ok "fallback recording present"; else warn "no fallback recording — record one"; fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "// all green · go"
  exit 0
else
  echo "// $FAILED failure(s) · fix before demo" >&2
  exit 1
fi
