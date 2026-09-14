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
* **Заявка уходит в две формы сразу.** Реестр заявок (`PYRUS_FORM_ID`) —
  мастер: только там есть «Telegram ID», по которому личный кабинет отбирает
  заявки человека. Доска отдела (`PYRUS_BOARD_ID`) — зеркало: её видит весь
  отдел, но полей под тему, срок и Telegram ID у неё нет, поэтому всё
  складывается в «Описание задачи» текстом. Зеркало необязательно и никогда не
  ломает основную заявку: не создалось — ушло в лог, и только.
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

# Названия полей доски «Вычислительное Проектирование задачи». Доска плоская:
# ни темы, ни срока, ни Telegram ID у неё нет — всё, что не влезло в отдельные
# поля, уходит текстом в «Описание задачи» (см. board_description).
BOARD_DESCRIPTION = "Описание задачи"
BOARD_PATH = "Путь к проекту"
BOARD_TELEGRAM = "Telegram"
BOARD_STATUS = "Статус"

# Статус, с которым задача появляется на доске. Дальше её ведёт отдел руками:
# промежуточные статусы бот не трогает, у него свои — в чате.
BOARD_STATUS_NEW = "Новая задача"
BOARD_STATUS_DONE = "Выполнено"

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

    async def copy_attachments(self, from_task: int, to_task: int, text: str) -> int:
        """Переносит вложения одной задачи в другую. Возвращает число файлов.

        Guid загруженного файла Pyrus принимает один раз: картинки из Mini
        App уже ушли в реестр, и приложить те же guid к копии на доске нельзя
        (`The attachment file ... already attached`). Поэтому файлы читаются
        из задачи-источника и заливаются заново.
        """
        body = await self._call(f"/tasks/{from_task}")
        attachments = ((body or {}).get("task") or {}).get("attachments") or []
        if not attachments:
            return 0
        files: list[tuple[str, bytes]] = []
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            token = self._token or await self._authorize(session)
            if not token:
                return 0
            headers = {"Authorization": f"Bearer {token}"}
            for att in attachments:
                url = att.get("url") or f"{self._api}/files/download/{att.get('id')}"
                async with session.get(url, headers=headers) as resp:
                    if resp.status != 200:
                        log.warning("Pyrus: файл %s не скачался (%s)", att.get("name"), resp.status)
                        continue
                    # Имя в ответе Pyrus URL-кодировано (пробелы как %20).
                    name = unquote(att.get("name") or "file")
                    files.append((name, await resp.read()))
        return await self.upload_and_attach(to_task, files, text)

    async def close_task(self, task_id: int, note: str) -> bool:
        """Закрывает задачу — заявка отработана.

        Единственное, что переносится из чата в Pyrus. Статусы отдел ведёт в
        Telegram (кнопки под карточкой — с телефона удобнее), а Pyrus
        остаётся реестром. Закрытие — исключение: незакрытая задача висит в
        списках и портит отчёты, а «Готово» в чате означает ровно то же, что
        «закрыта» здесь.

        Закрывается комментарием с `action: finished` — отдельного метода
        закрытия у Pyrus нет. `note` уходит текстом того же комментария,
        чтобы в задаче было видно, кем и почему она закрыта.

        Реестр читается с `include_archived`, поэтому из личного кабинета
        заявка не исчезает.
        """
        result = await self._call(
            f"/tasks/{task_id}/comments", {"text": note, "action": "finished"}
        )
        if result is None:
            log.warning("Pyrus: не удалось закрыть задачу %s", task_id)
            return False
        log.info("Pyrus: задача %s закрыта", task_id)
        return True
    async def close_with_fields(
        self, task_id: int, values: dict[str, object], form_id: int, note: str
    ) -> bool:
        """Закрывает задачу и тем же комментарием меняет поля (`field_updates`).

        Нужно доске отдела: колонки канбана идут по полю «Статус», и просто
        закрытая задача осталась бы в «Новая задача». Закрытие требует прав
        администратора формы у аккаунта бота — иначе Pyrus отвечает
        `access_denied_close_task`, и тогда не применяется и статус: запрос
        отклоняется целиком.
        """
        updates = await self._field_values(values, form_id)
        payload: dict[str, object] = {"text": note, "action": "finished"}
        if updates:
            payload["field_updates"] = updates
        result = await self._call(f"/tasks/{task_id}/comments", payload)
        if result is None:
            log.warning("Pyrus: не удалось закрыть задачу %s", task_id)
            return False
        log.info("Pyrus: задача %s закрыта, поля: %s", task_id, list(values))
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


def board_description(
    req_id: int,
    case_title: str,
    description: str,
    author: str,
    origin_path: str | None = None,
) -> str:
    """Текст в поле «Описание задачи» на доске отдела.

    Доска плоская: отдельных полей под тему и автора у неё нет, а терять их
    нельзя — отдел смотрит на доску и должен видеть заявку целиком. Номер
    заявки первой строкой — по нему задача на доске находится поиском и
    сходится с карточкой в чате отдела. Проект, основа, срок и число
    картинок сюда не дописываются: заявка из Mini App уже несёт их в шапке
    самого описания (см. `_describe` в handlers/create.py), и на доске они
    удваивались.
    """
    lines = [f"Заявка №{req_id} · {case_title}", f"От: {author}"]
    if origin_path:
        lines.append(f"Решение-источник: {origin_path}")
    lines += ["", description]
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


async def copy_attachments(from_task: int, to_task: int) -> int:
    """Переносит картинки из задачи реестра в копию на доске. Никогда не бросает."""
    if not pyrus.enabled or not from_task or not to_task:
        return 0
    try:
        return await pyrus.copy_attachments(
            from_task, to_task, "Картинки из заявки (приложены в Mini App)"
        )
    except Exception:  # noqa: BLE001 — зеркало не рушит заявку
        log.exception("Pyrus: не удалось перенести вложения %s → %s", from_task, to_task)
        return 0


async def close_task(task_id: int, note: str) -> bool:
    """Закрытие задачи. Никогда не бросает: в чате заявка уже переведена, и
    падать из-за внешнего сервиса нельзя."""
    if not pyrus.enabled or not task_id:
        return False
    try:
        return await pyrus.close_task(task_id, note)
    except Exception:  # noqa: BLE001 — см. docstring
        log.exception("Pyrus: не удалось закрыть задачу %s", task_id)
        return False

async def close_board_task(task_id: int, note: str) -> bool:
    """Закрывает копию на доске отдела и переводит «Статус» в «Выполнено» —
    иначе закрытая карточка осталась бы в первой колонке канбана. Аккаунт
    бота должен быть администратором формы доски. Никогда не бросает."""
    if not pyrus.enabled or not task_id or not config.pyrus_board_id:
        return False
    try:
        return await pyrus.close_with_fields(
            task_id, {BOARD_STATUS: BOARD_STATUS_DONE}, config.pyrus_board_id, note
        )
    except Exception:  # noqa: BLE001 — см. docstring
        log.exception("Pyrus: не удалось закрыть задачу %s на доске", task_id)
        return False


async def send_to_board(
    req_id: int,
    case_title: str,
    description: str,
    author: str,
    source_path: str | None,
    photos: int,
    project: str | None = None,
    origin: str | None = None,
    origin_path: str | None = None,
    deadline: str | None = None,
) -> int | None:
    """Зеркалит заявку на доску отдела. Возвращает id задачи или None.

    Зачем отдельно от реестра: доску видит весь отдел, а реестр заявок — нет,
    и ради этого заявка дублируется. Мастером остаётся реестр — только там
    есть «Telegram ID», по которому личный кабинет отбирает заявки человека.

    Блок «Инфо» (ФИО, почта, руководитель) не заполняется: он тянется из
    справочника сотрудников, к которому у бота нет доступа, а сопоставить
    Telegram-аккаунт с карточкой сотрудника бот и так не может.

    Никогда не бросает: доска — зеркало, и её сбой не должен трогать заявку.
    """
    if not pyrus.enabled or not config.pyrus_board_id:
        return None
    try:
        return await pyrus.create_form_task(
            {
                BOARD_DESCRIPTION: board_description(
                    req_id, case_title, description, author, origin_path
                ),
                # Путь к проекту на доске один, а в заявке их два: исходники
                # и путь к решению-источнику. Сюда идут исходники — это то,
                # с чем отдел работает; источник ушёл в описание.
                BOARD_PATH: source_path or project,
                BOARD_TELEGRAM: author,
                BOARD_STATUS: BOARD_STATUS_NEW,
            },
            form_id=config.pyrus_board_id,
        )
    except Exception:  # noqa: BLE001 — зеркало не рушит заявку, см. docstring
        log.exception("Pyrus: не удалось создать задачу на доске для заявки %s", req_id)
        return None


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
    """Отправляет заявку в реестр Pyrus. Возвращает id задачи или None.

    Никогда не бросает: заявка к этому моменту уже принята, и падение из-за
    внешнего сервиса было бы худшим из вариантов.

    Заявки из чата (без Mini App) приходят без проекта, основы и срока — эти
    поля просто остаются пустыми, форма их не требует.

    На доску отдела заявка уходит отдельно — см. `send_to_board`.
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
