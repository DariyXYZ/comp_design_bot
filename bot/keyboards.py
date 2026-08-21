"""Клавиатуры: нижнее меню, выбор кейса, шаги заявки, статусы."""
from __future__ import annotations

from urllib.parse import urlencode, urlsplit, urlunsplit

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    User,
    WebAppInfo,
)

from .config import config
from .texts import CASES, STATUSES
from .webauth import login_code

BTN_CAPABILITIES = "✦ Возможности отдела"
BTN_MY = "☰ Мои заявки"
BTN_CREATE = "✚ Создать заявку"
BTN_INFO = "🅘 Инфо"


def webapp_url_for(user: User | None) -> str:
    """Адрес Mini App с именем и подписанным кодом входа.

    Зачем: клиенты Telegram отдают данные запуска непредсказуемо — после
    восстановления вебвью из кеша `initData` приходит пустым, приложение не
    может опознать человека, и профиль застревает на «Гость», а картинки в
    заявку не грузятся. Кнопку формирует бот, и в этот момент он точно знает,
    кто перед ним.

    `u` и `h` — только для показа (имя и ник, ничего не авторизуют).
    `c` — подписанный код входа: приложение сразу меняет его на свой токен
    сессии. Код живёт столько же, сколько сама кнопка в чате, иначе вход
    «сгорал» бы раньше неё (см. `webauth.login_code`).
    """
    if not config.webapp_url or user is None:
        return config.webapp_url
    parts = urlsplit(config.webapp_url)
    query = dict(pair.split("=", 1) for pair in parts.query.split("&") if "=" in pair)
    query["u"] = user.full_name or ""
    if user.username:
        query["h"] = user.username
    query["c"] = login_code(user.id, user.full_name or "", user.username)
    return urlunsplit(parts._replace(query=urlencode(query)))


def main_menu(user: User | None = None) -> ReplyKeyboardMarkup:
    url = webapp_url_for(user)
    top = (
        KeyboardButton(text=BTN_CAPABILITIES, web_app=WebAppInfo(url=url))
        if url
        else KeyboardButton(text=BTN_CAPABILITIES)
    )
    return ReplyKeyboardMarkup(
        keyboard=[
            [top],
            [
                KeyboardButton(text=BTN_MY),
                KeyboardButton(text=BTN_CREATE),
                KeyboardButton(text=BTN_INFO),
            ],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def case_picker() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=case["title"], callback_data=f"case:{key}")]
        for key, case in CASES.items()
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _cancel_row() -> list[InlineKeyboardButton]:
    return [InlineKeyboardButton(text="Отменить заявку", callback_data="req:cancel")]


def photos_step() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Отменить заявку", callback_data="req:cancel"),
                InlineKeyboardButton(text="Пропустить", callback_data="photos:skip"),
            ],
            [InlineKeyboardButton(text="Дальше →", callback_data="photos:done")],
        ]
    )


def source_step() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Пропустить", callback_data="source:skip")],
            _cancel_row(),
        ]
    )


def preview_step() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="→ Отправить в отдел", callback_data="req:send")],
            _cancel_row(),
        ]
    )


def feedback_buttons(req_id: int) -> InlineKeyboardMarkup:
    """Оценка результата — под уведомлением о «Готово» в личке заявителя."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="👍 Всё отлично", callback_data=f"fb:{req_id}:up"),
                InlineKeyboardButton(text="👎 Есть замечания", callback_data=f"fb:{req_id}:down"),
            ],
            [InlineKeyboardButton(text="📝 Оставить отзыв", callback_data=f"fb:{req_id}:review")],
        ]
    )


def feedback_review_only_button(req_id: int) -> InlineKeyboardMarkup:
    """После оценки 👍/👎 сама оценка больше недоступна (уже сохранена),
    но написать отзыв можно и после — кнопка остаётся одна."""
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="📝 Оставить отзыв", callback_data=f"fb:{req_id}:review")]]
    )


def dept_status_buttons(req_id: int) -> InlineKeyboardMarkup:
    """Кнопки смены статуса под заявкой в чате отдела."""
    rows = []
    row: list[InlineKeyboardButton] = []
    for key, label in STATUSES.items():
        row.append(InlineKeyboardButton(text=label, callback_data=f"st:{req_id}:{key}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows)
