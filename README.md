# comp_design_bot

Telegram-бот `@comp_design_bot` для приёма задач в Отдел вычислительного проектирования IND.

Архитектор выбирает кейс (в Mini App-витрине или кнопками в чате), описывает задачу текстом, прикладывает картинки и путь к исходникам — заявка уходит карточкой в чат отдела, статусы меняются кнопками под ней, автору летят уведомления.

## Структура

```
bot/            # aiogram 3: handlers, FSM, SQLite
webapp/         # витрина кейсов -> GitHub Pages (Mini App)
run_bot.ps1     # запуск с автоперезапуском
register_autostart.ps1  # автозапуск при входе в Windows (без админ-прав)
```

## Настройка

1. Скопировать `.env.example` в `.env`, вписать `TELEGRAM_TOKEN`.
2. Добавить бота в группу отдела, в нужной ветке дать команду `/id` — вписать `DEPT_CHAT_ID` и `DEPT_THREAD_ID` в `.env`.
3. Включить GitHub Pages (Settings → Pages → deploy from branch `main`, папка `/webapp` через workflow или корень с редиректом), вписать URL в `WEBAPP_URL`.
4. У BotFather: `/setmenubutton` не требуется — Mini App открывается с reply-кнопки «Возможности отдела».

## Запуск

```powershell
cd "c:\VS Code\comp_design_bot"
python -m pip install -r requirements.txt
.\run_bot.ps1
```

Автозапуск при входе в систему (один раз):

```powershell
.\register_autostart.ps1
```

## Статусы заявок

🆕 Новая → 👀 Принята → ⚙️ В работе → ✅ Готово / ❌ Отклонена.
Меняются кнопками под карточкой заявки в чате отдела; автор получает уведомление в личку.
