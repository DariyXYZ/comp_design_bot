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

Витрина кейсов переписана на Next.js (App Router, `output: 'export'` —
статика, сервера нет). Живёт в `web/`, деплоится workflow'ом
`.github/workflows/deploy-webapp.yml` на каждый пуш в `main`, который трогает
`web/**`.

```powershell
cd web
npm install
npm run dev     # http://localhost:3000/comp_design_bot
npm run build   # статика в web/out
```

`basePath` — `/comp_design_bot`, потому что Pages раздаёт project-сайт по
адресу `https://dariyxyz.github.io/comp_design_bot/`.

Карточки берутся из Supabase (таблица `cases`) — тот же источник, что у бота,
править контент нужно там, а не в коде.

`docs/` остаётся как прежняя версия, пока новая не подтверждена в живом
Telegram. Пока в Settings → Pages источником выбрана папка `docs`, в проде
работает именно она; переключение на «GitHub Actions» и есть момент
переезда.

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
