# ticketing

A tiny SQLite-backed ticketing system so multiple agents can coordinate work
without stepping on each other.

## Why

Two agents running in parallel need a shared, atomic queue. `claim` and `next`
use `BEGIN IMMEDIATE` so racing agents can't both win the same ticket —
the loser gets a clean error instead of silently overwriting.

Every command prints JSON to stdout, so agents can parse output directly.
Exit code is `0` on success, `1` on failure (with `{"error": "..."}` body).

## Usage

```sh
# From the repo root
./tickets create "Wire auth" --priority 1 --body "swap legacy session store"
./tickets list --status open --unassigned
./tickets next   --agent alice         # atomically claims highest-priority open
./tickets claim 3 --agent bob          # claim a specific ticket
./tickets update 3 --status in_progress
./tickets comment 3 --author bob --body "blocked on legal review"
./tickets update 3 --status blocked
./tickets release 3                    # back to open
./tickets show 3
./tickets stats
```

Equivalent: `python -m ticketing <command>`.

The DB lives at `tickets.db` in the repo root by default. Override with the
`TICKETS_DB` env var.

## Statuses

`open → claimed → in_progress → (blocked) → done | cancelled`

`done` and `cancelled` are terminal — `claim` and `release` refuse them.

## From Python

```python
from ticketing import store

with store.connect() as conn:
    t = store.create(conn, "Wire auth", priority=1)
    ticket = store.claim_next(conn, "alice")
```

`store.py` raises `ValueError` for user-visible errors (not found, contention,
bad status). `cli.py` catches those and turns them into the JSON error
envelope.

## Tests

```sh
python -m pytest ticketing/tests
```

The race test spawns two threads hitting `claim_next` through a barrier to
prove the atomic-claim path actually holds under contention.
