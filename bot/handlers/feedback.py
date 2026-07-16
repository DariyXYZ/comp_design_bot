"""Оценка результата от заявителя после «Готово» — в личке с ботом."""
from __future__ import annotations

import logging

from aiogram import F, Bot, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from .. import db
from ..config import config
from ..keyboards import feedback_review_only_button
from ..texts import (
    CASES,
    FEEDBACK_ASK_COMMENT,
    FEEDBACK_ASK_REVIEW,
    FEEDBACK_COMMENT_THANKS,
    FEEDBACK_DEPT_COMMENT,
    FEEDBACK_DEPT_NOTE,
)

router = Router()
log = logging.getLogger(__name__)

_LABELS = {"up": "👍", "down": "👎"}


class FeedbackComment(StatesGroup):
    # Обычный текст в чат, как описание заявки в create.py — не реплай:
    # пользователи путали реплай с «что-то сломалось».
    text = State()


@router.callback_query(F.data.startswith("fb:"))
async def rate_request(callback: CallbackQuery, bot: Bot, state: FSMContext) -> None:
    _, raw_id, value = callback.data.split(":", 2)
    req_id = int(raw_id)

    req = await db.get_request(req_id)
    # Кнопки уходят персонально автору заявки личным сообщением — но на
    # всякий случай не доверяем чужому callback.from_user.id вслепую.
    if req is None or callback.from_user.id != req["user_id"]:
        await callback.answer("Не удалось сохранить", show_alert=True)
        return

    if value == "review":
        # Отзыв не привязан к 👍/👎 — можно оставить независимо от оценки
        # (и даже без неё вовсе), поэтому своя ветка без проверки req["feedback"].
        await callback.answer()
        await state.set_state(FeedbackComment.text)
        await state.update_data(req_id=req_id)
        await callback.message.answer(FEEDBACK_ASK_REVIEW)
        return

    if value not in _LABELS:
        await callback.answer("Неизвестная оценка")
        return
    if req.get("feedback"):
        await callback.answer("Уже оценено, спасибо!")
        return

    await db.set_feedback(req_id, value)
    try:
        # 👍/👎 больше не нажать (уже сохранено), но «Оставить отзыв» оставляем.
        await callback.message.edit_reply_markup(reply_markup=feedback_review_only_button(req_id))
    except TelegramBadRequest:
        pass
    await callback.answer("Спасибо за оценку!")

    if config.dept_chat_id:
        case_title = CASES.get(req["case_key"], {}).get("title", req["case_key"])
        thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}
        try:
            await bot.send_message(
                config.dept_chat_id,
                FEEDBACK_DEPT_NOTE.format(req_id=req_id, case_title=case_title, label=_LABELS[value]),
                **thread,
            )
        except Exception:
            log.info("Заявка №%s: оценка не доставлена в чат отдела", req_id)

    if value == "down":
        await state.set_state(FeedbackComment.text)
        await state.update_data(req_id=req_id)
        await callback.message.answer(FEEDBACK_ASK_COMMENT)


@router.message(FeedbackComment.text, F.text)
async def capture_feedback_comment(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    req_id = data.get("req_id")
    await state.clear()
    text = message.text.strip()
    if not req_id or not text:
        return

    await db.set_feedback_comment(req_id, text)
    await message.answer(FEEDBACK_COMMENT_THANKS)

    if config.dept_chat_id:
        thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}
        try:
            await bot.send_message(
                config.dept_chat_id, FEEDBACK_DEPT_COMMENT.format(req_id=req_id, comment=text), **thread
            )
        except Exception:
            log.info("Заявка №%s: отзыв не доставлен в чат отдела", req_id)


@router.message(FeedbackComment.text)
async def feedback_comment_wrong_type(message: Message) -> None:
    await message.answer("Пришли отзыв текстом, пожалуйста — или просто не отвечай, это необязательно.")
