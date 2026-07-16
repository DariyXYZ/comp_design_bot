"""Клавиатуры: нижнее меню, выбор кейса, шаги заявки, статусы."""
from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from .config import config
from .texts import CASES, STATUSES

BTN_CAPABILITIES = "✦ Возможности отдела"
BTN_MY = "✉︎ Мои заявки"
BTN_CREATE = "✚ Создать заявку"
BTN_INFO = "🅘 Инфо"


def main_menu() -> ReplyKeyboardMarkup:
    top = (
        KeyboardButton(text=BTN_CAPABILITIES, web_app=WebAppInfo(url=config.webapp_url))
        if config.webapp_url
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
                InlineKeyboardButton(text="Дальше →", callback_data="photos:done"),
                InlineKeyboardButton(text="Пропустить", callback_data="photos:skip"),
            ],
            _cancel_row(),
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


def dept_status_buttons(req_id: int, current: str) -> InlineKeyboardMarkup:
    """Кнопки смены статуса под заявкой в чате отдела. Текущий статус помечен точкой."""
    rows = []
    row: list[InlineKeyboardButton] = []
    for key, label in STATUSES.items():
        text = f"• {label}" if key == current else label
        row.append(InlineKeyboardButton(text=text, callback_data=f"st:{req_id}:{key}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows)
