#!/usr/bin/env bash
# Hush — pre-pitch sanity checks. Run T-15 minutes from demo.
# Should print all green or exit non-zero with a specific failure.
#
# Usage:
#   scripts/preflight.sh
#   pnpm preflight

set -euo pipefail
shopt -s nullglob

# --deep adds a live 1-token Anthropic ping to catch a present-but-invalid key.
DEEP=0
for a in "$@"; do [[ "$a" == "--deep" ]] && DEEP=1; done

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAILED=$((FAILED + 1)); }

FAILED=0

echo "// hush preflight · $(date -Iseconds)"
echo

echo "[env]"
# Which key serves which path (keep this in sync with infra/insforge.toml secrets):
#   ANTHROPIC_API_KEY   → diagnose() — the money-shot LLM call (ticket 0018 moved
#                         it off OpenRouter to a direct Anthropic call).
#   OPENROUTER_API_KEY  → ingest embeddings (bug_runs.embedding) — still needed.
#   INSFORGE_*          → backend + branch-project (fork) provisioning.
#   DEVIN_*/GITHUB_*    → ship: PR/issue (ticket 0011).
for v in INSFORGE_PROJECT_ID INSFORGE_SERVICE_KEY INSFORGE_ANON_KEY \
         INSFORGE_BRANCH_PROJECT_ID ANTHROPIC_API_KEY OPENROUTER_API_KEY \
         DEVIN_API_KEY DEVIN_TARGET_REPO GITHUB_TOKEN VERCEL_TOKEN; do
  if [[ -n "${!v:-}" ]]; then ok "$v set"; else fail "$v missing"; fi
done

# --deep: a present-but-invalid ANTHROPIC_API_KEY passes the set-check above but
# dies mid-demo on the first diagnose() call. Catch it now with a cheap call.
if [[ "$DEEP" -eq 1 && -n "${ANTHROPIC_API_KEY:-}" ]]; then
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models \
      -H "x-api-key: ${ANTHROPIC_API_KEY}" -H "anthropic-version: 2023-06-01" || echo 000)
    case "$code" in
      200) ok "ANTHROPIC_API_KEY live (models.list 200)" ;;
      401|403) fail "ANTHROPIC_API_KEY present but rejected (HTTP $code)" ;;
      *) warn "ANTHROPIC_API_KEY live check inconclusive (HTTP $code)" ;;
    esac
  else
    warn "--deep requested but curl unavailable — skipped Anthropic ping"
  fi
fi

echo
echo "[clis]"
if command -v npx >/dev/null 2>&1 && npx @insforge/cli --version >/dev/null 2>&1; then
  ok "npx @insforge/cli"
else
  fail "npx @insforge/cli unavailable"
fi

for c in gh node pnpm; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c"; else fail "$c missing"; fi
done

if command -v vercel >/dev/null 2>&1; then
  ok "vercel"
else
  warn "vercel missing — use npx @insforge/cli deployments deploy or install Vercel CLI"
fi

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
recordings=(demo/recordings/*.mp4)
if (( ${#recordings[@]} > 0 )); then ok "fallback recording present"; else warn "no fallback recording — record one"; fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "// all green · go"
  exit 0
else
  echo "// $FAILED failure(s) · fix before demo" >&2
  exit 1
fi
