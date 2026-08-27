"""Точка входа: long polling."""
from __future__ import annotations

import asyncio
import inspect
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
    BotCommand(command="app", description="Приложение: решения и заявки"),
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


# Имена, под которыми aiogram отдаёт само событие первым аргументом.
EVENT_PARAMS = {"message", "callback", "callback_query", "query", "event", "update"}


def check_handlers(dp: Dispatcher) -> None:
    """Ругается, если под декоратором роутера оказалась не та функция.

    Живой случай: у `render_user_requests(user_id)` остались декораторы `/my`
    после того, как её вынесли из обработчика. aiogram передавал в `user_id`
    объект `Message`, запрос к базе падал, и кнопка «Мои заявки» молча не
    отвечала — снаружи это выглядело как «бот не работает у начальника».
    Ошибка нашлась только в логе, спустя дни.

    Проверка на старте, а не в тестах: тестов у бота нет, а цена ошибки —
    неработающая кнопка, о которой никто не узнает.
    """
    suspicious: list[str] = []
    for router in [dp, *dp.sub_routers]:
        for observer in router.observers.values():
            for handler in getattr(observer, "handlers", []):
                callback = handler.callback
                params = list(inspect.signature(callback).parameters)
                if not params or params[0] not in EVENT_PARAMS:
                    suspicious.append(
                        f"{callback.__module__}.{callback.__name__}"
                        f" (первый аргумент: {params[0] if params else 'нет'})"
                    )
    if suspicious:
        logging.error(
            "Похоже, декоратор роутера висит не на обработчике: %s",
            ", ".join(suspicious),
        )

async def main() -> None:
    await db.init_db()
    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await bot.set_my_commands(COMMANDS, scope=BotCommandScopeAllPrivateChats())
    dp = Dispatcher()
    register_all(dp)
    dp.include_router(fallback)
    check_handlers(dp)

    @dp.errors()
    async def on_error(event: ErrorEvent) -> None:
        logging.exception("Необработанная ошибка в хендлере: %s", event.exception)

    logging.info("comp_design_bot запущен (polling)")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
