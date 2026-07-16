from aiogram import Dispatcher

from . import create, dept, feedback, start


def register_all(dp: Dispatcher) -> None:
    # start раньше create И feedback: /info, /my, кнопки «Инфо»/«Мои заявки»
    # должны срабатывать всегда, а не попадать в текст-ловушку чужого FSM-состояния
    # (create.got_description/got_source и feedback.capture_feedback_comment матчат
    # ЛЮБОЙ текст в своём состоянии — без этого порядка нажатие кнопки меню
    # посреди заявки/отзыва уходило туда как описание/комментарий).
    # dept ловит чужие реплаи через SkipHandler, если это не его случай —
    # порядок между ним и остальными роутерами для этого уже не критичен, но
    # держим его последним для читаемости (хендлер — узкоспециальная ловушка).
    dp.include_router(start.router)
    dp.include_router(create.router)
    dp.include_router(feedback.router)
    dp.include_router(dept.router)
