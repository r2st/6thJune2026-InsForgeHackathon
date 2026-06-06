"""SQLite-backed ticket store.

Pure data layer — no argparse, no JSON, no sys.exit. Each function returns
plain dicts (or raises ValueError on user-visible errors).
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterable, Iterator

STATUSES = ("open", "claimed", "in_progress", "blocked", "done", "cancelled")
TERMINAL = ("done", "cancelled")

DEFAULT_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tickets.db"
)


SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'open',
    assignee     TEXT,
    priority     INTEGER NOT NULL DEFAULT 3,
    parent_id    INTEGER REFERENCES tickets(id),
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS tickets_status_idx   ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_assignee_idx ON tickets(assignee);

CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author     TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_ticket_idx ON comments(ticket_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_path() -> str:
    return os.environ.get("TICKETS_DB", DEFAULT_DB)


@contextmanager
def connect(path: str | None = None) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(path or db_path(), timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        conn.executescript(SCHEMA)
        yield conn
    finally:
        conn.close()


def _row(row: sqlite3.Row | None) -> dict | None:
    return {k: row[k] for k in row.keys()} if row else None


def fetch(conn: sqlite3.Connection, ticket_id: int) -> dict:
    row = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    if not row:
        raise ValueError(f"ticket {ticket_id} not found")
    ticket = dict(_row(row) or {})
    ticket["comments"] = [
        dict(_row(r) or {})
        for r in conn.execute(
            "SELECT id, author, body, created_at FROM comments "
            "WHERE ticket_id = ? ORDER BY id",
            (ticket_id,),
        ).fetchall()
    ]
    return ticket


# ---- writes -----------------------------------------------------------------


def create(
    conn: sqlite3.Connection,
    title: str,
    body: str = "",
    assignee: str | None = None,
    priority: int = 3,
    parent_id: int | None = None,
) -> dict:
    if parent_id is not None and not conn.execute(
        "SELECT 1 FROM tickets WHERE id = ?", (parent_id,)
    ).fetchone():
        raise ValueError(f"parent ticket {parent_id} does not exist")
    ts = now()
    cur = conn.execute(
        "INSERT INTO tickets (title, body, assignee, priority, parent_id, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (title, body, assignee, priority, parent_id, ts, ts),
    )
    new_id = cur.lastrowid
    assert new_id is not None
    return fetch(conn, new_id)


def claim(
    conn: sqlite3.Connection, ticket_id: int, agent: str, force: bool = False
) -> dict:
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT status, assignee FROM tickets WHERE id = ?", (ticket_id,)
        ).fetchone()
        if not row:
            raise ValueError(f"ticket {ticket_id} not found")
        if row["status"] in TERMINAL:
            raise ValueError(f"ticket {ticket_id} is already {row['status']}")
        if row["assignee"] and row["assignee"] != agent and not force:
            raise ValueError(
                f"ticket {ticket_id} is held by {row['assignee']}; "
                "use force=True to steal"
            )
        conn.execute(
            "UPDATE tickets SET assignee = ?, status = 'claimed', updated_at = ? "
            "WHERE id = ?",
            (agent, now(), ticket_id),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return fetch(conn, ticket_id)


def claim_next(conn: sqlite3.Connection, agent: str) -> dict | None:
    """Atomically claim the highest-priority unassigned open ticket."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT id FROM tickets "
            "WHERE status = 'open' AND assignee IS NULL "
            "ORDER BY priority ASC, id ASC LIMIT 1"
        ).fetchone()
        if not row:
            conn.execute("ROLLBACK")
            return None
        ticket_id = row["id"]
        conn.execute(
            "UPDATE tickets SET assignee = ?, status = 'claimed', updated_at = ? "
            "WHERE id = ?",
            (agent, now(), ticket_id),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return fetch(conn, ticket_id)


def update(conn: sqlite3.Connection, ticket_id: int, **fields) -> dict:
    allowed = {"status", "assignee", "title", "body", "priority"}
    sets, params = [], []
    for key, value in fields.items():
        if value is None and key != "assignee":
            continue
        if key not in allowed:
            raise ValueError(f"cannot update field {key!r}")
        if key == "status" and value not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        sets.append(f"{key} = ?")
        params.append(value)
    if not sets:
        raise ValueError("nothing to update")
    sets.append("updated_at = ?")
    params.append(now())
    params.append(ticket_id)
    cur = conn.execute(
        f"UPDATE tickets SET {', '.join(sets)} WHERE id = ?", params
    )
    if cur.rowcount == 0:
        raise ValueError(f"ticket {ticket_id} not found")
    return fetch(conn, ticket_id)


def release(conn: sqlite3.Connection, ticket_id: int) -> dict:
    cur = conn.execute(
        "UPDATE tickets SET assignee = NULL, status = 'open', updated_at = ? "
        "WHERE id = ? AND status NOT IN ('done', 'cancelled')",
        (now(), ticket_id),
    )
    if cur.rowcount == 0:
        raise ValueError(f"ticket {ticket_id} not found or already terminal")
    return fetch(conn, ticket_id)


def add_comment(
    conn: sqlite3.Connection, ticket_id: int, author: str, body: str
) -> dict:
    if not conn.execute(
        "SELECT 1 FROM tickets WHERE id = ?", (ticket_id,)
    ).fetchone():
        raise ValueError(f"ticket {ticket_id} not found")
    ts = now()
    conn.execute(
        "INSERT INTO comments (ticket_id, author, body, created_at) "
        "VALUES (?, ?, ?, ?)",
        (ticket_id, author, body, ts),
    )
    conn.execute("UPDATE tickets SET updated_at = ? WHERE id = ?", (ts, ticket_id))
    return fetch(conn, ticket_id)


# ---- reads ------------------------------------------------------------------


def list_tickets(
    conn: sqlite3.Connection,
    status: Iterable[str] | None = None,
    assignee: str | None = None,
    unassigned: bool = False,
    parent_id: int | None = None,
    limit: int | None = 50,
) -> list[dict]:
    where, params = [], []
    if status:
        status = list(status)
        where.append(f"status IN ({','.join('?' * len(status))})")
        params.extend(status)
    if assignee:
        where.append("assignee = ?")
        params.append(assignee)
    if unassigned:
        where.append("assignee IS NULL")
    if parent_id is not None:
        where.append("parent_id = ?")
        params.append(parent_id)
    sql = "SELECT * FROM tickets"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY priority ASC, id ASC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [dict(_row(r) or {}) for r in conn.execute(sql, params).fetchall()]


def stats(conn: sqlite3.Connection) -> dict:
    by_status = {
        r["status"]: r["n"]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM tickets GROUP BY status"
        ).fetchall()
    }
    by_agent = {
        r["assignee"]: r["n"]
        for r in conn.execute(
            "SELECT assignee, COUNT(*) AS n FROM tickets "
            "WHERE assignee IS NOT NULL AND status NOT IN ('done', 'cancelled') "
            "GROUP BY assignee"
        ).fetchall()
    }
    return {"by_status": by_status, "open_by_agent": by_agent}
