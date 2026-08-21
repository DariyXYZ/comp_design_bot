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
* **Поля формы ищутся по названию, а не по вшитым id.** Коды полей Pyrus через
  API не отдаёт (`code: null` у всех), а id меняется, если поле пересоздать —
  и тогда заявки начали бы уезжать в чужие поля молча. Названия при этом
  видны человеку в конструкторе, поэтому расхождение сразу заметно. Схема
  формы читается один раз и кэшируется на время жизни процесса.
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

# Названия полей в форме «Заявка в отдел вычислительного проектирования».
# Переименуют поле в Pyrus — значение перестанет заполняться, и это видно в
# логе; ломать заявку такое расхождение не должно.
FIELD_TOPIC = "Тема"
FIELD_PROJECT = "Проект"
FIELD_DESCRIPTION = "Описание и ожидаемый результат"
FIELD_ORIGIN = "Основа заявки"
FIELD_SOURCE = "Путь к исходникам"
FIELD_ORIGIN_PATH = "Путь к решению-источнику"
FIELD_DEADLINE = "Дата"
FIELD_AUTHOR = "Автор в Telegram"
FIELD_TG_ID = "Telegram ID"
FIELD_REQUEST_NO = "Номер заявки в боте"


class Pyrus:
    """Минимальный клиент: авторизация, схема формы, создание задачи."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._api = DEFAULT_API
        # Один лок на авторизацию: две одновременные заявки не должны
        # логиниться дважды и гасить токен друг друга.
        self._auth_lock = asyncio.Lock()
        # Схема формы: {название поля: id} и {название темы: choice_id}.
        self._fields: dict[str, int] | None = None
        self._choices: dict[str, int] = {}

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

    async def _call(self, path: str, payload: dict | None = None) -> dict | None:
        """Запрос с одной повторной попыткой после переавторизации."""
        method = "POST" if payload is not None else "GET"
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            for attempt in (1, 2):
                token = self._token or await self._authorize(session)
                if not token:
                    return None
                headers = {"Authorization": f"Bearer {token}"}
                async with session.request(
                    method, self._api + path, json=payload, headers=headers
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

    async def _schema(self) -> dict[str, int]:
        """Соответствие «название поля → id», прочитанное из самой формы."""
        if self._fields is not None:
            return self._fields
        body = await self._call(f"/forms/{config.pyrus_form_id}")
        fields: dict[str, int] = {}
        choices: dict[str, int] = {}
        for field in (body or {}).get("fields", []):
            name = (field.get("name") or "").strip()
            if not name:
                continue
            fields[name] = field["id"]
            if name == FIELD_TOPIC:
                for option in (field.get("info") or {}).get("options", []):
                    # Удалённые варианты Pyrus продолжает отдавать с флагом
                    # deleted: choice_id не переиспользуются. Брать их нельзя —
                    # значение уехало бы в вариант, которого в форме уже нет.
                    if option.get("deleted"):
                        continue
                    value = (option.get("choice_value") or "").strip()
                    if value:
                        choices[value] = option["choice_id"]
        self._fields = fields
        self._choices = choices
        if fields:
            log.info("Pyrus: схема формы %s прочитана, полей %s",
                     config.pyrus_form_id, len(fields))
        return fields

    async def create_form_task(self, values: dict[str, object]) -> int | None:
        """Создаёт задачу по форме. `values` — {название поля: значение}."""
        schema = await self._schema()
        if not schema:
            return None
        fields = []
        for name, value in values.items():
            if value in (None, "", []):
                continue
            field_id = schema.get(name)
            if field_id is None:
                log.warning("Pyrus: в форме нет поля %r — значение не отправлено", name)
                continue
            if name == FIELD_TOPIC:
                # Поле выбора принимает не текст, а номер варианта.
                choice_id = self._choices.get(str(value))
                if choice_id is None:
                    log.warning("Pyrus: в поле «%s» нет варианта %r", name, value)
                    continue
                fields.append({"id": field_id, "value": {"choice_id": choice_id}})
            else:
                fields.append({"id": field_id, "value": value})
        body = await self._call("/tasks", {"form_id": config.pyrus_form_id, "fields": fields})
        task_id = ((body or {}).get("task") or {}).get("id")
        if task_id:
            log.info("Pyrus: создана задача %s по форме", task_id)
        return task_id

    async def create_text_task(self, text: str) -> int | None:
        """Обычная задача с текстом — путь на случай, когда формы нет."""
        body = await self._call("/tasks", {"text": text})
        task_id = ((body or {}).get("task") or {}).get("id")
        if task_id:
            log.info("Pyrus: создана задача %s текстом", task_id)
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
    """Текст задачи в Pyrus, когда форма не подключена.

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
    tg_user_id: int | None = None,
    project: str | None = None,
    origin: str | None = None,
    origin_path: str | None = None,
    deadline: str | None = None,
) -> int | None:
    """Отправляет заявку в Pyrus. Возвращает id задачи или None.

    Никогда не бросает: заявка к этому моменту уже принята, и падение из-за
    внешнего сервиса было бы худшим из вариантов.

    Заявки из чата (без Mini App) приходят без проекта, основы и срока — эти
    поля просто остаются пустыми, форма их не требует.
    """
    if not pyrus.enabled:
        return None
    try:
        if config.pyrus_form_id:
            return await pyrus.create_form_task({
                FIELD_TOPIC: case_title,
                FIELD_PROJECT: project,
                FIELD_DESCRIPTION: description,
                FIELD_ORIGIN: origin,
                FIELD_SOURCE: source_path,
                FIELD_ORIGIN_PATH: origin_path,
                FIELD_DEADLINE: deadline,
                FIELD_AUTHOR: author,
                FIELD_TG_ID: tg_user_id,
                FIELD_REQUEST_NO: req_id,
            })
        text = request_text(req_id, case_title, description, author, source_path, photos)
        return await pyrus.create_text_task(text)
    except Exception:  # noqa: BLE001 — намеренно широко, см. docstring
        log.exception("Pyrus: не удалось создать задачу для заявки %s", req_id)
        return None
