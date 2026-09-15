"""Разовая уборка доски Pyrus: тестовые задачи → «Отклонена» + закрыть,
настоящие кейсы из бывшей ручной ленты (tools/feed_seed.ts) → задачи на доске
с обложкой и статусом. Запуск из корня: python tools/board_cleanup.py
"""
import asyncio
import io
import logging
import re
import sys

sys.path.insert(0, ".")
logging.basicConfig(level=logging.WARNING)
from bot import pyrus  # noqa: E402
from bot.pyrus import (  # noqa: E402
    FIELD_DESCRIPTION, FIELD_PROJECT, FIELD_SOURCE, FIELD_STATUS, STATUS_DONE, STATUS_WORK,
)

# Проверено вручную 2026-09-16: всё, кроме «Добавить в платформу улучшатель промпта».
JUNK = [379362904, 379362505, 379187078, 379185559, 379179399, 379034087, 379033108,
        379032380, 379030788, 378990480, 378986518, 374179204, 373955295]

src = io.open("tools/feed_seed.ts", encoding="utf-8").read()
ITEMS = []
for block in re.findall(r"\{\s*id:.*?\n  \},", src, re.S):
    d = {k: v for k, v in re.findall(r'(\w+): "((?:[^"\\]|\\.)*)"', block)}
    d["files"] = d.get("files", "").replace("\\\\", "\\")
    ITEMS.append(d)


async def main() -> None:
    done = 0
    for tid in JUNK:
        r = await pyrus.get_request(tid)
        if not r:
            continue
        if r["board_status"] == pyrus.STATUS_REJECTED and r["closed"]:
            done += 1
            continue
        if await pyrus.set_status(tid, "rejected", "Тестовая задача — убрана с доски", r["closed"]):
            done += 1
    print("тестовых закрыто:", done, "/", len(JUNK))

    created = 0
    for d in ITEMS:
        tid = await pyrus.pyrus.create_form_task({
            FIELD_DESCRIPTION: d["title"],
            FIELD_PROJECT: d["project"],
            FIELD_SOURCE: d["files"],
            FIELD_STATUS: STATUS_WORK if d["status"] == "in_work" else STATUS_DONE,
        })
        if not tid:
            print("не создана:", d["title"])
            continue
        cover = d.get("cover")
        if cover:
            try:
                data = io.open("web/public" + cover, "rb").read()
                await pyrus.pyrus.upload_and_attach(tid, [(cover.rsplit("/", 1)[-1], data)], "Обложка")
            except FileNotFoundError:
                print("нет обложки:", cover)
        if d["status"] == "done":
            when = f" · {d['when']}" if d.get("when") else ""
            await pyrus.pyrus.comment(tid, f"Сделано{when}", action="finished")
        created += 1
    print("кейсов создано:", created, "/", len(ITEMS))


asyncio.run(main())
