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
* **Одна форма — доска отдела, и она же единственное хранилище.** Заявка
  создаётся в форме канбан-доски «Вычислительное Проектирование задачи» и
  дальше живёт только там: у бота нет своей базы. Номер заявки — id задачи
  Pyrus; карточка в чате отдела находится по полю «ID сообщения в чате»;
  статусы кнопок в чате — поле «Статус» (колонки доски); кто принял, кто
  завершил, причина отказа, оценка заявителя — комментарии к задаче.
  «Готово»/«Отклонена» закрывают задачу, откат в промежуточный статус —
  переоткрывает.
"""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import unquote

import aiohttp

from .config import config

log = logging.getLogger(__name__)

AUTH_URL = "https://api.pyrus.com/v4/auth"
DEFAULT_API = "https://api.pyrus.com/v4"
TIMEOUT = aiohttp.ClientTimeout(total=20)

# Названия полей формы доски «Вычислительное Проектирование задачи».
# Переименуют поле в Pyrus — значение перестанет заполняться, и это видно в
# логе; ломать заявку такое расхождение не должно.
FIELD_TOPIC = "Тема"
FIELD_PROJECT = "Проект"
FIELD_DESCRIPTION = "Описание задачи"
FIELD_ORIGIN = "Основа заявки"
FIELD_SOURCE = "Путь к проекту"
FIELD_ORIGIN_PATH = "Путь к решению-источнику"
FIELD_DEADLINE = "Дата"
FIELD_AUTHOR = "Telegram"
FIELD_TG_ID = "Telegram ID"
FIELD_REQUEST_NO = "Номер заявки в боте"
FIELD_STATUS = "Статус"
FIELD_CHAT_MESSAGE = "ID сообщения в чате"

# Колонки канбана. Промежуточные статусы бот не трогает — их отдел ведёт
# руками на доске, у бота свои в чате.
STATUS_NEW = "Новая задача"
STATUS_WORK = "В работе"
STATUS_DONE = "Выполнено"
STATUS_REJECTED = "Отклонена"

# Статус кнопки в чате → колонка доски и что делать с задачей. Кнопок в чате
# больше, чем колонок («принята» и «в работе» — одна колонка): колонка говорит
# отделу, где задача, а кто её принял — в комментарии и на карточке.
CHAT_TO_BOARD: dict[str, tuple[str, str | None]] = {
    "new": (STATUS_NEW, "reopened"),
    "accepted": (STATUS_WORK, "reopened"),
    "in_progress": (STATUS_WORK, "reopened"),
    "done": (STATUS_DONE, "finished"),
    "rejected": (STATUS_REJECTED, "finished"),
}


def _flatten(fields: list[dict]) -> list[dict]:
    """Поля формы одним списком, включая вложенные в разделы.

    На доске отдела поля лежат внутри разделов («Инфо», «Задача») — Pyrus
    отдаёт их как `info.fields` поля типа `title`, и плоский обход их не
    видит: «Описание задачи» тогда просто «нет в форме». Заполняются такие
    поля обычным `id`, как и верхнеуровневые.
    """
    flat: list[dict] = []
    for field in fields:
        flat.append(field)
        nested = (field.get("info") or {}).get("fields") or []
        if nested:
            flat.extend(_flatten(nested))
    return flat


def _task_fields(task: dict) -> list[dict]:
    """Поля задачи одним списком: у поля-раздела значение — `{fields: [...]}`."""
    flat: list[dict] = []
    for field in task.get("fields", []):
        flat.append(field)
        value = field.get("value")
        if isinstance(value, dict) and value.get("fields"):
            flat.extend(_task_fields({"fields": value["fields"]}))
    return flat


class Pyrus:
    """Минимальный клиент: авторизация, схема формы, создание задачи."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._api = DEFAULT_API
        # Один лок на авторизацию: две одновременные заявки не должны
        # логиниться дважды и гасить токен друг друга.
        self._auth_lock = asyncio.Lock()
        # Схемы форм: {form_id: {название поля: id}}. По форме, а не одна на
        # клиент — заявка уходит и в реестр, и на доску отдела, а поля у них
        # разные, и общий кэш перетирал бы одну схему другой.
        self._fields: dict[int, dict[str, int]] = {}
        # {form_id: {«название поля» → {«подпись варианта» → choice_id}}}.
        # Плоского словаря мало: одна и та же подпись может встретиться в двух
        # полях выбора.
        self._choices: dict[int, dict[str, dict[str, int]]] = {}

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

    async def _schema(self, form_id: int | None = None) -> dict[str, int]:
        """Соответствие «название поля → id», прочитанное из самой формы."""
        form_id = form_id or config.pyrus_form_id
        if not form_id:
            return {}
        cached = self._fields.get(form_id)
        if cached is not None:
            return cached
        body = await self._call(f"/forms/{form_id}")
        fields: dict[str, int] = {}
        choices: dict[str, dict[str, int]] = {}
        for field in _flatten((body or {}).get("fields", [])):
            name = (field.get("name") or "").strip()
            if not name:
                continue
            fields[name] = field["id"]
            # Варианты нужны у любого поля выбора, а не только у «Темы»:
            # статус — такое же поле, и особый случай на каждое поле пришлось
            # бы дописывать заново.
            options = (field.get("info") or {}).get("options") or []
            if not options:
                continue
            by_value: dict[str, int] = {}
            for option in options:
                # Удалённые варианты Pyrus продолжает отдавать с флагом
                # deleted: choice_id не переиспользуются. Брать их нельзя —
                # значение уехало бы в вариант, которого в форме уже нет.
                if option.get("deleted"):
                    continue
                value = (option.get("choice_value") or "").strip()
                if value:
                    by_value[value] = option["choice_id"]
            if by_value:
                choices[name] = by_value
        self._fields[form_id] = fields
        self._choices[form_id] = choices
        if fields:
            log.info("Pyrus: схема формы %s прочитана, полей %s", form_id, len(fields))
        return fields

    async def _field_values(
        self, values: dict[str, object], form_id: int | None = None
    ) -> list[dict]:
        """`{название поля: значение}` → список `{id, value}` для API.

        Общий для создания задачи и для `field_updates` в комментарии:
        правила одни — пустое не отправляется, поля выбора принимают не
        текст, а номер варианта, чужое название уходит в лог.
        """
        form_id = form_id or config.pyrus_form_id
        schema = await self._schema(form_id)
        if not schema:
            return []
        choices = self._choices.get(form_id, {})
        fields = []
        for name, value in values.items():
            if value in (None, "", []):
                continue
            field_id = schema.get(name)
            if field_id is None:
                log.warning("Pyrus: в форме нет поля %r — значение не отправлено", name)
                continue
            options = choices.get(name)
            if options is not None:
                # Поле выбора принимает не текст, а номер варианта.
                choice_id = options.get(str(value))
                if choice_id is None:
                    log.warning("Pyrus: в поле «%s» нет варианта %r", name, value)
                    continue
                fields.append({"id": field_id, "value": {"choice_id": choice_id}})
            else:
                fields.append({"id": field_id, "value": value})
        return fields

    async def create_form_task(
        self, values: dict[str, object], form_id: int | None = None
    ) -> int | None:
        """Создаёт задачу по форме. `values` — {название поля: значение}."""
        form_id = form_id or config.pyrus_form_id
        fields = await self._field_values(values, form_id)
        if not fields:
            return None
        body = await self._call("/tasks", {"form_id": form_id, "fields": fields})
        task_id = ((body or {}).get("task") or {}).get("id")
        if task_id:
            log.info("Pyrus: создана задача %s по форме %s", task_id, form_id)
        return task_id

    async def upload_and_attach(
        self, task_id: int, files: list[tuple[str, bytes]], text: str
    ) -> int:
        """Прикрепляет файлы к задаче комментарием. Возвращает число вложенных.

        Двухшаговый путь — требование Pyrus: сначала `files/upload` отдаёт guid,
        и только потом guid можно приложить к задаче. Комментарием, а не при
        создании: заявка уже создана, и потеря картинки не должна её отменять.
        """
        if not files:
            return 0
        guids = []
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            token = self._token or await self._authorize(session)
            if not token:
                return 0
            headers = {"Authorization": f"Bearer {token}"}
            for name, data in files:
                form = aiohttp.FormData()
                form.add_field("file", data, filename=name, content_type="image/jpeg")
                async with session.post(
                    self._api + "/files/upload", data=form, headers=headers
                ) as resp:
                    body = await resp.json(content_type=None)
                    if resp.status != 200 or not body.get("guid"):
                        log.warning("Pyrus: файл %s не загрузился (%s) %s",
                                    name, resp.status, body)
                        continue
                    guids.append(body["guid"])
        if not guids:
            return 0
        result = await self._call(
            f"/tasks/{task_id}/comments",
            {"text": text, "attachments": [{"guid": g} for g in guids]},
        )
        if result is None:
            log.warning("Pyrus: вложения загружены, но комментарий к %s не создан", task_id)
            return 0
        log.info("Pyrus: к задаче %s приложено файлов: %s", task_id, len(guids))
        return len(guids)

    async def list_user_tasks(self, tg_user_id: int) -> list[dict]:
        """Заявки одного человека из реестра формы.

        Фильтрация — на нашей стороне, а не в запросе: `filters` в
        `forms/{id}/register` Pyrus молча игнорирует (проверено — фильтр по
        несуществующему id возвращает весь реестр), и полагаться на него значит
        однажды показать человеку чужие заявки.
        """
        schema = await self._schema()
        tg_field = schema.get(FIELD_TG_ID)
        if not tg_field:
            log.warning("Pyrus: в форме нет поля %r — список заявок недоступен", FIELD_TG_ID)
            return []
        body = await self._call(
            f"/forms/{config.pyrus_form_id}/register", {"include_archived": True}
        )
        tasks = (body or {}).get("tasks", [])
        mine = []
        for task in tasks:
            item = self._as_request(task)
            if item["user_id"] != tg_user_id:
                continue
            # Кабинет и старый API ждут эти имена — оставлены как были.
            item["number"] = item["task_id"]
            item["topic"] = item["case_title"]
            mine.append(item)
        # Свежие сверху: человек ищет последнюю заявку, а не первую.
        mine.sort(key=lambda item: item.get("created") or "", reverse=True)
        return mine

    async def attach_uploaded(self, task_id: int, guids: list[str], text: str) -> int:
        """Прикладывает к задаче файлы, уже загруженные в Pyrus.

        Так приходят картинки из формы Mini App: их загрузил браузер через свой
        роут, и здесь остаётся только привязать guid к задаче — скачивать и
        заливать заново нечего.
        """
        if not guids:
            return 0
        result = await self._call(
            f"/tasks/{task_id}/comments",
            {"text": text, "attachments": [{"guid": g} for g in guids]},
        )
        if result is None:
            log.warning("Pyrus: не удалось приложить готовые файлы к %s", task_id)
            return 0
        log.info("Pyrus: к задаче %s привязано файлов из Mini App: %s", task_id, len(guids))
        return len(guids)

    async def comment(
        self,
        task_id: int,
        text: str = "",
        set_fields: dict[str, object] | None = None,
        action: str | None = None,
    ) -> dict | None:
        """Комментарий к задаче — единственный способ её изменить.

        Отдельных методов «закрыть», «переоткрыть», «поменять поле» у Pyrus
        нет: всё это — один комментарий с `action` и/или `field_updates`.
        `action`: `finished` закрывает, `reopened` открывает снова. Закрытие
        требует прав администратора формы у аккаунта бота — иначе Pyrus
        отвечает `access_denied_close_task`, и поля тоже не применяются.
        Возвращает задачу из ответа или None.
        """
        payload: dict[str, object] = {}
        if text:
            payload["text"] = text
        if set_fields:
            updates = await self._field_values(set_fields)
            if updates:
                payload["field_updates"] = updates
        if action:
            payload["action"] = action
        if not payload:
            return None
        return await self._call(f"/tasks/{task_id}/comments", payload)

    async def get_task(self, task_id: int) -> dict | None:
        """Задача как заявка: поля формы под своими именами + служебное.

        Возвращает словарь, которым живут обработчики бота (карточка в чате,
        уведомления, оценка) — раньше это была строка SQLite.
        """
        body = await self._call(f"/tasks/{task_id}")
        task = (body or {}).get("task")
        if not task:
            return None
        return self._as_request(task)

    @staticmethod
    def _as_request(task: dict) -> dict:
        values: dict[str, object] = {}
        for field in _task_fields(task):
            value = field.get("value")
            if isinstance(value, dict):
                if "fields" in value:
                    continue
                names = value.get("choice_names")
                value = names[0] if names else value.get("choice_value")
            values[field.get("name")] = value
        tg_id = values.get(FIELD_TG_ID)
        chat_message = values.get(FIELD_CHAT_MESSAGE)
        return {
            "task_id": task.get("id"),
            "user_id": int(tg_id) if tg_id not in (None, "") else None,
            "author": values.get(FIELD_AUTHOR) or "",
            "case_title": values.get(FIELD_TOPIC) or "",
            "description": values.get(FIELD_DESCRIPTION) or "",
            "source_path": values.get(FIELD_SOURCE),
            "project": values.get(FIELD_PROJECT),
            "origin": values.get(FIELD_ORIGIN),
            "deadline": values.get(FIELD_DEADLINE),
            "board_status": values.get(FIELD_STATUS) or "",
            "chat_message_id": int(chat_message) if chat_message not in (None, "") else None,
            "photos": len(task.get("attachments") or []),
            "created": task.get("create_date"),
            "closed": bool(task.get("is_closed") or task.get("close_date")),
        }



pyrus = Pyrus()


async def attach_photos(
    task_id: int, files: list[tuple[str, bytes]]
) -> int:
    """Докладывает картинки заявки в задачу Pyrus. Ошибки только в лог."""
    if not pyrus.enabled or not task_id or not files:
        return 0
    try:
        return await pyrus.upload_and_attach(
            task_id, files, "Картинки из заявки (присланы боту в Telegram)"
        )
    except Exception:  # noqa: BLE001 — заявка уже создана, падать нельзя
        log.exception("Pyrus: не удалось приложить картинки к задаче %s", task_id)
        return 0


async def attach_uploaded(task_id: int, guids: list[str]) -> int:
    """Привязывает к задаче картинки, загруженные из формы Mini App."""
    if not pyrus.enabled or not task_id or not guids:
        return 0
    try:
        return await pyrus.attach_uploaded(
            task_id, guids, "Картинки из заявки (приложены в Mini App)"
        )
    except Exception:  # noqa: BLE001 — заявка уже создана, падать нельзя
        log.exception("Pyrus: не удалось привязать картинки к задаче %s", task_id)
        return 0


async def get_request(task_id: int) -> dict | None:
    """Заявка по номеру. Никогда не бросает: нет задачи или Pyrus лёг — None."""
    if not pyrus.enabled or not task_id:
        return None
    try:
        return await pyrus.get_task(task_id)
    except Exception:  # noqa: BLE001 — см. docstring
        log.exception("Pyrus: не удалось прочитать задачу %s", task_id)
        return None


async def list_user_requests(tg_user_id: int) -> list[dict]:
    """Заявки человека, свежие сверху. Никогда не бросает."""
    if not pyrus.enabled:
        return []
    try:
        return await pyrus.list_user_tasks(tg_user_id)
    except Exception:  # noqa: BLE001
        log.exception("Pyrus: не удалось получить заявки для %s", tg_user_id)
        return []


async def set_chat_message(task_id: int, message_id: int) -> bool:
    """Запоминает в задаче карточку в чате отдела — по ней её перерисовывают."""
    if not pyrus.enabled or not task_id:
        return False
    try:
        result = await pyrus.comment(task_id, set_fields={FIELD_CHAT_MESSAGE: message_id})
        return result is not None
    except Exception:  # noqa: BLE001
        log.exception("Pyrus: не удалось записать карточку чата в задачу %s", task_id)
        return False


async def set_status(task_id: int, chat_status: str, note: str, closed: bool) -> bool:
    """Переводит задачу в колонку по статусу кнопки в чате.

    «Готово»/«Отклонена» закрывают задачу; любой другой статус у закрытой
    задачи переоткрывает её — иначе она ушла бы из активных на доске, оставаясь
    «в работе» в чате. Открытую задачу `reopened` не трогает. Никогда не
    бросает: в чате статус уже сменён.
    """
    if not pyrus.enabled or not task_id:
        return False
    board, action = CHAT_TO_BOARD.get(chat_status, (None, None))
    if board is None:
        return False
    if action == "reopened" and not closed:
        action = None
    try:
        result = await pyrus.comment(task_id, note, {FIELD_STATUS: board}, action)
        if result is None:
            log.warning("Pyrus: задача %s не переведена в «%s»", task_id, board)
            return False
        log.info("Pyrus: задача %s → «%s»%s", task_id, board, f" ({action})" if action else "")
        return True
    except Exception:  # noqa: BLE001
        log.exception("Pyrus: не удалось сменить статус задачи %s", task_id)
        return False


async def add_comment(task_id: int, text: str) -> bool:
    """Запись в историю задачи (кто принял, причина отказа, оценка). Никогда не бросает."""
    if not pyrus.enabled or not task_id or not text:
        return False
    try:
        return (await pyrus.comment(task_id, text)) is not None
    except Exception:  # noqa: BLE001
        log.exception("Pyrus: не удалось добавить комментарий к задаче %s", task_id)
        return False


async def send_request(
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
    """Создаёт заявку на доске отдела. Возвращает id задачи — он же номер
    заявки везде дальше — или None, если Pyrus не ответил.

    Заявки из чата (без Mini App) приходят без проекта, основы и срока — эти
    поля просто остаются пустыми, форма их не требует.
    """
    if not pyrus.enabled or not config.pyrus_form_id:
        return None
    try:
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
            FIELD_STATUS: STATUS_NEW,
        })
    except Exception:  # noqa: BLE001 — намеренно широко, см. docstring
        log.exception("Pyrus: не удалось создать задачу для заявки от %s", author)
        return None
