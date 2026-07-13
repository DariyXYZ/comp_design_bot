"""Точка входа: long polling."""
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeAllPrivateChats

from . import db
from .config import config
from .handlers import register_all

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

COMMANDS = [
    BotCommand(command="start", description="Главное меню"),
    BotCommand(command="new", description="Создать заявку"),
    BotCommand(command="my", description="Мои заявки"),
    BotCommand(command="info", description="Как это работает"),
]


async def main() -> None:
    await db.init_db()
    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await bot.set_my_commands(COMMANDS, scope=BotCommandScopeAllPrivateChats())
    dp = Dispatcher()
    register_all(dp)
    logging.info("comp_design_bot запущен (polling)")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
