# comp_design_bot

Telegram-бот `@comp_design_bot` для приёма задач в Отдел вычислительного проектирования IND.

Архитектор выбирает кейс (в Mini App-витрине или кнопками в чате), описывает задачу текстом, прикладывает картинки и путь к исходникам — заявка уходит карточкой в чат отдела, статусы меняются кнопками под ней, автору летят уведомления.

## Структура

```
bot/            # aiogram 3: handlers, FSM, SQLite
web/            # Mini App на Next.js -> GitHub Pages (актуальная витрина)
docs/           # прежняя витрина одним HTML-файлом (legacy, см. ниже)
run_bot.ps1     # запуск с автоперезапуском
register_autostart.ps1  # автозапуск при входе в Windows (без админ-прав)
```

### Mini App

Витрина кейсов — Next.js (App Router, TypeScript, `output: 'export'`) в папке
`web/`. Собирается и публикуется на GitHub Pages workflow'ом
`.github/workflows/deploy-webapp.yml`.

```powershell
cd web
npm install
Copy-Item .env.example .env.local   # вписать значения Supabase
npm run dev                         # http://localhost:3000/comp_design_bot
```

Подробности — структура, переменные окружения, архитектурные решения и
отклонения от стандарта бюро — в [web/README.md](web/README.md).

Карточки берутся из Supabase (таблица `cases`) — тот же источник, что у бота,
править контент нужно там, а не в коде.

`docs/` — прежняя однофайловая версия витрины. Оставлена как путь отката
(вернуть в Settings → Pages источником папку `docs`); в проде она больше не
используется.

## Настройка

1. Скопировать `.env.example` в `.env`, вписать `TELEGRAM_TOKEN`.
2. Добавить бота в группу отдела, в нужной ветке дать команду `/id` — вписать `DEPT_CHAT_ID` и `DEPT_THREAD_ID` в `.env`.
3. Включить GitHub Pages (Settings → Pages → Source: `GitHub Actions`), вписать URL в `WEBAPP_URL`.
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
