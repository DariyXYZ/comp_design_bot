"""Кнопки статусов под заявкой в чате отдела."""
from __future__ import annotations

import json
import logging

from aiogram import F, Bot, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, Message, User

from .. import db
from ..config import config
from ..keyboards import dept_status_buttons
from ..texts import (
    ACCEPTED_CONTACT_LINE,
    ACTOR_CONTACT_SAVED,
    ASK_ACTOR_CONTACT,
    CASES,
    DONE_CONTACT_LINE,
    DONE_CONTACT_UNKNOWN,
    STATUS_CHANGED_NOTIFY,
    STATUSES,
)

router = Router()
log = logging.getLogger(__name__)

# Кто должен прислать контакт текстом (нет @username) — user_id -> (req_id, prefix).
# prefix — "accepted_by" или "finished_by", смотря на какой кнопке спросили.
# Не FSM, лёгкий словарь — состояние переживает только текущий запуск процесса.
AWAITING_CONTACT: dict[int, tuple[int, str]] = {}
# Однажды присланный контакт запоминаем за user_id — второй раз не переспрашиваем,
# независимо от того, в роли принявшего или завершившего он снова окажется.
KNOWN_CONTACTS: dict[int, str] = {}


def _actor_display(req: dict, prefix: str) -> str | None:
    """Лучшее, что можно показать для связи по этому актёру; None — неизвестен."""
    if req.get(f"{prefix}_contact"):
        return req[f"{prefix}_contact"]
    if req.get(f"{prefix}_username"):
        return f"@{req[f'{prefix}_username']}"
    return req.get(f"{prefix}_name") or None


async def _capture_actor(callback: CallbackQuery, req_id: int, prefix: str) -> None:
    """Фиксирует, кто нажал кнопку (accepted_by/finished_by), и если у него нет
    @username — просит прислать контакт текстом в чат отдела (один раз на
    человека, дальше берём из KNOWN_CONTACTS)."""
    actor: User = callback.from_user
    await db.set_actor(req_id, prefix, actor.id, actor.username, actor.full_name)
    if not actor.username:
        cached = KNOWN_CONTACTS.get(actor.id)
        if cached:
            await db.set_actor_contact(req_id, prefix, cached)
        else:
            AWAITING_CONTACT[actor.id] = (req_id, prefix)
            await callback.message.answer(
                ASK_ACTOR_CONTACT.format(name=actor.full_name, req_id=req_id)
            )


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

    # Telegram сам говорит боту, кто нажал кнопку (callback.from_user —
    # серверные данные, не подделать), так что user_id/имя всегда надёжны.
    # "Принята" — фиксирует, к кому обращаться с вопросами по ходу работы;
    # "Готово" — фиксирует, у кого забирать готовое решение. Это не всегда
    # один и тот же человек, поэтому оба перехода пишут в свою пару колонок.
    if new_status == "accepted":
        await _capture_actor(callback, req_id, "accepted_by")
    elif new_status == "done":
        await _capture_actor(callback, req_id, "finished_by")

    req = await db.set_status(req_id, new_status)
    await callback.answer(f"Статус: {STATUSES[new_status]}")

    # Перерисовываем тем же рендерером, что и при создании — никакой строковой
    # хирургии. Способ редактирования зависит от того, каким сообщением
    # была отправлена заявка (см. create.send_request): текст / подпись к
    # фото / короткая строка статуса под альбомом (кнопки на альбом нельзя).
    from .create import CAPTION_LIMIT, request_card  # локальный импорт против цикла

    author = req["full_name"] + (f" (@{req['username']})" if req["username"] else "")
    photos = json.loads(req["photo_file_ids"] or "[]")
    new_markup = dept_status_buttons(req_id)

    # На карточке: пока в работе — кто принял; как только готово — кто сдал.
    if new_status == "done" and req.get("finished_by_name"):
        actor_line = f"Завершил: {req['finished_by_name']}"
    elif req.get("accepted_by_name"):
        actor_line = f"Принял: {req['accepted_by_name']}"
    else:
        actor_line = None

    try:
        if len(photos) >= 2:
            case_title = CASES.get(req["case_key"], {}).get("title", req["case_key"])
            short = f"Заявка №{req_id} · {case_title}\n{STATUSES[new_status]}"
            if actor_line:
                short += f"\n{actor_line}"
            await callback.message.edit_text(short, reply_markup=new_markup)
        elif len(photos) == 1:
            caption = request_card(
                req_id, req["case_key"], req["description"], req["source_path"],
                author, new_status, max_len=CAPTION_LIMIT, actor_line=actor_line,
            )
            await callback.message.edit_caption(caption=caption, reply_markup=new_markup)
        else:
            new_text = request_card(
                req_id, req["case_key"], req["description"], req["source_path"], author, new_status,
                actor_line=actor_line,
            )
            await callback.message.edit_text(new_text, reply_markup=new_markup)
    except TelegramBadRequest as e:
        # Гонка двух кликов или карточка старше 48ч: статус в БД уже сменён,
        # автора всё равно уведомим ниже.
        log.warning("Заявка №%s: не удалось обновить карточку: %s", req_id, e)

    case_title = CASES.get(req["case_key"], {}).get("title", req["case_key"])
    notify = STATUS_CHANGED_NOTIFY.format(
        req_id=req_id, case_title=case_title, status=STATUSES[new_status]
    )
    if new_status == "accepted":
        contact = _actor_display(req, "accepted_by")
        if contact:
            notify += ACCEPTED_CONTACT_LINE.format(contact=contact)
        # Если контакта ещё нет (ждём, пока принявший пришлёт его текстом) —
        # просто не добавляем строку сейчас, заявителя это не блокирует.
    elif new_status == "done":
        contact = _actor_display(req, "finished_by")
        notify += DONE_CONTACT_LINE.format(contact=contact) if contact else DONE_CONTACT_UNKNOWN
    try:
        await bot.send_message(req["user_id"], notify)
    except Exception:
        log.info("Заявка №%s: автору не доставлено уведомление (закрыл личку?)", req_id)


@router.message(F.chat.id == config.dept_chat_id)
async def capture_actor_contact(message: Message) -> None:
    """Ловит текстовый ответ от того, кого только что попросили прислать
    контакт (см. ASK_ACTOR_CONTACT выше). Молчит для всех остальных
    сообщений в чате отдела — обычная переписка команды бота не касается."""
    user_id = message.from_user.id if message.from_user else None
    pending = AWAITING_CONTACT.get(user_id) if user_id else None
    if pending is None:
        return
    req_id, prefix = pending
    contact = (message.text or "").strip()
    if not contact:
        await message.reply("Пришли контакт текстом, пожалуйста.")
        return
    AWAITING_CONTACT.pop(user_id, None)
    KNOWN_CONTACTS[user_id] = contact
    await db.set_actor_contact(req_id, prefix, contact)
    await message.reply(ACTOR_CONTACT_SAVED.format(req_id=req_id, contact=contact))
