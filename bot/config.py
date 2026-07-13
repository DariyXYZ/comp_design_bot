"""Конфигурация из .env — все настройки бота в одном месте."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        # Кавычки вокруг значения (частая привычка из других env-форматов) убираем,
        # иначе int('"-100..."') валит бота в бесконечный краш-цикл при старте.
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_env(BASE_DIR / ".env")


@dataclass(frozen=True)
class Config:
    token: str
    dept_chat_id: int | None
    dept_thread_id: int | None
    webapp_url: str
    db_path: Path

    @classmethod
    def load(cls) -> "Config":
        token = os.environ.get("TELEGRAM_TOKEN", "")
        if not token:
            raise RuntimeError("TELEGRAM_TOKEN не задан в .env")

        def _int_or_none(name: str) -> int | None:
            raw = os.environ.get(name, "").strip()
            return int(raw) if raw else None

        webapp_url = os.environ.get("WEBAPP_URL", "").strip()
        if webapp_url and not webapp_url.startswith("https://"):
            # Telegram принимает только https для web_app-кнопок; кривой URL
            # ломает /start целиком, поэтому лучше вообще без кнопки Mini App.
            import logging
            logging.getLogger(__name__).warning(
                "WEBAPP_URL не https:// — кнопка Mini App отключена: %r", webapp_url
            )
            webapp_url = ""

        return cls(
            token=token,
            dept_chat_id=_int_or_none("DEPT_CHAT_ID"),
            dept_thread_id=_int_or_none("DEPT_THREAD_ID"),
            webapp_url=webapp_url,
            db_path=BASE_DIR / os.environ.get("DB_FILE", "requests.sqlite3"),
        )


config = Config.load()
