"""Оценка результата от заявителя после «Готово» — в личке с ботом."""
from __future__ import annotations

import logging

from aiogram import F, Bot, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.exceptions import TelegramBadRequest
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


@router.callback_query(F.data.startswith("fb:"))
async def rate_request(callback: CallbackQuery, bot: Bot) -> None:
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
        ask_msg = await callback.message.answer(FEEDBACK_ASK_REVIEW)
        await db.add_pending_reply(
            callback.message.chat.id, ask_msg.message_id, callback.from_user.id, "feedback_comment", req_id
        )
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
        ask_msg = await callback.message.answer(FEEDBACK_ASK_COMMENT)
        await db.add_pending_reply(
            callback.message.chat.id, ask_msg.message_id, callback.from_user.id, "feedback_comment", req_id
        )


@router.message(F.chat.type == "private", F.reply_to_message)
async def capture_feedback_comment(message: Message, bot: Bot) -> None:
    """Реплай на FEEDBACK_ASK_COMMENT — необязательный, поэтому без текста
    просто пропускаем дальше (SkipHandler), не нагнетаем «пришли текст»."""
    pending = await db.get_pending_reply(message.chat.id, message.reply_to_message.message_id)
    if (
        pending is None
        or pending["kind"] != "feedback_comment"
        or message.from_user is None
        or message.from_user.id != pending["user_id"]
    ):
        raise SkipHandler

    text = (message.text or "").strip()
    if not text:
        raise SkipHandler

    await db.clear_pending_reply(message.chat.id, message.reply_to_message.message_id)
    req_id = pending["req_id"]
    await db.set_feedback_comment(req_id, text)
    await message.reply(FEEDBACK_COMMENT_THANKS)

    if config.dept_chat_id:
        thread = {"message_thread_id": config.dept_thread_id} if config.dept_thread_id else {}
        try:
            await bot.send_message(
                config.dept_chat_id, FEEDBACK_DEPT_COMMENT.format(req_id=req_id, comment=text), **thread
            )
        except Exception:
            log.info("Заявка №%s: комментарий к оценке не доставлен в чат отдела", req_id)
