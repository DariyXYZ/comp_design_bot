"""Кнопки статусов под заявкой в чате отдела."""
from __future__ import annotations

import logging

from aiogram import F, Bot, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery

from .. import db
from ..config import config
from ..keyboards import dept_status_buttons
from ..texts import CASES, STATUS_CHANGED_NOTIFY, STATUSES

router = Router()
log = logging.getLogger(__name__)


@router.callback_query(F.data.startswith("st:"))
async def change_status(callback: CallbackQuery, bot: Bot) -> None:
    # Кнопки работают только в чате отдела: пересланная карточка
    # не должна давать право менять статус кому угодно.
    if config.dept_chat_id is None or callback.message.chat.id != config.dept_chat_id:
        await callback.answer("Статусы меняются только в чате отдела", show_alert=True)
        return

    _, raw_id, new_status = callback.data.split(":", 2)
    req_id = int(raw_id)
    if new_status not in STATUSES:
        await callback.answer("Неизвестный статус")
        return

    req = await db.get_request(req_id)
    if req is None:
        await callback.answer("Заявка не найдена")
        return
    if req["status"] == new_status:
        await callback.answer("Уже в этом статусе")
        return

    req = await db.set_status(req_id, new_status)
    await callback.answer(f"Статус: {STATUSES[new_status]}")

    # Перерисовываем карточку целиком из БД тем же рендерером, что и при создании —
    # никакой строковой хирургии по последней строке.
    from .create import request_card  # локальный импорт против цикла

    author = req["full_name"] + (f" (@{req['username']})" if req["username"] else "")
    new_text = request_card(
        req_id, req["case_key"], req["description"], req["source_path"], author, new_status
    )
    try:
        await callback.message.edit_text(
            new_text, reply_markup=dept_status_buttons(req_id, new_status)
        )
    except TelegramBadRequest as e:
        # Гонка двух кликов или карточка старше 48ч: статус в БД уже сменён,
        # автора всё равно уведомим ниже.
        log.warning("Заявка №%s: не удалось обновить карточку: %s", req_id, e)

    case_title = CASES.get(req["case_key"], {}).get("title", req["case_key"])
    try:
        await bot.send_message(
            req["user_id"],
            STATUS_CHANGED_NOTIFY.format(
                req_id=req_id, case_title=case_title, status=STATUSES[new_status]
            ),
        )
    except Exception:
        log.info("Заявка №%s: автору не доставлено уведомление (закрыл личку?)", req_id)
