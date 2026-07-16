from aiogram import Dispatcher

from . import create, dept, feedback, start


def register_all(dp: Dispatcher) -> None:
    # start раньше create И feedback: /info, /my, кнопки «Инфо»/«Мои заявки»
    # должны срабатывать всегда, а не попадать в текст-ловушку чужого FSM-состояния
    # (create.got_description/got_source и feedback.capture_feedback_comment матчат
    # ЛЮБОЙ текст в своём состоянии — без этого порядка нажатие кнопки меню
    # посреди заявки/отзыва уходило туда как описание/комментарий).
    # dept — свои FSM-состояния (DeptReply.contact/reason) ключуются по
    # dept_chat_id, который ни с одним приватным чатом не пересечётся, так что
    # порядок относительно него для корректности не важен; держим последним
    # для читаемости.
    dp.include_router(start.router)
    dp.include_router(create.router)
    dp.include_router(feedback.router)
    dp.include_router(dept.router)
