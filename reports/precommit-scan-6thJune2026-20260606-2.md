# Pre-Commit Security Scan — 6thJune2026 (run 2)

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

## Findings

No findings. Scanners: gitleaks, semgrep, grype, checkov — all clean.

### Notes
- Initial semgrep run flagged `ticketing/store.py:189` for the f-string SQL build pattern. False positive: column names in the f-string come from a fixed allowlist (`store.py:178`); all values are parameter-bound. Suppressed with `# nosemgrep` after manual review.
