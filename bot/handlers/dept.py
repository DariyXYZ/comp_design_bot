"""Кнопки статусов под заявкой в чате отдела."""
from __future__ import annotations

from aiogram import F, Bot, Router
from aiogram.types import CallbackQuery

from .. import db
from ..keyboards import dept_status_buttons
from ..texts import CASES, STATUS_CHANGED_NOTIFY, STATUSES

router = Router()


@router.callback_query(F.data.startswith("st:"))
async def change_status(callback: CallbackQuery, bot: Bot) -> None:
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

    # Обновляем последнюю строку карточки (там текущий статус) и кнопки.
    lines = callback.message.html_text.rsplit("\n", 1)
    new_text = f"{lines[0]}\n{STATUSES[new_status]}"
    await callback.message.edit_text(
        new_text, reply_markup=dept_status_buttons(req_id, new_status)
    )

    # Уведомляем автора в личку. Может не дойти, если автор заблокировал бота.
    case_title = CASES.get(req["case_key"], {}).get("title", req["case_key"])
    try:
        await bot.send_message(
            req["user_id"],
            STATUS_CHANGED_NOTIFY.format(
                req_id=req_id, case_title=case_title, status=STATUSES[new_status]
            ),
        )
    except Exception:
        pass
