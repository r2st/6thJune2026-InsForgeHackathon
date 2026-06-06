# Pre-Commit Security Scan — 6thJune2026 (run 3)

**Date:** 2026-06-06
**Verdict:** SAFE TO COMMIT
**Risk Score:** 0/100 (No Risk)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

| Bucket | Count |
|--------|-------|
| New (staged changes) | 0 |
| Existing (already committed) | 0 |

## Staged files

- `ticketing/store.py` (+3 / -1) — adds `# nosemgrep` annotation with safety justification for the f-string SQL in `update()` (column names are allowlisted on line 178; values are parameter-bound).
- `reports/precommit-scan-6thJune2026-20260606-2.md` — prior scan summary documenting the same suppression.

## Findings

No findings on staged lines.

### Notes

- `npm audit` reported 5 critical / 9 high vulnerabilities, but they originate from `/Users/dev/package.json` (parent directory tooling), not this repository. No `package.json`, `package-lock.json`, or `node_modules` exists inside the repo. These are pre-existing external findings unrelated to this commit.
- Scanners run: gitleaks (0), grype (0), semgrep (0), checkov (0 / 1 parse warn — no IaC files), hadolint (0 — no Dockerfiles), package-leakage (not applicable — no package manifests).
- Previous semgrep false positive on `ticketing/store.py:189` is now suppressed inline and remains a non-issue (verified again this run).
