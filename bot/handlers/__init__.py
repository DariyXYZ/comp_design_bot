from aiogram import Dispatcher

from . import create, dept, start


def register_all(dp: Dispatcher) -> None:
    dp.include_router(dept.router)
    dp.include_router(create.router)
    dp.include_router(start.router)
