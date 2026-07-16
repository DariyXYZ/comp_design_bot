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

-- Контакт человека без @username, однажды присланный — чтобы больше не переспрашивать.
CREATE TABLE IF NOT EXISTS actor_contacts (
    user_id INTEGER PRIMARY KEY,
    contact TEXT NOT NULL
);

-- Общий "жду реплай на моё сообщение": контакт исполнителя, причина отклонения,
-- комментарий к оценке от заявителя. Ключ (chat_id, ask_message_id) — message_id
-- уникален только В ПРЕДЕЛАХ чата, эти же номера легко повторятся в другом чате
-- (дept-чат и личка с заявителем — разные чаты). Переживает рестарт бота.
CREATE TABLE IF NOT EXISTS pending_replies (
    chat_id INTEGER NOT NULL,
    ask_message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    req_id INTEGER NOT NULL,
    prefix TEXT,
    PRIMARY KEY (chat_id, ask_message_id)
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
    "accepted_by_contact": "TEXT",  # больше не заполняется, оставлено ради старых строк
    "finished_by_user_id": "INTEGER",
    "finished_by_username": "TEXT",
    "finished_by_name": "TEXT",
    "finished_by_contact": "TEXT",
    "rejection_reason": "TEXT",
    "feedback": "TEXT",  # 'up' / 'down', пусто пока не оценили
    "feedback_comment": "TEXT",
}

# Единственные два префикса, которые когда-либо подставляются в SQL как имена
# колонок (см. set_actor/set_actor_contact) — жёстко ограничены этим множеством,
# никогда не приходят как есть от пользователя/Telegram.
_ACTOR_PREFIXES = {"accepted_by", "finished_by"}


async def _ensure_columns(db: aiosqlite.Connection) -> None:
    """ALTER TABLE ADD COLUMN, но только если колонки ещё нет — CREATE TABLE
    IF NOT EXISTS не трогает уже существующую таблицу, схему приходится
    доращивать руками при каждом обновлении, не теряя старые данные."""
    cur = await db.execute("PRAGMA table_info(requests)")
    existing = {row[1] for row in await cur.fetchall()}
    for name, coltype in _NEW_COLUMNS.items():
        if name not in existing:
            await db.execute(f"ALTER TABLE requests ADD COLUMN {name} {coltype}")


async def _migrate_old_pending_contacts(db: aiosqlite.Connection) -> None:
    """pending_contacts — таблица из прошлой ревизии этой фичи (жила пару дней),
    вытеснена общей pending_replies. Переносим то, что не успели разобрать,
    и больше эту таблицу не трогаем."""
    cur = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_contacts'"
    )
    if await cur.fetchone() is None:
        return
    cur = await db.execute("SELECT ask_message_id, user_id, req_id, prefix FROM pending_contacts")
    rows = await cur.fetchall()
    for ask_message_id, user_id, req_id, prefix in rows:
        await db.execute(
            "INSERT OR IGNORE INTO pending_replies (chat_id, ask_message_id, user_id, kind, req_id, prefix)"
            " VALUES (?, ?, ?, 'contact', ?, ?)",
            (config.dept_chat_id, ask_message_id, user_id, req_id, prefix),
        )
    if rows:
        await db.execute("DELETE FROM pending_contacts")


async def init_db() -> None:
    async with _connect() as db:
        await _setup(db)
        await db.executescript(_SCHEMA)
        await _ensure_columns(db)
        await _migrate_old_pending_contacts(db)
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


async def set_actor(req_id: int, prefix: str, user_id: int, username: str | None, full_name: str) -> None:
    """Кто нажал кнопку статуса — prefix задаёт, какую пару колонок писать:
    "accepted_by" (кто взял в работу, для карточки) или "finished_by"
    (кто реально сдал результат, для контакта заявителю)."""
    if prefix not in _ACTOR_PREFIXES:
        raise ValueError(f"неизвестный actor prefix: {prefix!r}")
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            f"UPDATE requests SET {prefix}_user_id = ?, {prefix}_username = ?,"
            f" {prefix}_name = ?, updated_at = ? WHERE id = ?",
            (user_id, username, full_name, _now(), req_id),
        )
        await db.commit()


async def set_actor_contact(req_id: int, prefix: str, contact: str) -> None:
    """Контакт, присланный вручную — для тех, у кого нет @username в Telegram."""
    if prefix not in _ACTOR_PREFIXES:
        raise ValueError(f"неизвестный actor prefix: {prefix!r}")
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            f"UPDATE requests SET {prefix}_contact = ?, updated_at = ? WHERE id = ?",
            (contact, _now(), req_id),
        )
        await db.commit()


async def get_known_contact(user_id: int) -> str | None:
    """Контакт, который этот человек уже когда-то присылал — не переспрашивать снова."""
    async with _connect() as db:
        await _setup(db)
        cur = await db.execute("SELECT contact FROM actor_contacts WHERE user_id = ?", (user_id,))
        row = await cur.fetchone()
        return row[0] if row else None


async def set_known_contact(user_id: int, contact: str) -> None:
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "INSERT INTO actor_contacts (user_id, contact) VALUES (?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET contact = excluded.contact",
            (user_id, contact),
        )
        await db.commit()


_REPLY_KINDS = {"contact", "rejection_reason", "feedback_comment"}


async def add_pending_reply(
    chat_id: int, ask_message_id: int, user_id: int, kind: str, req_id: int, prefix: str | None = None
) -> None:
    if kind not in _REPLY_KINDS:
        raise ValueError(f"неизвестный kind: {kind!r}")
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "INSERT OR REPLACE INTO pending_replies (chat_id, ask_message_id, user_id, kind, req_id, prefix)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (chat_id, ask_message_id, user_id, kind, req_id, prefix),
        )
        await db.commit()


async def get_pending_reply(chat_id: int, ask_message_id: int) -> dict | None:
    """Не удаляет запись — вызывающий сам решает, дошёл ли ответ до валидного результата."""
    async with _connect() as db:
        await _setup(db)
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT user_id, kind, req_id, prefix FROM pending_replies"
            " WHERE chat_id = ? AND ask_message_id = ?",
            (chat_id, ask_message_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def clear_pending_reply(chat_id: int, ask_message_id: int) -> None:
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "DELETE FROM pending_replies WHERE chat_id = ? AND ask_message_id = ?",
            (chat_id, ask_message_id),
        )
        await db.commit()


async def set_rejection_reason(req_id: int, reason: str) -> None:
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET rejection_reason = ?, updated_at = ? WHERE id = ?",
            (reason, _now(), req_id),
        )
        await db.commit()


async def set_feedback(req_id: int, feedback: str) -> None:
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET feedback = ?, updated_at = ? WHERE id = ?",
            (feedback, _now(), req_id),
        )
        await db.commit()


async def set_feedback_comment(req_id: int, comment: str) -> None:
    async with _connect() as db:
        await _setup(db)
        await db.execute(
            "UPDATE requests SET feedback_comment = ?, updated_at = ? WHERE id = ?",
            (comment, _now(), req_id),
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
