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
FIELD_STATUS = "Статус"

# Подписи вариантов поля «Статус» в Pyrus. Ключи те же, что в `texts.STATUSES`,
# а подписи — без эмодзи: в реестре Pyrus по ним строят фильтры и отчёты, и
# эмодзи там только мешает. Нет такого варианта в форме — статус не уедет, но
# заявку это не ломает (см. `set_task_status`).
STATUS_CHOICES: dict[str, str] = {
    "new": "На паузе",
    "accepted": "Принята",
    "in_progress": "В работе",
    "done": "Готово",
    "rejected": "Отклонена",
}


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
        # «название поля» → «подпись варианта» → choice_id. Плоского словаря
        # мало: одна и та же подпись может встретиться в двух полях выбора.
        self._choices: dict[str, dict[str, int]] = {}

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
        choices: dict[str, dict[str, int]] = {}
        for field in (body or {}).get("fields", []):
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
            options = self._choices.get(name)
            if options is not None:
                # Поле выбора принимает не текст, а номер варианта.
                choice_id = options.get(str(value))
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
            values = {}
            for field in task.get("fields", []):
                value = field.get("value")
                if isinstance(value, dict):
                    names = value.get("choice_names")
                    value = names[0] if names else value.get("choice_value")
                values[field.get("id")] = value
                values[field.get("name")] = value
            if str(values.get(tg_field)) != str(tg_user_id):
                continue
            mine.append({
                "task_id": task.get("id"),
                "number": values.get(FIELD_REQUEST_NO),
                "topic": values.get(FIELD_TOPIC),
                "project": values.get(FIELD_PROJECT),
                "description": values.get(FIELD_DESCRIPTION),
                "origin": values.get(FIELD_ORIGIN),
                "deadline": values.get(FIELD_DEADLINE),
                "created": task.get("create_date"),
                "closed": bool(task.get("is_closed") or task.get("close_date")),
            })
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

    async def set_task_status(
        self, task_id: int, status_key: str, note: str | None = None
    ) -> bool:
        """Переносит статус заявки в поле «Статус» задачи.

        Смысл — чтобы реестр Pyrus показывал то же, что карточка в чате: там
        статусы уже есть, и второй источник правды никому не нужен.

        Значение поля меняется комментарием (`field_updates`) — отдельного
        метода правки полей в Pyrus нет. Тем же комментарием уходит и заметка
        (кто принял, причина отклонения): так в задаче остаётся история, а не
        только последнее значение.

        «Готово» и «Отклонена» закрывают задачу: заявка отработана, и висеть
        в открытых ей незачем. Реестр по-прежнему отдаёт её с
        `include_archived`, поэтому в личном кабинете она не исчезает.
        """
        label = STATUS_CHOICES.get(status_key)
        if label is None:
            return False
        schema = await self._schema()
        field_id = schema.get(FIELD_STATUS)
        options = self._choices.get(FIELD_STATUS) or {}
        choice_id = options.get(label)
        payload: dict[str, object] = {}
        if field_id is not None and choice_id is not None:
            payload["field_updates"] = [
                {"id": field_id, "value": {"choice_id": choice_id}}
            ]
        else:
            # Поля в форме нет (или в нём нет такого варианта) — статус всё
            # равно пишем текстом: пусть в задаче будет видно, что произошло.
            log.warning(
                "Pyrus: статус %r не записан — нет поля «%s» или варианта",
                label, FIELD_STATUS,
            )
        text = f"Статус: {label}"
        if note:
            text += f"{chr(10)}{note}"
        payload["text"] = text
        if status_key in ("done", "rejected"):
            payload["action"] = "finished"
        result = await self._call(f"/tasks/{task_id}/comments", payload)
        if result is None:
            log.warning("Pyrus: не удалось сменить статус задачи %s", task_id)
            return False
        log.info("Pyrus: задача %s → %s", task_id, label)
        return True
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


async def push_status(task_id: int, status_key: str, note: str | None = None) -> bool:
    """Смена статуса задачи. Никогда не бросает: статус в своей базе уже
    поменялся, и падать из-за внешнего сервиса нельзя."""
    if not pyrus.enabled or not task_id:
        return False
    try:
        return await pyrus.set_task_status(task_id, status_key, note)
    except Exception:  # noqa: BLE001 — см. docstring
        log.exception("Pyrus: не удалось сменить статус задачи %s", task_id)
        return False

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
                # Тот же начальный статус, что у карточки в чате отдела.
                FIELD_STATUS: STATUS_CHOICES["new"],
            })
        text = request_text(req_id, case_title, description, author, source_path, photos)
        return await pyrus.create_text_task(text)
    except Exception:  # noqa: BLE001 — намеренно широко, см. docstring
        log.exception("Pyrus: не удалось создать задачу для заявки %s", req_id)
        return None
