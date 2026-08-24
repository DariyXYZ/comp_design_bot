"""Старт, меню, инфо, мои заявки, /id."""
from __future__ import annotations

import logging
from pathlib import Path

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import FSInputFile, Message

from .. import db
from ..keyboards import BTN_INFO, BTN_MY, main_menu
from ..texts import CASES, INFO, NO_REQUESTS, STATUSES, WELCOME

log = logging.getLogger(__name__)

router = Router()

# Путь от файла, а не от рабочей директории: бот запускают и через run_bot.ps1,
# и вручную из разных мест.
WELCOME_IMAGE = Path(__file__).resolve().parents[2] / "promo" / "welcome.jpg"

# После первой отправки Telegram возвращает file_id — дальше картинку можно не
# загружать заново. Кэш в памяти, поэтому после рестарта бота первый /start
# снова загрузит файл; в БД тащить нечего, это чистая оптимизация трафика.
_welcome_photo_id: str | None = None


@router.message(CommandStart(), F.chat.type == "private")
async def cmd_start(message: Message, state: FSMContext) -> None:
    global _welcome_photo_id
    await state.clear()  # /start посреди заявки сбрасывает черновик, а не молча ест текст

    photo: str | FSInputFile | None = _welcome_photo_id
    if photo is None and WELCOME_IMAGE.exists():
        photo = FSInputFile(WELCOME_IMAGE)

    if photo is not None:
        try:
            sent = await message.answer_photo(
                photo, caption=WELCOME, reply_markup=main_menu(message.from_user)
            )
        except Exception:
            # /start — вход в бота, он не имеет права упасть из-за картинки:
            # битый файл, лимит или сетевой сбой должны деградировать в текст.
            log.exception("Не удалось отправить welcome-картинку, отправляю текстом")
        else:
            if _welcome_photo_id is None and sent.photo:
                _welcome_photo_id = sent.photo[-1].file_id
            return

    await message.answer(WELCOME, reply_markup=main_menu(message.from_user))


@router.message(Command("id"))
async def cmd_id(message: Message) -> None:
    """Работает в любом чате: показывает chat_id и thread_id — для настройки .env."""
    lines = [f"chat_id: <code>{message.chat.id}</code>"]
    if message.message_thread_id:
        lines.append(f"thread_id: <code>{message.message_thread_id}</code>")
    await message.reply("\n".join(lines))


@router.message(Command("info"), F.chat.type == "private")
@router.message(F.text == BTN_INFO, F.chat.type == "private")
async def show_info(message: Message, state: FSMContext) -> None:
    await state.clear()  # любая кнопка меню посреди заявки сбрасывает черновик
    await message.answer(INFO, reply_markup=main_menu(message.from_user))


# Шапка, которую дописывает заявка из Mini App: проект, основа, срок,
# картинки. В списке она бесполезна — там нужна суть задачи.
_HEADER_KEYS = ("Проект:", "Основа:", "Срок:", "Картинки:")
EXCERPT_LIMIT = 70


def request_excerpt(description: str | None) -> str:
    """Короткая суть заявки для списка.

    Без неё список выглядел набором дублей: строка показывала тему, а тем
    восемь — две разные заявки по «Геометрию нужно передать в Revit» читались
    как одна, и начальник решил, что видит чужие заявки.
    """
    text = (description or "").strip()
    if not text:
        return ""
    lines = [line.strip() for line in text.splitlines()]
    body = [line for line in lines if line and not line.startswith(_HEADER_KEYS)]
    first = body[0] if body else ""
    if len(first) > EXCERPT_LIMIT:
        first = first[: EXCERPT_LIMIT - 1].rstrip() + "…"
    return first

async def render_user_requests(user_id: int) -> str:
    """Список заявок человека одним текстом.

    Вынесено из обработчика: тот же список запрашивает Mini App кнопкой
    «Показать мои заявки в чате».

    Внимание: на эту функцию **не должны** висеть декораторы роутера. Когда
    её выносили, декораторы `/my` остались сверху — aiogram передавал в
    `user_id` объект `Message`, запрос падал на `Error binding parameter 1:
    type 'Message' is not supported`, и кнопка «Мои заявки» в чате молча не
    отвечала. Регистрация ниже, у `my_requests`.
    """
    requests = await db.list_user_requests(user_id)
    if not requests:
        return NO_REQUESTS
    lines = []
    for r in requests:
        case_title = CASES.get(r["case_key"], {}).get("title", r["case_key"])
        status = STATUSES.get(r["status"], r["status"])
        excerpt = request_excerpt(r["description"])
        head = f"№{r['id']} · {case_title}"
        tail = f"{status} · {r['created_at'][:10]}"
        lines.append(f"{head}\n{excerpt}\n{tail}" if excerpt else f"{head}\n{tail}")
    return "\n\n".join(lines)


@router.message(Command("my"), F.chat.type == "private")
@router.message(F.text == BTN_MY, F.chat.type == "private")
async def my_requests(message: Message, state: FSMContext) -> None:
    await state.clear()  # любая кнопка меню посреди заявки сбрасывает черновик
    # Клавиатура пересылается вместе с ответом: в кнопке Mini App лежит адрес
    # приложения и код входа, а Telegram обновляет клавиатуру только когда
    # приходит сообщение с разметкой. Без этого человек, нажавший /start
    # месяц назад, открывает старый адрес — ровно так начальник попал на
    # прошлую версию приложения, где профиль показывает «Гость».
    await message.answer(
        await render_user_requests(message.from_user.id),
        reply_markup=main_menu(message.from_user),
    )
