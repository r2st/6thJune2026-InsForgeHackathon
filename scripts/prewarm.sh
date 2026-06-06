#!/usr/bin/env bash
# Hush — pre-warm a pool of N branch projects so the demo never waits on a cold
# spin-up. State persists to .hush/pool.json (gitignored), which the Hush
# runtime (functions/lib/pool.ts) reads to claim a fork synchronously.
#
# Ticket: agents/inbox/0004-prewarm-branch-pool.md
# Verified against the insforge-cli skill (branch create/list/delete/reset):
#   - A branch shares the parent's JWT_SECRET (so the same users authenticate,
#     and a forged token signed with the parent secret validates on the fork).
#   - Each branch gets a fresh EC2 + DB + API_KEY/ANON_KEY and its own URL.
#   - Branching requires InsForge backend >= 2.1.0.
#
# Usage:
#   scripts/prewarm.sh --count 2          # spin up + seed N forks (idempotent)
#   scripts/prewarm.sh --teardown         # delete all forks, remove pool.json
#   HUSH_PREWARM_MOCK=1 scripts/prewarm.sh --count 2   # offline: synth pool.json
#
# Env:
#   INSFORGE_JWT_SECRET   parent JWT secret, written into each pool entry so
#                         forgeJwt can sign fork-valid tokens. (Shared by design.)
#   SEED_FILE             SQL seed applied to each fork (default infra/seed/two-tenants.sql)
#   HUSH_FORK_BASE_URL_<i> optional override for fork i's base URL if the CLI
#                         can't be queried for it in this environment.

set -euo pipefail

POOL_FILE="${HUSH_POOL_FILE:-.hush/pool.json}"
SEED_FILE="${SEED_FILE:-infra/seed/two-tenants.sql}"
FORK_PREFIX="hush-fork-"
COUNT="${COUNT:-2}"
ACTION="prewarm"
CLI="npx @insforge/cli"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --teardown) ACTION="teardown"; shift ;;
    --mock) HUSH_PREWARM_MOCK=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$POOL_FILE")"

log() { printf "[hush] prewarm: %s\n" "$1" >&2; }

# Write pool.json from "branchId|baseUrl" lines passed as $1 (newline-separated).
# Data goes via env (POOL_DATA), not stdin, because the heredoc IS python's stdin.
# Entry shape matches functions/lib/pool.ts PoolEntry exactly.
write_pool() {
  POOL_DATA="$1" python3 - "$POOL_FILE" "${INSFORGE_JWT_SECRET:-}" <<'PY'
import json, os, sys
pool_file, jwt_secret = sys.argv[1], sys.argv[2]
entries = []
for line in os.environ.get("POOL_DATA", "").splitlines():
    line = line.strip()
    if not line:
        continue
    branch_id, _, base_url = line.partition("|")
    entries.append({
        "branchId": branch_id,
        "baseUrl": base_url,
        "jwtSecret": jwt_secret,
        "jwtIssuer": None,
        "jwtAudience": branch_id,
        "claimedBy": None,
    })
with open(pool_file, "w") as f:
    json.dump({"entries": entries}, f, indent=2)
n = len(entries)
print(f"wrote {n} entr{'y' if n==1 else 'ies'} to {pool_file}", file=sys.stderr)
PY
}

# Best-effort resolve a branch's base URL. The CLI's machine-readable output
# isn't pinned across versions, so prefer an explicit override, then try
# `branch list --json`, then leave blank (replay() can still be pointed via env).
resolve_base_url() {
  local i="$1" name="$2" override_var="HUSH_FORK_BASE_URL_${i}"
  if [[ -n "${!override_var:-}" ]]; then echo "${!override_var}"; return; fi
  $CLI branch list --json 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    rows = d if isinstance(d, list) else d.get('branches', d.get('data', []))
    print(next((r.get('url') or r.get('baseUrl') or '' for r in rows if r.get('name') == '$name'), ''))
except Exception:
    print('')
" 2>/dev/null || echo ""
}

branch_exists() { $CLI branch list 2>/dev/null | grep -qw "$1"; }

teardown() {
  if [[ -s "$POOL_FILE" ]]; then
    while read -r name; do
      [[ -z "$name" ]] && continue
      log "deleting $name"
      $CLI branch delete "$name" -y >/dev/null 2>&1 || log "  (delete failed or already gone: $name)"
    done < <(python3 -c "import json;print('\n'.join(e['branchId'] for e in json.load(open('$POOL_FILE'))['entries']))" 2>/dev/null || true)
  fi
  rm -f "$POOL_FILE"
  log "teardown complete; removed $POOL_FILE"
}

prewarm() {
  # Idempotent: if the pool already has >= N unclaimed entries, do nothing.
  if [[ -s "$POOL_FILE" ]]; then
    local have
    have=$(python3 -c "import json;print(sum(1 for e in json.load(open('$POOL_FILE'))['entries'] if e['claimedBy'] is None))" 2>/dev/null || echo 0)
    if [[ "$have" -ge "$COUNT" ]]; then
      log "$have unclaimed fork(s) already pooled (>= $COUNT) — no-op"
      return 0
    fi
  fi

  if [[ "${HUSH_PREWARM_MOCK:-0}" == "1" ]]; then
    log "MOCK mode — synthesising $COUNT fork entries (no live branches created)"
    local mock=""
    for i in $(seq 1 "$COUNT"); do
      mock+="${FORK_PREFIX}${i}|https://mock-fork-${i}.insforge.test"$'\n'
    done
    write_pool "$mock"
    return 0
  fi

  local lines=""
  for i in $(seq 1 "$COUNT"); do
    local name="${FORK_PREFIX}${i}"
    if branch_exists "$name"; then
      log "$name exists — reusing (reset to T0)"
      $CLI branch reset "$name" -y >/dev/null 2>&1 || log "  (reset failed: $name)"
    else
      log "creating $name"
      $CLI branch create "$name" --mode full --no-switch >/dev/null
    fi
    # Seed the fork deterministically (3 orders for tenant A, 0 for tenant B).
    if [[ -s "$SEED_FILE" ]]; then
      $CLI db query --branch "$name" --file "$SEED_FILE" >/dev/null 2>&1 \
        || log "  (seed apply skipped/failed for $name — verify CLI db command)"
    fi
    lines+="${name}|$(resolve_base_url "$i" "$name")"$'\n'
  done
  write_pool "$lines"
}

case "$ACTION" in
  teardown) teardown ;;
  prewarm) prewarm ;;
esac
