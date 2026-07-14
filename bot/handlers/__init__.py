from aiogram import Dispatcher

from . import create, dept, start


def register_all(dp: Dispatcher) -> None:
    # start раньше create: /info, /my, кнопки «Инфо»/«Мои заявки» должны
    # срабатывать всегда, а не попадать в текст-ловушку FSM создания заявки
    # (create.got_description/got_source матчат ЛЮБОЙ текст в своих состояниях —
    # без этого порядка нажатие другой кнопки посреди заявки уходило в неё как описание).
    dp.include_router(dept.router)
    dp.include_router(start.router)
    dp.include_router(create.router)
