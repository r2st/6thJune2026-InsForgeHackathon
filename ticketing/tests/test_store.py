"""Tests for the ticket store. Run with: python -m pytest ticketing/tests"""

from __future__ import annotations

import sqlite3
import threading

import pytest

from ticketing import store


@pytest.fixture
def conn(tmp_path):
    db = tmp_path / "tickets.db"
    with store.connect(str(db)) as c:
        yield c


def test_create_sets_defaults(conn):
    t = store.create(conn, "Wire auth")
    assert t["id"] == 1
    assert t["status"] == "open"
    assert t["assignee"] is None
    assert t["priority"] == 3
    assert t["comments"] == []


def test_claim_marks_assignee_and_status(conn):
    store.create(conn, "A")
    t = store.claim(conn, 1, "alice")
    assert t["assignee"] == "alice"
    assert t["status"] == "claimed"


def test_claim_rejects_held_ticket(conn):
    store.create(conn, "A")
    store.claim(conn, 1, "alice")
    with pytest.raises(ValueError, match="held by alice"):
        store.claim(conn, 1, "bob")


def test_claim_force_steals(conn):
    store.create(conn, "A")
    store.claim(conn, 1, "alice")
    t = store.claim(conn, 1, "bob", force=True)
    assert t["assignee"] == "bob"


def test_claim_rejects_terminal(conn):
    store.create(conn, "A")
    store.update(conn, 1, status="done")
    with pytest.raises(ValueError, match="already done"):
        store.claim(conn, 1, "alice")


def test_claim_next_returns_highest_priority(conn):
    store.create(conn, "low", priority=5)
    store.create(conn, "high", priority=1)
    store.create(conn, "med", priority=3)
    t = store.claim_next(conn, "alice")
    assert t is not None and t["title"] == "high"


def test_claim_next_skips_assigned(conn):
    store.create(conn, "A", assignee="alice")  # priority 3, but assigned
    store.create(conn, "B", priority=4)
    t = store.claim_next(conn, "bob")
    assert t is not None and t["title"] == "B"


def test_claim_next_returns_none_when_empty(conn):
    assert store.claim_next(conn, "alice") is None


def test_release_resets_open(conn):
    store.create(conn, "A")
    store.claim(conn, 1, "alice")
    t = store.release(conn, 1)
    assert t["status"] == "open"
    assert t["assignee"] is None


def test_release_refuses_terminal(conn):
    store.create(conn, "A")
    store.update(conn, 1, status="done")
    with pytest.raises(ValueError):
        store.release(conn, 1)


def test_comment_appends_and_bumps_updated_at(conn):
    store.create(conn, "A")
    before = store.fetch(conn, 1)["updated_at"]
    t = store.add_comment(conn, 1, "alice", "looking into it")
    assert len(t["comments"]) == 1
    assert t["comments"][0]["author"] == "alice"
    assert t["updated_at"] >= before


def test_list_filters_by_status_and_assignee(conn):
    store.create(conn, "A", assignee="alice")
    store.create(conn, "B")
    store.update(conn, 2, status="done")
    rows = store.list_tickets(conn, status=["open"])
    assert [r["title"] for r in rows] == ["A"]
    rows = store.list_tickets(conn, assignee="alice")
    assert [r["title"] for r in rows] == ["A"]
    rows = store.list_tickets(conn, unassigned=True, status=["open"])
    assert rows == []


def test_parent_required_to_exist(conn):
    with pytest.raises(ValueError, match="parent ticket 99"):
        store.create(conn, "child", parent_id=99)


def test_update_validates_status(conn):
    store.create(conn, "A")
    with pytest.raises(ValueError, match="status must be one of"):
        store.update(conn, 1, status="lol")


def test_concurrent_claim_next_is_exclusive(tmp_path):
    """Two threads racing on claim_next must take different tickets."""
    db = str(tmp_path / "race.db")
    with store.connect(db) as c:
        store.create(c, "A", priority=1)
        store.create(c, "B", priority=2)

    results: list[dict] = []
    errors: list[Exception] = []
    barrier = threading.Barrier(2)

    def worker(agent: str):
        try:
            with store.connect(db) as conn:
                barrier.wait(timeout=5)
                # SQLite serializes BEGIN IMMEDIATE; one of these may briefly
                # wait for the other, both should succeed.
                t = store.claim_next(conn, agent)
                if t is not None:
                    results.append(t)
        except sqlite3.OperationalError as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(name,))
               for name in ("alice", "bob")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, errors
    ids = sorted(r["id"] for r in results)
    assert ids == [1, 2], f"expected disjoint claims, got {results}"
    agents = {r["id"]: r["assignee"] for r in results}
    assert agents[1] != agents[2]
