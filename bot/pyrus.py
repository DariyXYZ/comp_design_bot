"""Интеграция с Pyrus: отправленная заявка становится задачей в Pyrus.

Зачем именно так:

* **Токен живёт недолго и не хранится на диске.** `POST /auth` отдаёт
  `access_token`; он кэшируется в памяти процесса и перезапрашивается, когда
  Pyrus отвечает 401. Класть его в базу смысла нет — бот перезапускается чаще,
  чем истекает токен.
* **Сбой Pyrus не должен ломать заявку.** Все ошибки гасятся здесь и уходят в
  лог: заявка уже создана в своей базе и отправлена в чат отдела, и терять её
  из-за недоступности внешнего сервиса нельзя. Поэтому публичные функции
  возвращают `None` вместо исключения.
* **Интеграция выключается пустым `.env`.** Нет логина или ключа — `enabled`
  ложь, никаких запросов не уходит, поведение бота прежнее.

Форма пока не подключена: формы в Pyrus создаются только в интерфейсе, API их
не умеет. Как только форма появится и `PYRUS_FORM_ID` будет заполнен, задачи
поедут в неё через `fields` (см. `create_request_task`), а до тех
пор — обычной задачей с текстом карточки.
"""
from __future__ import annotations

import asyncio
import logging

import aiohttp

from .config import config

log = logging.getLogger(__name__)

AUTH_URL = "https://api.pyrus.com/v4/auth"
DEFAULT_API = "https://api.pyrus.com/v4"
TIMEOUT = aiohttp.ClientTimeout(total=20)


class Pyrus:
    """Минимальный клиент: авторизация и создание задачи."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._api = DEFAULT_API
        # Один лок на авторизацию: две одновременные заявки не должны
        # логиниться дважды и гасить токен друг друга.
        self._auth_lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return bool(config.pyrus_login and config.pyrus_security_key)

    async def _authorize(self, session: aiohttp.ClientSession) -> str | None:
        async with self._auth_lock:
            if self._token:
                return self._token
            payload = {
                "login": config.pyrus_login,
                "security_key": config.pyrus_security_key,
            }
            async with session.post(AUTH_URL, json=payload) as resp:
                body = await resp.json(content_type=None)
                if resp.status != 200:
                    log.warning("Pyrus: авторизация не удалась (%s) %s", resp.status, body)
                    return None
            self._token = body.get("access_token")
            # Pyrus может вернуть свой адрес API (у крупных аккаунтов он
            # отличается) — уважаем его, а не зашитый по умолчанию.
            self._api = (body.get("api_url") or DEFAULT_API).rstrip("/")
            return self._token

    async def _post(self, path: str, payload: dict) -> dict | None:
        """POST с одной повторной попыткой после переавторизации."""
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            for attempt in (1, 2):
                token = self._token or await self._authorize(session)
                if not token:
                    return None
                headers = {"Authorization": f"Bearer {token}"}
                async with session.post(
                    self._api + path, json=payload, headers=headers
                ) as resp:
                    body = await resp.json(content_type=None)
                    if resp.status == 200:
                        return body
                    # Токен истёк — сбрасываем и пробуем ещё раз, но только раз.
                    if resp.status == 401 and attempt == 1:
                        self._token = None
                        continue
                    log.warning("Pyrus: %s ответил %s: %s", path, resp.status, body)
                    return None
        return None

    async def create_task(self, text: str, form_id: int | None = None,
                          fields: list[dict] | None = None) -> int | None:
        """Создаёт задачу и возвращает её id.

        С `form_id` задача попадает в реестр формы и получает её поля; без
        него это обычная задача с текстом — так работает, пока формы нет.
        """
        payload: dict = {"text": text}
        if form_id:
            payload = {"form_id": form_id, "fields": fields or []}
        body = await self._post("/tasks", payload)
        if not body:
            return None
        task_id = (body.get("task") or {}).get("id")
        if task_id:
            log.info("Pyrus: создана задача %s", task_id)
        return task_id


pyrus = Pyrus()


def request_text(
    req_id: int,
    case_title: str,
    description: str,
    author: str,
    source_path: str | None,
    photos: int,
) -> str:
    """Текст задачи в Pyrus.

    Отдельно от карточки для Telegram: там HTML-разметка и эмодзи статусов,
    здесь нужен простой текст. Номер заявки в первой строке — по нему задача
    находится поиском и связывается с сообщением в чате отдела.
    """
    lines = [
        f"Заявка №{req_id} · {case_title}",
        f"От: {author}",
        "",
        description,
    ]
    if source_path:
        lines += ["", f"Исходники: {source_path}"]
    if photos:
        lines += ["", f"Картинок в заявке: {photos} (в чате бота)"]
    return "\n".join(lines)


async def send_request(
    req_id: int,
    case_title: str,
    description: str,
    author: str,
    source_path: str | None,
    photos: int,
) -> int | None:
    """Отправляет заявку в Pyrus. Возвращает id задачи или None.

    Никогда не бросает: заявка к этому моменту уже принята, и падение из-за
    внешнего сервиса было бы худшим из вариантов.
    """
    if not pyrus.enabled:
        return None
    text = request_text(req_id, case_title, description, author, source_path, photos)
    try:
        return await pyrus.create_task(text, form_id=config.pyrus_form_id)
    except Exception:  # noqa: BLE001 — намеренно широко, см. docstring
        log.exception("Pyrus: не удалось создать задачу для заявки %s", req_id)
        return None
