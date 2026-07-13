"""SQLite-хранилище заявок."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import aiosqlite

from .config import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT,
    full_name TEXT,
    case_key TEXT NOT NULL,
    description TEXT NOT NULL,
    photo_file_ids TEXT NOT NULL DEFAULT '[]',
    source_path TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    dept_message_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def init_db() -> None:
    async with aiosqlite.connect(config.db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def create_request(
    user_id: int,
    username: str | None,
    full_name: str,
    case_key: str,
    description: str,
    photo_file_ids: list[str],
    source_path: str | None,
) -> int:
    now = _now()
    async with aiosqlite.connect(config.db_path) as db:
        cur = await db.execute(
            "INSERT INTO requests (user_id, username, full_name, case_key, description,"
            " photo_file_ids, source_path, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)",
            (
                user_id,
                username,
                full_name,
                case_key,
                description,
                json.dumps(photo_file_ids),
                source_path,
                now,
                now,
            ),
        )
        await db.commit()
        return cur.lastrowid


async def set_dept_message_id(req_id: int, message_id: int) -> None:
    async with aiosqlite.connect(config.db_path) as db:
        await db.execute(
            "UPDATE requests SET dept_message_id = ?, updated_at = ? WHERE id = ?",
            (message_id, _now(), req_id),
        )
        await db.commit()


async def set_status(req_id: int, status: str) -> dict | None:
    """Меняет статус, возвращает обновлённую заявку (или None, если нет такой)."""
    async with aiosqlite.connect(config.db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "UPDATE requests SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), req_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM requests WHERE id = ?", (req_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_request(req_id: int) -> dict | None:
    async with aiosqlite.connect(config.db_path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM requests WHERE id = ?", (req_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def list_user_requests(user_id: int, limit: int = 20) -> list[dict]:
    async with aiosqlite.connect(config.db_path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM requests WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
