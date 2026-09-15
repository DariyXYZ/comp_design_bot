"""Кнопки статусов под заявкой в чате отдела.

Состояние заявки живёт в Pyrus: кнопка переводит колонку доски, а кто нажал,
причина отказа — комментарии к задаче. Текущий статус карточки читается с
самой карточки (бот рендерит её сам, формат свой), а не из отдельной базы.
"""
from __future__ import annotations

import asyncio
import html
import logging

from aiogram import F, Bot, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message, User

from .. import pyrus
from ..config import config
from ..keyboards import app_button, dept_status_buttons, feedback_buttons
from ..texts import (
    ACCEPTED_CONTACT_LINE,
    ASK_CLARIFY_QUESTION,
    ASK_REJECTION_REASON,
    CLARIFY_QUESTION_NOTIFY,
    CLARIFY_QUESTION_SAVED,
    CLARIFY_STATUS_LINE,
    DONE_CONTACT_LINE,
    REJECTION_REASON_NOTIFY,
    REJECTION_REASON_SAVED,
    STATUS_CHANGED_NOTIFY,
    STATUSES,
)

router = Router()
log = logging.getLogger(__name__)

# Лок на заявку (не на пользователя — разные заявки меняются независимо):
# без него два быстрых клика (свой или чужой) на одну и ту же заявку читают
# один и тот же снэпшот статуса до того как первый успел записать, отсюда
# дублирующее уведомление автору и непредсказуемый порядок при серии кликов.
_req_locks: dict[int, asyncio.Lock] = {}


def _req_lock(req_id: int) -> asyncio.Lock:
    return _req_locks.setdefault(req_id, asyncio.Lock())


class DeptReply(StatesGroup):
    # Обычный текст, как в мастере заявки — не реплай (реплай оказался
    # неочевидным жестом). FSM-состояние ключуется по (chat_id, user_id) —
    # даже в групповом чате ловит именно того, кого спросили. Расплата за
    # отказ от реплая — не переживает рестарт бота (MemoryStorage).
    reason = State()
    question = State()


def mention(user: User) -> str:
    """Как назвать человека в HTML-сообщении: @ник, а без ника — ссылка на
    профиль по id. Раньше у людей без ника спрашивали контакт текстом и
    держали его в базе; ссылка `tg://user?id=` делает это ненужным."""
    if user.username:
        return f"@{user.username}"
    return f'<a href="tg://user?id={user.id}">{html.escape(user.full_name)}</a>'


ACTOR_PREFIXES = ("Принял: ", "Завершил: ")


def _card_lines(message: Message) -> list[str]:
    return (message.text or message.caption or "").splitlines()


def _status_from_card(message: Message) -> str | None:
    """Текущий статус кнопки — по строке статуса на карточке."""
    labels = {label: key for key, label in STATUSES.items()}
    for line in _card_lines(message):
        if line.strip() in labels:
            return labels[line.strip()]
    return None


def _actor_from_card(message: Message) -> str | None:
    """Строка «Принял: …» с карточки — чтобы не потерять её при перерисовке."""
    for line in _card_lines(message):
        if line.startswith(ACTOR_PREFIXES):
            return line
    return None


@router.callback_query(F.data.startswith("st:"))
async def change_status(callback: CallbackQuery, bot: Bot, state: FSMContext) -> None:
    # Кнопки работают только в чате отдела: пересланная карточка
    # не должна давать право менять статус кому угодно.
    if config.dept_chat_id is None or callback.message.chat.id != config.dept_chat_id:
        await callback.answer("Статусы меняются только в чате отдела", show_alert=True)
        return

    try:
        _, raw_id, new_status = callback.data.split(":", 2)
        req_id = int(raw_id)
    except ValueError:
        # Битый/устаревший callback_data — кнопка не должна повиснуть без ответа.
        await callback.answer("Ошибка", show_alert=True)
        return
    if new_status not in STATUSES:
        await callback.answer("Неизвестный статус")
        return

    async with _req_lock(req_id):
        if _status_from_card(callback.message) == new_status:
            await callback.answer("Уже в этом статусе")
            return
        req = await pyrus.get_request(req_id)
        if req is None:
            await callback.answer("Заявка не найдена в Pyrus", show_alert=True)
            return

        # Telegram сам говорит боту, кто нажал кнопку (callback.from_user —
        # серверные данные, не подделать). «Принята» фиксирует, к кому
        # обращаться по ходу работы; «Готово» — у кого забирать решение.
        actor = callback.from_user
        who = f"{actor.full_name}" + (f" (@{actor.username})" if actor.username else "")
        if new_status == "accepted":
            actor_line = f"Принял: {actor.full_name}"
            note = f"Принял в работу: {who}"
        elif new_status == "done":
            actor_line = f"Завершил: {actor.full_name}"
            note = f"Готово. Завершил: {who}"
        elif new_status == "rejected":
            actor_line = _actor_from_card(callback.message)
            note = f"Отклонена в чате отдела: {who}"
        elif new_status == "clarify":
            actor_line = _actor_from_card(callback.message)
            note = f"Требуется уточнение у заявителя — спрашивает {who}"
        else:
            actor_line = _actor_from_card(callback.message)
            note = f"Статус в чате: {STATUSES[new_status]} — {who}"

        # Сначала Pyrus — это и есть смена статуса. Не записалось — кнопка
        # честно говорит об этом, карточка не трогается.
        if not await pyrus.set_status(req_id, new_status, note, req["closed"]):
            await callback.answer("Pyrus не ответил, статус не изменён", show_alert=True)
            return
        await callback.answer(f"Статус: {STATUSES[new_status]}")

        if new_status == "rejected":
            await _ask_followup(callback, req_id, state, DeptReply.reason, ASK_REJECTION_REASON)
        elif new_status == "clarify":
            await _ask_followup(callback, req_id, state, DeptReply.question, ASK_CLARIFY_QUESTION)

        # Перерисовываем тем же рендерером, что и при создании. Способ зависит
        # от того, каким сообщением ушла заявка (см. create.send_request):
        # текст / подпись к фото / короткая строка статуса под альбомом.
        from .create import CAPTION_LIMIT, request_card  # локальный импорт против цикла

        new_markup = dept_status_buttons(req_id)
        case_title = req["case_title"]
        try:
            if callback.message.reply_to_message is not None:
                short = f"Заявка №{req_id} · {html.escape(case_title)}\n{STATUSES[new_status]}"
                if actor_line:
                    short += f"\n{html.escape(actor_line)}"
                await callback.message.edit_text(short, reply_markup=new_markup)
            elif callback.message.photo:
                caption = request_card(
                    req_id, case_title, req["description"], req["source_path"],
                    req["author"], new_status, max_len=CAPTION_LIMIT, actor_line=actor_line,
                )
                await callback.message.edit_caption(caption=caption, reply_markup=new_markup)
            else:
                new_text = request_card(
                    req_id, case_title, req["description"], req["source_path"],
                    req["author"], new_status, actor_line=actor_line,
                )
                await callback.message.edit_text(new_text, reply_markup=new_markup)
        except TelegramBadRequest as e:
            # Карточка старше 48ч и её больше нельзя редактировать: в Pyrus
            # статус уже сменён, автора всё равно уведомим ниже.
            log.warning("Заявка №%s: не удалось обновить карточку: %s", req_id, e)

        if not req["user_id"]:
            return
        notify = STATUS_CHANGED_NOTIFY.format(
            req_id=req_id, case_title=html.escape(case_title), status=STATUSES[new_status]
        )
        if new_status == "accepted":
            notify += ACCEPTED_CONTACT_LINE.format(contact=mention(actor))
        elif new_status == "done":
            notify += DONE_CONTACT_LINE.format(contact=mention(actor))
        elif new_status == "clarify":
            notify += CLARIFY_STATUS_LINE
        # Оценку просим только у «Готово» — на промежуточных статусах оценивать нечего.
        feedback_markup = feedback_buttons(req_id) if new_status == "done" else None
        try:
            await bot.send_message(req["user_id"], notify, reply_markup=feedback_markup)
        except Exception:
            log.info("Заявка №%s: автору не доставлено уведомление (закрыл личку?)", req_id)


async def _ask_followup(
    callback: CallbackQuery, req_id: int, state: FSMContext, target: State, prompt: str
) -> None:
    """Статус, которому нужен текст (причина отказа, вопрос заявителю), —
    просим его обычным сообщением. Если у этого же человека уже открыт вопрос
    по другой заявке, не перезаписываем его молча."""
    if await state.get_state() is not None:
        log.info(
            "Заявка №%s: не спросили текст у %s — уже открыт вопрос по другой заявке",
            req_id, callback.from_user.id,
        )
        return
    await state.set_state(target)
    await state.update_data(req_id=req_id)
    await callback.message.answer(prompt.format(req_id=req_id))


@router.message(DeptReply.reason, F.text)
async def capture_rejection_reason(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    req_id = data.get("req_id")
    await state.clear()
    text = message.text.strip()
    if not req_id or not text:
        return

    await pyrus.add_comment(req_id, f"Причина отклонения: {text}")
    await message.reply(REJECTION_REASON_SAVED.format(req_id=req_id))
    req = await pyrus.get_request(req_id)
    if req and req["user_id"]:
        try:
            await bot.send_message(
                req["user_id"],
                REJECTION_REASON_NOTIFY.format(req_id=req_id, reason=html.escape(text)),
            )
        except Exception:
            log.info("Заявка №%s: причина отказа не доставлена автору", req_id)


@router.message(DeptReply.reason)
async def rejection_reason_wrong_type(message: Message) -> None:
    await message.answer("Пришли причину текстом, пожалуйста.")


@router.message(DeptReply.question, F.text)
async def capture_clarify_question(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    req_id = data.get("req_id")
    await state.clear()
    text = message.text.strip()
    if not req_id or not text:
        return

    # Префикс — договорённость с кабинетом: он показывает заявителю последний
    # комментарий с таким началом как вопрос отдела.
    await pyrus.add_comment(req_id, f"Вопрос заявителю: {text}")
    await message.reply(CLARIFY_QUESTION_SAVED.format(req_id=req_id))
    req = await pyrus.get_request(req_id)
    if req and req["user_id"]:
        try:
            await bot.send_message(
                req["user_id"],
                CLARIFY_QUESTION_NOTIFY.format(req_id=req_id, question=html.escape(text)),
                # Кнопка с кодом входа: имя берём из поля «Telegram» задачи —
                # объекта User здесь нет, а ник для входа не нужен.
                reply_markup=app_button(User(id=req["user_id"], is_bot=False, first_name=req["author"])),
            )
        except Exception:
            log.info("Заявка №%s: вопрос не доставлен автору", req_id)


@router.message(DeptReply.question)
async def clarify_question_wrong_type(message: Message) -> None:
    await message.answer("Пришли вопрос текстом, пожалуйста.")
