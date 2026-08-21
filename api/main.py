"""HTTP-API для Mini App: кто вошёл и какие у него заявки.

Появился ради двух вещей, которых статическому приложению не сделать:

1. **Устойчивое имя пользователя.** Клиенты Telegram отдают данные запуска
   непредсказуемо (пустыми после восстановления вебвью из кеша), и профиль
   застревал на «Гость». Здесь подпись проверяется один раз и обменивается на
   свой токен — дальше приложение не зависит от клиента.
2. **Заявки из Pyrus.** Секретный ключ Pyrus в браузер положить нельзя, а без
   проверки подписи любой мог бы запросить чужие заявки, подставив чужой
   Telegram-id.

Живёт рядом с ботом и переиспользует его модули: конфиг (`.env` с токеном и
ключом Pyrus) и клиент Pyrus. Публичный HTTPS завершается на общем gateway
(`/compdesign-api` → этот процесс), сам сервис слушает только localhost.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from bot import pyrus
from bot.config import config

from .auth import AuthError, issue_token, read_token, verify_init_data

log = logging.getLogger(__name__)

# Mini App раздаётся с GitHub Pages, то есть с другого домена — без CORS
# браузер не отдаст ответ приложению. Список закрытый: чужим страницам
# обращаться к этому API незачем.
ALLOWED_ORIGINS = [
    "https://dariyxyz.github.io",
    "http://127.0.0.1:5310",
    "http://localhost:5310",
    "http://localhost:3000",
]

app = FastAPI(title="Comp Design Bot API", version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Telegram-Init-Data"],
)


def _viewer(authorization: str | None) -> dict:
    """Проверяет свой токен из заголовка Authorization."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Нужен токен сессии")
    try:
        return read_token(authorization.split(" ", 1)[1].strip(), config.token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "pyrus": pyrus.pyrus.enabled,
        "form": config.pyrus_form_id,
    }


@app.post("/auth/exchange")
async def exchange(x_telegram_init_data: str = Header(default="")) -> dict:
    """Обменивает подписанные данные запуска на свой токен сессии."""
    try:
        user = verify_init_data(x_telegram_init_data, config.token)
    except AuthError as exc:
        # 401, а не 400: для приложения это именно «вход не подтверждён».
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    token = issue_token(user, config.token)
    payload = read_token(token, config.token)
    return {
        "session_token": token,
        "user": {"id": payload["uid"], "name": payload["name"], "handle": payload["handle"]},
    }


@app.get("/me")
async def me(authorization: str | None = Header(default=None)) -> dict:
    payload = _viewer(authorization)
    return {"id": payload["uid"], "name": payload["name"], "handle": payload["handle"]}


@app.get("/requests")
async def requests(authorization: str | None = Header(default=None)) -> dict:
    """Заявки этого человека из реестра формы Pyrus."""
    payload = _viewer(authorization)
    if not pyrus.pyrus.enabled or not config.pyrus_form_id:
        # Не ошибка: интеграции может не быть, и приложение должно показать
        # пустой список с пояснением, а не экран сбоя.
        return {"requests": [], "source": "disabled"}
    try:
        items = await pyrus.pyrus.list_user_tasks(payload["uid"])
    except Exception:  # noqa: BLE001 — внешний сервис, падать целиком незачем
        log.exception("Pyrus: не удалось получить заявки для %s", payload["uid"])
        raise HTTPException(status_code=502, detail="Pyrus не ответил") from None
    return {"requests": items, "source": "pyrus"}
