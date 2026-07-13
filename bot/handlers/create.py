"""FSM создания заявки: кейс → описание → фото → исходники → превью → отправка."""
from __future__ import annotations

import json

from aiogram import F, Bot, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InputMediaPhoto, Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

from .. import db
from ..config import config
from ..keyboards import (
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
    SENT_NO_DEPT,
    SENT_OK,
    STATUSES,
)

router = Router()


class NewRequest(StatesGroup):
    description = State()
    photos = State()
    source = State()
    preview = State()


def request_card(
    req_id: int | None,
    case_key: str,
    description: str,
    source_path: str | None,
    author: str,
    status: str = "new",
) -> str:
    case = CASES.get(case_key, {"title": case_key, "eta": "—"})
    header = f"Заявка №{req_id}" if req_id else "Новая заявка"
    lines = [
        f"<b>{header} · {case['title']}</b>",
        f"Ориентир по срокам: {case['eta']}",
        f"От: {author}",
        "",
        description,
    ]
    if source_path:
        lines += ["", f"📁 Исходники: <code>{source_path}</code>"]
    lines += ["", STATUSES.get(status, status)]
    return "\n".join(lines)


async def start_request(message: Message, state: FSMContext, case_key: str) -> None:
    """Единая точка входа — из кнопки меню, из Mini App, из deep link."""
    await state.clear()
    await state.update_data(case_key=case_key, photos=[])
    await state.set_state(NewRequest.description)
    await message.answer(
        ASK_DESCRIPTION.format(case_title=CASES[case_key]["title"])
    )


@router.message(F.text == BTN_CREATE, F.chat.type == "private")
async def choose_case(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Выберите кейс, похожий на вашу задачу:", reply_markup=case_picker())


@router.message(F.web_app_data)
async def from_webapp(message: Message, state: FSMContext) -> None:
    """Клик по карточке в Mini App: sendData -> {'case': key}."""
    try:
        data = json.loads(message.web_app_data.data)
        case_key = data["case"]
    except (json.JSONDecodeError, KeyError):
        return
    if case_key in CASES:
        await start_request(message, state, case_key)


@router.callback_query(F.data.startswith("case:"))
async def case_chosen(callback: CallbackQuery, state: FSMContext) -> None:
    case_key = callback.data.split(":", 1)[1]
    if case_key not in CASES:
        await callback.answer("Неизвестный кейс")
        return
    await callback.answer()
    await callback.message.edit_reply_markup(reply_markup=None)
    await start_request(callback.message, state, case_key)


@router.message(NewRequest.description, F.text)
async def got_description(message: Message, state: FSMContext) -> None:
    await state.update_data(description=message.text.strip())
    await state.set_state(NewRequest.photos)
    await message.answer(ASK_PHOTOS, reply_markup=photos_step())


@router.message(NewRequest.photos, F.photo)
async def got_photo(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    photos: list[str] = data.get("photos", [])
    photos.append(message.photo[-1].file_id)
    await state.update_data(photos=photos)
    # Альбом приходит серией сообщений — отвечаем только на первое, чтобы не спамить.
    if len(photos) == 1:
        await message.answer(
            "Картинка принята. Ещё — или жмите «Дальше».", reply_markup=photos_step()
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
    await state.update_data(source_path=message.text.strip())
    await show_preview(message, state)


@router.callback_query(NewRequest.source, F.data == "source:skip")
async def source_skipped(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.update_data(source_path=None)
    await show_preview(callback.message, state)


async def show_preview(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    await state.set_state(NewRequest.preview)
    author = message.chat.full_name or "—"
    card = request_card(
        None, data["case_key"], data["description"], data.get("source_path"), author
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
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer(CANCELED)


@router.callback_query(NewRequest.preview, F.data == "req:send")
async def send_request(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    await state.clear()
    await callback.answer()
    await callback.message.edit_reply_markup(reply_markup=None)

    user = callback.from_user
    author = user.full_name + (f" (@{user.username})" if user.username else "")
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

    card = request_card(
        req_id, data["case_key"], data["description"], data.get("source_path"), author
    )
    thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}
    dept_msg = await bot.send_message(
        config.dept_chat_id,
        card,
        reply_markup=dept_status_buttons(req_id, "new"),
        **thread,
    )
    await db.set_dept_message_id(req_id, dept_msg.message_id)

    photos: list[str] = data.get("photos", [])
    if photos:
        media = [InputMediaPhoto(media=fid) for fid in photos[:10]]
        await bot.send_media_group(
            config.dept_chat_id,
            media,
            reply_to_message_id=dept_msg.message_id,
            **thread,
        )

    await callback.message.answer(SENT_OK.format(req_id=req_id))
