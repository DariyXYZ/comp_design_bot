"""Кнопки статусов под заявкой в чате отдела."""
from __future__ import annotations

import json
import logging

from aiogram import F, Bot, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message, User

from .. import db
from ..config import config
from ..keyboards import dept_status_buttons, feedback_buttons
from ..texts import (
    ACCEPTED_CONTACT_LINE,
    ACTOR_CONTACT_SAVED,
    ASK_ACTOR_CONTACT,
    ASK_REJECTION_REASON,
    CASES,
    CONTACT_LATE_NOTIFY,
    DONE_CONTACT_LINE,
    DONE_CONTACT_UNKNOWN,
    REJECTION_REASON_NOTIFY,
    REJECTION_REASON_SAVED,
    STATUS_CHANGED_NOTIFY,
    STATUSES,
)

router = Router()
log = logging.getLogger(__name__)


class RejectionReason(StatesGroup):
    # Обычный текст, как в мастере заявки — не реплай: реплай в чате отдела
    # для контакта исполнителя оправдан (нужно пережить рестарт и отличить
    # адресата), а для причины отклонения оказался просто неочевидным жестом.
    text = State()


def _actor_display(req: dict, prefix: str) -> str | None:
    """Лучшее, что можно показать для связи по этому актёру; None — неизвестен."""
    if req.get(f"{prefix}_contact"):
        return req[f"{prefix}_contact"]
    if req.get(f"{prefix}_username"):
        return f"@{req[f'{prefix}_username']}"
    return req.get(f"{prefix}_name") or None


async def _capture_actor(callback: CallbackQuery, req_id: int, prefix: str) -> None:
    """Фиксирует, кто нажал кнопку (accepted_by/finished_by), и если у него нет
    @username — просит прислать контакт РЕПЛАЕМ на вопрос (один раз на
    человека, дальше берём из БД actor_contacts)."""
    actor: User = callback.from_user
    await db.set_actor(req_id, prefix, actor.id, actor.username, actor.full_name)
    if not actor.username:
        cached = await db.get_known_contact(actor.id)
        if cached:
            await db.set_actor_contact(req_id, prefix, cached)
        else:
            ask_msg = await callback.message.answer(
                ASK_ACTOR_CONTACT.format(name=actor.full_name, req_id=req_id)
            )
            await db.add_pending_reply(
                callback.message.chat.id, ask_msg.message_id, actor.id, "contact", req_id, prefix
            )


async def _capture_rejection_reason(callback: CallbackQuery, req_id: int, state: FSMContext) -> None:
    """Отклонение без причины заявителю ничего не объясняет — просим коротко
    пояснить обычным текстом (FSM-состояние ключуется по chat+user, так что
    чужие сообщения в этом же чате отдела эту ловушку не задевают)."""
    await state.set_state(RejectionReason.text)
    await state.update_data(req_id=req_id)
    await callback.message.answer(ASK_REJECTION_REASON.format(req_id=req_id))


@router.callback_query(F.data.startswith("st:"))
async def change_status(callback: CallbackQuery, bot: Bot, state: FSMContext) -> None:
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
    elif new_status == "rejected":
        await _capture_rejection_reason(callback, req_id, state)

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
    # Оценку просим только у «Готово» — на промежуточных статусах оценивать нечего.
    feedback_markup = feedback_buttons(req_id) if new_status == "done" else None
    try:
        await bot.send_message(req["user_id"], notify, reply_markup=feedback_markup)
    except Exception:
        log.info("Заявка №%s: автору не доставлено уведомление (закрыл личку?)", req_id)


@router.message(F.chat.id == config.dept_chat_id, F.reply_to_message)
async def capture_dept_reply(message: Message, bot: Bot) -> None:
    """Ловит ТОЛЬКО реплай на конкретное сообщение-просьбу контакта исполнителя —
    сверяем ask_message_id и того, кто должен ответить. Не наш реплай —
    пропускаем дальше (SkipHandler), а не тихо едим: без этого широкий фильтр
    по чату блокировал /id и всё остальное в чате отдела. Состояние в
    pending_replies/actor_contacts, переживает рестарт — тут завязан хэндовер
    исполнителя, в отличие от причины отклонения (см. RejectionReason ниже)."""
    pending = await db.get_pending_reply(message.chat.id, message.reply_to_message.message_id)
    if pending is None or message.from_user is None or message.from_user.id != pending["user_id"]:
        raise SkipHandler

    text = (message.text or "").strip()
    if not text:
        await message.reply("Пришли текстом, пожалуйста.")
        return

    await db.clear_pending_reply(message.chat.id, message.reply_to_message.message_id)
    req_id = pending["req_id"]

    await db.set_known_contact(pending["user_id"], text)
    await db.set_actor_contact(req_id, pending["prefix"], text)
    await message.reply(ACTOR_CONTACT_SAVED.format(req_id=req_id, contact=text))
    req = await db.get_request(req_id)
    if req:
        try:
            await bot.send_message(req["user_id"], CONTACT_LATE_NOTIFY.format(req_id=req_id, contact=text))
        except Exception:
            log.info("Заявка №%s: поздний контакт не доставлен автору", req_id)


@router.message(RejectionReason.text, F.text)
async def capture_rejection_reason(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    req_id = data.get("req_id")
    await state.clear()
    text = message.text.strip()
    if not req_id or not text:
        return

    await db.set_rejection_reason(req_id, text)
    await message.reply(REJECTION_REASON_SAVED.format(req_id=req_id))
    req = await db.get_request(req_id)
    if req:
        try:
            await bot.send_message(req["user_id"], REJECTION_REASON_NOTIFY.format(req_id=req_id, reason=text))
        except Exception:
            log.info("Заявка №%s: причина отказа не доставлена автору", req_id)


@router.message(RejectionReason.text)
async def rejection_reason_wrong_type(message: Message) -> None:
    await message.answer("Пришли причину текстом, пожалуйста.")
