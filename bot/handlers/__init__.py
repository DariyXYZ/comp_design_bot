from aiogram import Dispatcher

from . import create, dept, feedback, start


def register_all(dp: Dispatcher) -> None:
    # start раньше create: /info, /my, кнопки «Инфо»/«Мои заявки» должны
    # срабатывать всегда, а не попадать в текст-ловушку FSM создания заявки
    # (create.got_description/got_source матчат ЛЮБОЙ текст в своих состояниях —
    # без этого порядка нажатие другой кнопки посреди заявки уходило в неё как описание).
    # feedback/dept ловят чужие реплаи через SkipHandler, если это не их случай —
    # порядок между ними и остальными роутерами уже не критичен, но держим их
    # ближе к концу для читаемости (их хендлеры — узкоспециальные ловушки).
    dp.include_router(start.router)
    dp.include_router(create.router)
    dp.include_router(feedback.router)
    dp.include_router(dept.router)
