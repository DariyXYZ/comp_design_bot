"""Старт, меню, инфо, мои заявки, /id."""
from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

from .. import db
from ..keyboards import BTN_INFO, BTN_MY, main_menu
from ..texts import CASES, INFO, NO_REQUESTS, STATUSES, WELCOME

router = Router()


@router.message(CommandStart(), F.chat.type == "private")
async def cmd_start(message: Message) -> None:
    await message.answer(WELCOME, reply_markup=main_menu())


@router.message(Command("id"))
async def cmd_id(message: Message) -> None:
    """Работает в любом чате: показывает chat_id и thread_id — для настройки .env."""
    lines = [f"chat_id: <code>{message.chat.id}</code>"]
    if message.message_thread_id:
        lines.append(f"thread_id: <code>{message.message_thread_id}</code>")
    await message.reply("\n".join(lines))


@router.message(F.text == BTN_INFO, F.chat.type == "private")
async def show_info(message: Message) -> None:
    await message.answer(INFO)


@router.message(F.text == BTN_MY, F.chat.type == "private")
async def my_requests(message: Message) -> None:
    requests = await db.list_user_requests(message.from_user.id)
    if not requests:
        await message.answer(NO_REQUESTS)
        return
    lines = []
    for r in requests:
        case_title = CASES.get(r["case_key"], {}).get("title", r["case_key"])
        status = STATUSES.get(r["status"], r["status"])
        lines.append(f"№{r['id']} · {case_title}\n{status} · {r['created_at'][:10]}")
    await message.answer("\n\n".join(lines))
