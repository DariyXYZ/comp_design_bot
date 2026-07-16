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


def _connect() -> aiosqlite.Connection:
    # WAL: конкурентные записи не блокируют друг друга насмерть;
    # busy_timeout: при занятом локе ждём, а не падаем с 'database is locked'.
    return aiosqlite.connect(config.db_path, timeout=10)


async def _setup(db: aiosqlite.Connection) -> None:
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=10000")


_NEW_COLUMNS = {
    "accepted_by_user_id": "INTEGER",
    "accepted_by_username": "TEXT",
    "accepted_by_name": "TEXT",
    "accepted_by_contact": "TEXT",
}


async def _ensure_columns(db: aiosqlite.Connection) -> None:
    """ALTER TABLE ADD COLUMN, но только если колонки ещё нет — CREATE TABLE
    IF NOT EXISTS не трогает уже существующую таблицу, схему приходится
    доращивать руками при каждом обновлении, не теряя старые данные."""
    cur = await db.execute("PRAGMA table_info(requests)")
    existing = {row[1] for row in await cur.fetchall()}
    for name, coltype in _NEW_COLUMNS.items():
        if name not in existing:
            await db.execute(f"ALTER TABLE requests ADD COLUMN {name} {coltype}")


async def init_db() -> None:
    async with _connect() as db:
        await _setup(db)
        await db.executescript(_SCHEMA)
        await _ensure_columns(db)
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
    async with _connect() as db:
        await _setup(db)
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
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET dept_message_id = ?, updated_at = ? WHERE id = ?",
            (message_id, _now(), req_id),
        )
        await db.commit()


async def set_status(req_id: int, status: str) -> dict | None:
    """Меняет статус, возвращает обновлённую заявку (или None, если нет такой)."""
    async with _connect() as db:
        await _setup(db)
        db.row_factory = aiosqlite.Row
        await db.execute(
            "UPDATE requests SET status = ?, updated_at = ? WHERE id = ?",
            (status, _now(), req_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM requests WHERE id = ?", (req_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def set_acceptor(req_id: int, user_id: int, username: str | None, full_name: str) -> None:
    """Кто нажал «Принята» — фиксируется в момент перехода в этот статус."""
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET accepted_by_user_id = ?, accepted_by_username = ?,"
            " accepted_by_name = ?, updated_at = ? WHERE id = ?",
            (user_id, username, full_name, _now(), req_id),
        )
        await db.commit()


async def set_acceptor_contact(req_id: int, contact: str) -> None:
    """Контакт, присланный вручную — для тех, у кого нет @username в Telegram."""
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET accepted_by_contact = ?, updated_at = ? WHERE id = ?",
            (contact, _now(), req_id),
        )
        await db.commit()


async def get_request(req_id: int) -> dict | None:
    async with _connect() as db:
        await _setup(db)
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM requests WHERE id = ?", (req_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def list_user_requests(user_id: int, limit: int = 20) -> list[dict]:
    async with _connect() as db:
        await _setup(db)
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM requests WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
