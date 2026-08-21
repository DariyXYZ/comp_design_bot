"""Проверка данных запуска Mini App и свои сессионные токены.

Почему нужен и тот, и другой механизм:

* **`initData` подписан Telegram** — по подписи видно, что запрос действительно
  от этого пользователя. Без проверки любой мог бы прислать чужой Telegram-id
  и прочитать чужие заявки, поэтому проверка обязательна.
* **`initData` нельзя использовать как постоянный ключ.** Клиенты Telegram
  (особенно Desktop) отдают его пустым или обрезанным, когда вебвью
  восстановили из кеша — известное поведение без официального фикса. Поэтому
  подпись проверяется один раз, а дальше приложение живёт со своим токеном,
  который не зависит от того, что клиент отдал в этот раз.

Токен — подписанный HMAC-SHA256 payload, без сервера состояний: проверять
подпись дешевле, чем хранить сессии, а отзывать их нам пока незачем.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

# Сколько живёт свой токен. Месяц — компромисс: человек не логинится заново
# каждый день, но потерянный токен не работает вечно.
TOKEN_TTL_SECONDS = 30 * 24 * 3600
# Насколько свежими считаем данные запуска Telegram при обмене на токен.
INIT_DATA_MAX_AGE_SECONDS = 24 * 3600


class AuthError(Exception):
    """Данные запуска не прошли проверку."""


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def verify_init_data(init_data: str, bot_token: str) -> dict:
    """Проверяет подпись `initData` и возвращает разобранные поля.

    Алгоритм задан Telegram: строка проверки — пары `key=value`, отсортированные
    по ключу и склеенные через перевод строки, без самого `hash`; ключ подписи —
    HMAC от токена бота с константой `WebAppData`.
    """
    if not init_data:
        raise AuthError("данные запуска пусты")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", "")
    if not received_hash:
        raise AuthError("в данных запуска нет подписи")

    check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    # compare_digest, а не ==: сравнение подписей должно быть постоянного времени.
    if not hmac.compare_digest(expected, received_hash):
        raise AuthError("подпись не совпала")

    auth_date = int(pairs.get("auth_date", "0") or 0)
    if auth_date and time.time() - auth_date > INIT_DATA_MAX_AGE_SECONDS:
        raise AuthError("данные запуска устарели")

    user_raw = pairs.get("user")
    if not user_raw:
        raise AuthError("в данных запуска нет пользователя")
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise AuthError("пользователь не разобрался") from exc
    if not isinstance(user, dict) or not user.get("id"):
        raise AuthError("у пользователя нет id")
    return user


def display_name(user: dict) -> str:
    name = " ".join(
        part for part in (user.get("first_name"), user.get("last_name")) if part
    ).strip()
    return name or "Без имени"


def issue_token(user: dict, secret: str) -> str:
    """Свой токен сессии: `payload.signature`, оба в base64url."""
    payload = {
        "uid": int(user["id"]),
        "name": display_name(user),
        "handle": f"@{user['username']}" if user.get("username") else None,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    body = _b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64encode(signature)}"


def read_token(token: str, secret: str) -> dict:
    """Проверяет свой токен и возвращает payload."""
    try:
        body, signature = token.split(".", 1)
    except ValueError as exc:
        raise AuthError("токен повреждён") from exc
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64encode(expected), signature):
        raise AuthError("подпись токена не совпала")
    try:
        payload = json.loads(_b64decode(body))
    except (json.JSONDecodeError, ValueError) as exc:
        raise AuthError("токен не разобрался") from exc
    if int(payload.get("exp", 0)) < time.time():
        raise AuthError("токен истёк")
    return payload
