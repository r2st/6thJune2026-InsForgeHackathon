"""Argparse CLI — thin wrapper around `ticketing.store`.

Every command prints JSON to stdout and exits 0 on success, 1 on failure.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import store


def out(payload, status: int = 0) -> None:
    print(json.dumps(payload, indent=2, default=str))
    sys.exit(status)


def fail(msg: str) -> None:
    out({"error": msg}, status=1)


def cmd_create(args, conn):
    out(store.create(
        conn, args.title, args.body or "", args.assignee, args.priority, args.parent
    ))


def cmd_list(args, conn):
    rows = store.list_tickets(
        conn,
        status=args.status,
        assignee=args.assignee,
        unassigned=args.unassigned,
        parent_id=args.parent,
        limit=args.limit,
    )
    out({"count": len(rows), "tickets": rows})


def cmd_show(args, conn):
    out(store.fetch(conn, args.id))


def cmd_claim(args, conn):
    out(store.claim(conn, args.id, args.agent, force=args.force))


def cmd_next(args, conn):
    ticket = store.claim_next(conn, args.agent)
    if ticket is None:
        out({"ticket": None, "message": "no open unassigned tickets"})
    out(ticket)


def cmd_update(args, conn):
    fields = {}
    if args.status:
        fields["status"] = args.status
    if args.assignee is not None:
        fields["assignee"] = args.assignee or None
    if args.title:
        fields["title"] = args.title
    if args.body is not None:
        fields["body"] = args.body
    if args.priority is not None:
        fields["priority"] = args.priority
    out(store.update(conn, args.id, **fields))


def cmd_release(args, conn):
    out(store.release(conn, args.id))


def cmd_comment(args, conn):
    out(store.add_comment(conn, args.id, args.author, args.body))


def cmd_stats(args, conn):
    s = store.stats(conn)
    out({"db": store.db_path(), **s})


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tickets",
        description="Multi-agent coordination tickets (SQLite-backed).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create", help="create a new ticket")
    c.add_argument("title")
    c.add_argument("--body", default="")
    c.add_argument("--assignee")
    c.add_argument("--priority", type=int, default=3, help="1=high, 5=low")
    c.add_argument("--parent", type=int)
    c.set_defaults(func=cmd_create)

    c = sub.add_parser("list", help="list tickets")
    c.add_argument("--status", action="append", choices=store.STATUSES)
    c.add_argument("--assignee")
    c.add_argument("--unassigned", action="store_true")
    c.add_argument("--parent", type=int)
    c.add_argument("--limit", type=int, default=50)
    c.set_defaults(func=cmd_list)

    c = sub.add_parser("show", help="show one ticket with comments")
    c.add_argument("id", type=int)
    c.set_defaults(func=cmd_show)

    c = sub.add_parser("claim", help="claim a specific ticket")
    c.add_argument("id", type=int)
    c.add_argument("--agent", required=True)
    c.add_argument("--force", action="store_true", help="steal from another agent")
    c.set_defaults(func=cmd_claim)

    c = sub.add_parser("next", help="atomically claim the next open ticket")
    c.add_argument("--agent", required=True)
    c.set_defaults(func=cmd_next)

    c = sub.add_parser("update", help="update ticket fields")
    c.add_argument("id", type=int)
    c.add_argument("--status", choices=store.STATUSES)
    c.add_argument("--assignee", help="empty string to unassign")
    c.add_argument("--title")
    c.add_argument("--body")
    c.add_argument("--priority", type=int)
    c.set_defaults(func=cmd_update)

    c = sub.add_parser("release", help="release a claim back to open")
    c.add_argument("id", type=int)
    c.set_defaults(func=cmd_release)

    c = sub.add_parser("comment", help="post a comment on a ticket")
    c.add_argument("id", type=int)
    c.add_argument("--author", required=True)
    c.add_argument("--body", required=True)
    c.set_defaults(func=cmd_comment)

    c = sub.add_parser("stats", help="counts by status and per-agent workload")
    c.set_defaults(func=cmd_stats)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        with store.connect() as conn:
            args.func(args, conn)
    except ValueError as e:
        fail(str(e))
