"""Точка входа: long polling."""
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeAllPrivateChats, CallbackQuery, ErrorEvent

from . import db
from .config import config
from .handlers import register_all
from .texts import SESSION_RESET

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


# Регистрируется последним: ловит колбэки, не совпавшие ни с одним хендлером —
# в основном кнопки «Дальше»/«Отправить» из черновиков, умерших при рестарте бота.
fallback = Router()


@fallback.callback_query()
async def stale_callback(callback: CallbackQuery) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.answer(SESSION_RESET)


async def main() -> None:
    await db.init_db()
    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await bot.set_my_commands(COMMANDS, scope=BotCommandScopeAllPrivateChats())
    dp = Dispatcher()
    register_all(dp)
    dp.include_router(fallback)

    @dp.errors()
    async def on_error(event: ErrorEvent) -> None:
        logging.exception("Необработанная ошибка в хендлере: %s", event.exception)

    logging.info("comp_design_bot запущен (polling)")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
