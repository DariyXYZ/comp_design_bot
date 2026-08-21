"""Код входа для Mini App: бот подписывает, приложение обменивает на токен.

Зачем: клиенты Telegram отдают `initData` непредсказуемо — после
восстановления вебвью из кеша он приходит пустым, и приложение не может
опознать человека (профиль показывает «Гость», картинки не загружаются).
Кнопку Mini App формирует бот, и в этот момент он точно знает, кто перед ним,
поэтому вход подписывает он сам.

Код кладётся в адрес кнопки и живёт столько же, сколько сама кнопка: она
остаётся в чате неделями, и вход не должен «сгорать» раньше неё. Приложение
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

# Срок жизни кода привязан к сроку жизни кнопки, а не к «сколько нужно на
# нажатие»: кнопка остаётся в чате неделями, и человек открывает приложение
# когда захочет. Пятнадцать минут (первая версия) означали, что через час после
# /start вход снова не работал.
#
# Чем это ограничено: код даёт доступ только к своим заявкам и к загрузке
# картинок в задачу — не к правке чужих данных. Он персональный и лежит в
# личном чате, а приложение сразу меняет его на токен сессии.
LOGIN_CODE_TTL_SECONDS = 30 * 24 * 3600


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
