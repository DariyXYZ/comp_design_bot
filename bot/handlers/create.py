"""FSM создания заявки: задача → описание → фото → исходники → превью → отправка."""
from __future__ import annotations

import asyncio
import html
import json
import logging

from aiogram import F, Bot, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InputMediaPhoto, Message, User

from .. import pyrus
from ..config import config
from ..keyboards import (
    BTN_CAPABILITIES,
    case_picker,
    dept_status_buttons,
    photos_step,
    preview_step,
    source_step,
)
from ..texts import (
    ASK_DESCRIPTION,
    ASK_PHOTOS,
    ASK_PHOTOS_FROM_WEBAPP,
    ASK_SOURCE,
    CANCELED,
    CASES,
    clarifying_block,
    PREVIEW_HEADER,
    SENT_DEPT_FAILED,
    SENT_NO_DEPT,
    SENT_OK,
    SENT_PYRUS_FAILED,
    STATUSES,
)

router = Router()
log = logging.getLogger(__name__)

MAX_DESCRIPTION = 3000
MAX_SOURCE = 500

# Один лок на пользователя: защищает FSM от гонок (альбом фото, дабл-клики).
_user_locks: dict[int, asyncio.Lock] = {}


def _lock(user_id: int) -> asyncio.Lock:
    return _user_locks.setdefault(user_id, asyncio.Lock())


class NewRequest(StatesGroup):
    description = State()
    photos = State()
    source = State()
    preview = State()


def author_line(user: User) -> str:
    name = user.full_name or "—"
    return name + (f" (@{user.username})" if user.username else "")


CAPTION_LIMIT = 1024  # жёсткий лимит Telegram на подпись к фото/альбому


def case_eta(case_title: str) -> str:
    """Ориентир по срокам из карточки темы — по названию, потому что заявка
    из Pyrus несёт только название темы, а не ключ кейса."""
    for case in CASES.values():
        if case.get("title") == case_title:
            return case.get("eta") or "—"
    return "—"


def request_card(
    req_id: int | None,
    case_title: str,
    description: str,
    source_path: str | None,
    author: str,
    status: str = "new",
    max_len: int | None = None,
    actor_line: str | None = None,
) -> str:
    """Единственный рендерер карточки. Весь пользовательский текст экранируется.

    max_len — если задан (для caption к фото/альбому), обрезается только
    описание, чтобы не разрезать HTML-теги в шапке/хвосте карточки.
    actor_line — готовая строка вида "Принял: Имя" / "Завершил: Имя"
    (см. dept.py._actor_display вызовы) или None, если ещё некого показать.
    """
    # Номер заявки = id задачи Pyrus, поэтому заголовок сразу ведёт в неё.
    if req_id:
        header = f'<a href="https://pyrus.com/t#id{req_id}">Заявка №{req_id}</a>'
    else:
        header = "Новая заявка"
    head_lines = [
        f"<b>{header} · {html.escape(case_title)}</b>",
        f"Ориентир по срокам: {case_eta(case_title)}",
        f"От: {html.escape(author)}",
        "",
    ]
    tail_lines = []
    if source_path:
        tail_lines += ["", f"📁 Исходники: <code>{html.escape(source_path)}</code>"]
    tail_lines += ["", STATUSES.get(status, status)]
    if actor_line:
        tail_lines += [html.escape(actor_line)]

    desc = html.escape(description)
    if max_len is not None:
        # +2 — переносы строки между head/desc и между desc/tail (сама сборка ниже).
        fixed_len = len("\n".join(head_lines)) + len("\n".join(tail_lines)) + 2
        budget = max(max_len - fixed_len, 10)
        if len(desc) > budget:
            desc = desc[: budget - 1].rstrip() + "…"

    return "\n".join(head_lines + [desc] + tail_lines)


async def start_request(message: Message, state: FSMContext, case_key: str) -> None:
    """Единая точка входа — из кнопки меню, из Mini App, из deep link."""
    await state.clear()
    await state.update_data(case_key=case_key, photos=[])
    await state.set_state(NewRequest.description)
    text = ASK_DESCRIPTION.format(case_title=CASES[case_key]["title"])
    text += clarifying_block(case_key)
    await message.answer(text)


@router.message(F.text == BTN_CAPABILITIES, F.chat.type == "private")
async def choose_case(message: Message, state: FSMContext) -> None:
    # Единственный вход в чат-версию заявки — и только на случай, когда
    # WEBAPP_URL не настроен: тогда кнопка «Решения и заявки» приходит
    # обычным текстом, и мёртвой она быть не должна. Команда /new и кнопка
    # «Создать заявку» убраны: заявка живёт в Mini App, где есть контекст.
    await state.clear()
    await message.answer("Выберите тип задачи:", reply_markup=case_picker())


MAX_MINIAPP_FIELD = 200  # проект, срок, название основы — короткие строки


def _field(data: dict, key: str, limit: int) -> str | None:
    """Строковое поле из Mini App: только строки, обрезанные по лимиту."""
    value = data.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] or None


def _webapp_photo_guids(data: dict) -> list[str]:
    """guid картинок, загруженных прямо в форме Mini App.

    Файлы через `sendData` не проходят, поэтому браузер грузит их в Pyrus сам, а
    боту достаются только идентификаторы — по ним он привязывает картинки к
    задаче и не спрашивает их повторно в чате.
    """
    raw = _field(data, "photos", 1000) or ""
    guids = [part.strip() for part in raw.split(",") if part.strip()]
    # Шесть — столько же, сколько разрешает форма; лишнее отбрасываем, чтобы
    # чужой payload не заставил бота слать десятки запросов.
    return guids[:6]


def _webapp_description(data: dict) -> str | None:
    """Собирает описание заявки из полей формы Mini App.

    Проект, основа и срок дописываются в шапку описания, а не в отдельные
    колонки: карточка заявки в чате отдела рендерится из описания, и при смене
    статуса эти строки должны остаться на месте. Своих колонок под них в базе
    нет, а добавлять их ради текста, который всё равно только показывается, —
    лишняя миграция.
    """
    description = _field(data, "description", MAX_DESCRIPTION)
    if not description:
        return None
    head = []
    project = _field(data, "project", MAX_MINIAPP_FIELD)
    if project:
        head.append(f"Проект: {project}")
    origin = _field(data, "origin", MAX_MINIAPP_FIELD)
    if origin:
        head.append(f"Основа: {origin}")
    deadline = _field(data, "deadline", MAX_MINIAPP_FIELD)
    if deadline:
        head.append(f"Срок: {deadline}")
    photos = _webapp_photo_guids(data)
    if photos:
        head.append(f"Картинки: {len(photos)} — приложены в задаче Pyrus")
    if not head:
        return description
    return ("\n".join(head) + "\n\n" + description)[:MAX_DESCRIPTION]


@router.message(F.web_app_data, F.chat.type == "private")
async def from_webapp(message: Message, state: FSMContext) -> None:
    """Данные из Mini App.

    Два вида полезной нагрузки, и оба должны работать:

    * `{'case': key}` — выбрана только тема. Дальше обычный опрос в чате.
    * `{'case': key, 'description': ..., ...}` — форма Mini App заполнена.
      Тогда вопросы про описание и исходники уже отвечены, и остаются
      картинки: файлы через `sendData` Telegram не передаёт.
    """
    try:
        data = json.loads(message.web_app_data.data)
    except (json.JSONDecodeError, TypeError):
        return
    if not isinstance(data, dict):
        return
    # Mini App просит показать заявки: своего списка у него нет, пока нет
    # серверной части с проверкой подписи запуска. Отвечаем в чат.
    if data.get("action") == "my_requests":
        from .start import render_user_requests

        await message.answer(await render_user_requests(message.from_user.id))
        return

    case_key = data.get("case")
    if case_key not in CASES:
        return

    description = _webapp_description(data)

    async with _lock(message.from_user.id):
        current = await state.get_state()
        current_data = await state.get_data()
        # Дубль sendData от двойного тапа в Mini App: та же заявка уже идёт.
        if (
            current in (NewRequest.description.state, NewRequest.photos.state)
            and current_data.get("case_key") == case_key
            and current_data.get("description") == description
        ):
            return

        if description is None:
            await start_request(message, state, case_key)
            return

        # Путь к исходникам: сначала то, что указал человек, иначе папка
        # решения, из которого заявка родилась.
        source = _field(data, "source", MAX_SOURCE) or _field(
            data, "origin_path", MAX_SOURCE
        )
        guids = _webapp_photo_guids(data)
        await state.clear()
        await state.update_data(
            case_key=case_key,
            description=description,
            photos=[],
            pyrus_photo_guids=guids,
            source_path=source,
            from_webapp=True,
            # Те же значения, что уже попали в шапку описания, но по
            # отдельности: карточке в чате нужен связный текст, а форме
            # Pyrus — поля, по которым работают фильтры и реестр.
            wa_project=_field(data, "project", MAX_MINIAPP_FIELD),
            wa_origin=_field(data, "origin", MAX_MINIAPP_FIELD),
            wa_origin_path=_field(data, "origin_path", MAX_SOURCE),
            wa_deadline=_field(data, "deadline", MAX_MINIAPP_FIELD),
        )
        # Картинки уже приложены в приложении — спрашивать их снова значит
        # просить человека сделать то, что он только что сделал.
        await state.set_state(
            NewRequest.preview if guids else NewRequest.photos
        )

    if guids:
        await show_preview(message, state, message.from_user)
    else:
        await message.answer(ASK_PHOTOS_FROM_WEBAPP, reply_markup=photos_step())


@router.callback_query(F.data.startswith("case:"))
async def case_chosen(callback: CallbackQuery, state: FSMContext) -> None:
    case_key = callback.data.split(":", 1)[1]
    if case_key not in CASES:
        await callback.answer("Неизвестная задача")
        return
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass  # двойной тап или старое сообщение — не критично
    await start_request(callback.message, state, case_key)


@router.message(NewRequest.description, F.text)
async def got_description(message: Message, state: FSMContext) -> None:
    text = message.text.strip()
    if not text:
        await message.answer("Описание пустое — напишите пару предложений о задаче.")
        return
    if len(text) > MAX_DESCRIPTION:
        await message.answer(
            f"Описание слишком длинное ({len(text)} символов, максимум {MAX_DESCRIPTION}). "
            "Сократите, а детали можно будет добавить в чате с отделом."
        )
        return
    await state.update_data(description=text)
    await state.set_state(NewRequest.photos)
    await message.answer(ASK_PHOTOS, reply_markup=photos_step())


@router.message(NewRequest.description)
async def description_wrong_type(message: Message) -> None:
    await message.answer(
        "Сначала опишите задачу текстом — картинки будут следующим шагом."
    )


@router.message(NewRequest.photos, F.photo)
async def got_photo(message: Message, state: FSMContext) -> None:
    # Альбом приходит серией почти одновременных сообщений — без лока
    # конкурентные get/update теряют часть фото.
    async with _lock(message.from_user.id):
        data = await state.get_data()
        photos: list[str] = data.get("photos", [])
        photos.append(message.photo[-1].file_id)
        await state.update_data(photos=photos)
        first = len(photos) == 1
    if first:
        await message.answer(
            "Картинка принята. Ещё — или жмите «Дальше».", reply_markup=photos_step()
        )


@router.message(NewRequest.photos)
async def photos_wrong_type(message: Message) -> None:
    await message.answer(
        "Пришлите картинку (фото), или жмите «Дальше» / «Пропустить» под сообщением выше."
    )


@router.callback_query(NewRequest.photos, F.data.in_({"photos:done", "photos:skip"}))
async def photos_done(callback: CallbackQuery, state: FSMContext) -> None:
    if callback.data == "photos:skip":
        await state.update_data(photos=[])
    await callback.answer()
    data = await state.get_data()
    # Заявка из формы Mini App: про исходники там уже спрашивали, второй раз
    # задавать тот же вопрос — заставлять человека вводить одно и то же дважды.
    if data.get("from_webapp"):
        await show_preview(callback.message, state, callback.from_user)
        return
    await state.set_state(NewRequest.source)
    await callback.message.answer(ASK_SOURCE, reply_markup=source_step())


@router.message(NewRequest.source, F.text)
async def got_source(message: Message, state: FSMContext) -> None:
    text = message.text.strip()[:MAX_SOURCE]
    await state.update_data(source_path=text or None)
    await show_preview(message, state, message.from_user)


@router.message(NewRequest.source)
async def source_wrong_type(message: Message) -> None:
    await message.answer(
        "Пришлите путь текстом, или жмите «Пропустить» под сообщением выше."
    )


@router.callback_query(NewRequest.source, F.data == "source:skip")
async def source_skipped(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.update_data(source_path=None)
    await show_preview(callback.message, state, callback.from_user)


async def show_preview(message: Message, state: FSMContext, user: User) -> None:
    data = await state.get_data()
    await state.set_state(NewRequest.preview)
    card = request_card(
        None,
        CASES.get(data["case_key"], {}).get("title", data["case_key"]),
        data["description"],
        data.get("source_path"),
        author_line(user),
    )
    photos: list[str] = data.get("photos", [])
    uploaded: list[str] = data.get("pyrus_photo_guids", [])
    total = len(photos) + len(uploaded)
    note = f"\n\n🖼 Картинок: {total}" if total else ""
    await message.answer(
        f"{PREVIEW_HEADER}\n\n{card}{note}", reply_markup=preview_step()
    )


@router.callback_query(F.data == "req:cancel")
async def cancel_request(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass
    await callback.message.answer(CANCELED)



async def _attach_photos_to_pyrus(bot: Bot, task_id: int, file_ids: list[str]) -> None:
    """Качает картинки заявки из Telegram и прикладывает их к задаче Pyrus."""
    if not file_ids:
        return
    files: list[tuple[str, bytes]] = []
    for number, file_id in enumerate(file_ids, start=1):
        try:
            buffer = await bot.download(file_id)
        except Exception:  # noqa: BLE001 — одна битая картинка не повод падать
            log.exception("Не удалось скачать фото %s для Pyrus", file_id)
            continue
        if buffer is None:
            continue
        files.append((f"photo-{number}.jpg", buffer.read()))
    await pyrus.attach_photos(task_id, files)

@router.callback_query(NewRequest.preview, F.data == "req:send")
async def send_request(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    user = callback.from_user
    author = author_line(user)
    # Лок на весь путь до задачи в Pyrus: двойной тап по «Отправить» не
    # создаст дубль — второй колбэк либо ждёт и видит пустые данные, либо
    # видит уже очищенное состояние.
    async with _lock(user.id):
        data = await state.get_data()
        if not data.get("case_key"):
            await callback.answer("Заявка уже отправлена")
            return
        case_title = CASES.get(data["case_key"], {}).get("title", data["case_key"])

        # Pyrus — единственное хранилище: пока задачи нет, заявки нет. Не
        # создалась — состояние не трогаем, человек нажмёт «Отправить» ещё раз.
        req_id = await pyrus.send_request(
            case_title=case_title,
            description=data["description"],
            author=author,
            source_path=data.get("source_path"),
            photos=len(data.get("photos", [])),
            tg_user_id=user.id,
            project=data.get("wa_project"),
            origin=data.get("wa_origin"),
            origin_path=data.get("wa_origin_path"),
            deadline=data.get("wa_deadline"),
        )
        if not req_id:
            await callback.answer(SENT_PYRUS_FAILED, show_alert=True)
            return
        await state.clear()

    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass

    # Картинки — отдельным шагом: Pyrus принимает файлы только по guid,
    # который выдаёт `files/upload`, а качать их из Telegram надо по одному.
    # Заявка к этому моменту уже создана, поэтому сбой загрузки её не рушит.
    await _attach_photos_to_pyrus(bot, req_id, data.get("photos", []))
    await pyrus.attach_uploaded(req_id, data.get("pyrus_photo_guids", []))

    if config.dept_chat_id is None:
        await callback.message.answer(SENT_NO_DEPT.format(req_id=req_id))
        return

    photos: list[str] = data.get("photos", [])
    description = data["description"]
    source_path = data.get("source_path")
    buttons = dept_status_buttons(req_id)
    thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}

    try:
        if not photos:
            # 0 фото: текст + кнопки в одном сообщении — как и раньше.
            card = request_card(req_id, case_title, description, source_path, author)
            dept_msg = await bot.send_message(config.dept_chat_id, card, reply_markup=buttons, **thread)
        elif len(photos) == 1:
            # 1 фото: подпись к фото = вся карточка + кнопки — тоже одно сообщение.
            caption = request_card(
                req_id, case_title, description, source_path, author, max_len=CAPTION_LIMIT
            )
            dept_msg = await bot.send_photo(
                config.dept_chat_id, photo=photos[0], caption=caption, reply_markup=buttons, **thread
            )
        else:
            # 2+ фото: Telegram не разрешает кнопки на альбоме. Текст — подписью
            # к первому фото альбома (визуально один блок), кнопки — короткой
            # строкой статуса следом, без дублирования всего текста заявки.
            caption = request_card(
                req_id, case_title, description, source_path, author, max_len=CAPTION_LIMIT
            )
            media = [InputMediaPhoto(media=photos[0], caption=caption)] + [
                InputMediaPhoto(media=fid) for fid in photos[1:10]
            ]
            album_msgs = await bot.send_media_group(config.dept_chat_id, media, **thread)
            short = f"Заявка №{req_id} · {html.escape(case_title)}\n{STATUSES['new']}"
            dept_msg = await bot.send_message(
                config.dept_chat_id,
                short,
                reply_markup=buttons,
                reply_to_message_id=album_msgs[0].message_id,
                **thread,
            )
    except Exception:
        # Заявка уже в Pyrus — не теряем её молча, а честно говорим пользователю.
        log.exception("Заявка №%s создана, но не доставлена в чат отдела", req_id)
        await callback.message.answer(SENT_DEPT_FAILED.format(req_id=req_id))
        return

    # Карточка в чат уже ушла и рабочая (кнопки есть) — если этот
    # вспомогательный write в Pyrus упадёт, заявителю нельзя врать про
    # SENT_DEPT_FAILED. Без него не перерисуется карточка со статусом, только.
    await pyrus.set_chat_message(req_id, dept_msg.message_id)

    await callback.message.answer(SENT_OK.format(req_id=req_id))
