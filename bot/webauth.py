"""Код входа для Mini App: бот подписывает, приложение обменивает на токен.

Зачем: клиенты Telegram отдают `initData` непредсказуемо — после
восстановления вебвью из кеша он приходит пустым, и приложение не может
опознать человека (профиль показывает «Гость», картинки не загружаются).
Кнопку Mini App формирует бот, и в этот момент он точно знает, кто перед ним,
поэтому вход подписывает он сам.

Код кладётся в адрес кнопки и живёт минуты: адрес попадает в историю клиента и
в логи сервера, поэтому долгоживущий секрет там держать нельзя. Приложение
сразу меняет код на свой токен сессии (`/api/auth/redeem`).

Формат и секрет те же, что у токена сессии в `web/src/lib/server/telegram-auth.ts`:
`base64url(payload).base64url(HMAC-SHA256(payload))`, секрет — токен бота.
Поле `kind` отличает код от токена, иначе срок жизни потерял бы смысл.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from .config import config

# Пятнадцати минут хватает, чтобы человек нажал кнопку и приложение обменяло
# код; больше держать незачем.
LOGIN_CODE_TTL_SECONDS = 15 * 60


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def login_code(user_id: int, name: str, username: str | None) -> str:
    payload = {
        "uid": int(user_id),
        "name": name or "Без имени",
        "handle": f"@{username}" if username else None,
        "exp": int(time.time()) + LOGIN_CODE_TTL_SECONDS,
        "kind": "code",
    }
    body = _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    signature = hmac.new(config.token.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"
