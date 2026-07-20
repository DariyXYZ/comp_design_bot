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

from .. import db
from ..config import config
from ..keyboards import (
    BTN_CAPABILITIES,
    BTN_CREATE,
    case_picker,
    dept_status_buttons,
    photos_step,
    preview_step,
    source_step,
)
from ..texts import (
    ASK_DESCRIPTION,
    ASK_PHOTOS,
    ASK_SOURCE,
    CANCELED,
    CASES,
    PREVIEW_HEADER,
    SENT_DEPT_FAILED,
    SENT_NO_DEPT,
    SENT_OK,
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


def request_card(
    req_id: int | None,
    case_key: str,
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
    case = CASES.get(case_key, {"title": case_key, "eta": "—"})
    header = f"Заявка №{req_id}" if req_id else "Новая заявка"
    head_lines = [
        f"<b>{header} · {case['title']}</b>",
        f"Ориентир по срокам: {case['eta']}",
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
    await message.answer(
        ASK_DESCRIPTION.format(case_title=CASES[case_key]["title"])
    )


@router.message(Command("new"), F.chat.type == "private")
@router.message(F.text == BTN_CREATE, F.chat.type == "private")
@router.message(F.text == BTN_CAPABILITIES, F.chat.type == "private")
async def choose_case(message: Message, state: FSMContext) -> None:
    # BTN_CAPABILITIES приходит текстом только когда WEBAPP_URL не настроен —
    # тогда показываем выбор задач кнопками, чтобы кнопка не была мёртвой.
    await state.clear()
    await message.answer("Выберите тип задачи:", reply_markup=case_picker())


@router.message(F.web_app_data, F.chat.type == "private")
async def from_webapp(message: Message, state: FSMContext) -> None:
    """Клик по карточке в Mini App: sendData -> {'case': key}."""
    try:
        data = json.loads(message.web_app_data.data)
        case_key = data["case"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    if case_key not in CASES:
        return
    async with _lock(message.from_user.id):
        current = await state.get_state()
        current_data = await state.get_data()
        # Дубль sendData от двойного тапа в Mini App: тот же кейс уже запущен.
        if current == NewRequest.description.state and current_data.get("case_key") == case_key:
            return
        await start_request(message, state, case_key)


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
        data["case_key"],
        data["description"],
        data.get("source_path"),
        author_line(user),
    )
    photos: list[str] = data.get("photos", [])
    note = f"\n\n🖼 Картинок: {len(photos)}" if photos else ""
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


@router.callback_query(NewRequest.preview, F.data == "req:send")
async def send_request(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    user = callback.from_user
    # Лок + очистка состояния внутри лока: двойной тап по «Отправить»
    # не создаст дубль — второй колбэк увидит пустые данные.
    async with _lock(user.id):
        data = await state.get_data()
        if not data.get("case_key"):
            await callback.answer("Заявка уже отправлена")
            return
        await state.clear()

    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except TelegramBadRequest:
        pass

    author = author_line(user)
    req_id = await db.create_request(
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        case_key=data["case_key"],
        description=data["description"],
        photo_file_ids=data.get("photos", []),
        source_path=data.get("source_path"),
    )

    if config.dept_chat_id is None:
        await callback.message.answer(SENT_NO_DEPT.format(req_id=req_id))
        return

    photos: list[str] = data.get("photos", [])
    case_key = data["case_key"]
    description = data["description"]
    source_path = data.get("source_path")
    buttons = dept_status_buttons(req_id)
    thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}

    try:
        if not photos:
            # 0 фото: текст + кнопки в одном сообщении — как и раньше.
            card = request_card(req_id, case_key, description, source_path, author)
            dept_msg = await bot.send_message(config.dept_chat_id, card, reply_markup=buttons, **thread)
        elif len(photos) == 1:
            # 1 фото: подпись к фото = вся карточка + кнопки — тоже одно сообщение.
            caption = request_card(
                req_id, case_key, description, source_path, author, max_len=CAPTION_LIMIT
            )
            dept_msg = await bot.send_photo(
                config.dept_chat_id, photo=photos[0], caption=caption, reply_markup=buttons, **thread
            )
        else:
            # 2+ фото: Telegram не разрешает кнопки на альбоме. Текст — подписью
            # к первому фото альбома (визуально один блок), кнопки — короткой
            # строкой статуса следом, без дублирования всего текста заявки.
            caption = request_card(
                req_id, case_key, description, source_path, author, max_len=CAPTION_LIMIT
            )
            media = [InputMediaPhoto(media=photos[0], caption=caption)] + [
                InputMediaPhoto(media=fid) for fid in photos[1:10]
            ]
            album_msgs = await bot.send_media_group(config.dept_chat_id, media, **thread)
            short = f"Заявка №{req_id} · {CASES[case_key]['title']}\n{STATUSES['new']}"
            dept_msg = await bot.send_message(
                config.dept_chat_id,
                short,
                reply_markup=buttons,
                reply_to_message_id=album_msgs[0].message_id,
                **thread,
            )
    except Exception:
        # Заявка уже в БД (req_id) — не теряем её молча, а честно говорим пользователю.
        log.exception("Заявка №%s сохранена, но не доставлена в чат отдела", req_id)
        await callback.message.answer(SENT_DEPT_FAILED.format(req_id=req_id))
        return

    # Отдельно от отправки: карточка в чат отдела УЖЕ ушла и рабочая (кнопки
    # есть) — если этот чисто вспомогательный write в БД упадёт, заявителю
    # нельзя врать про SENT_DEPT_FAILED (он увидит рабочую карточку в отделе,
    # но получит сообщение "не доставлено" — ложная тревога, дубль заявки).
    try:
        await db.set_dept_message_id(req_id, dept_msg.message_id)
    except Exception:
        log.warning("Заявка №%s: карточка доставлена, но dept_message_id не сохранён", req_id)

    await callback.message.answer(SENT_OK.format(req_id=req_id))
