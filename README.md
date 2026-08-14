# comp_design_bot

Telegram-бот `@comp_design_bot` для приёма задач в Отдел вычислительного проектирования IND.

Архитектор выбирает кейс (в Mini App-витрине или кнопками в чате), описывает задачу текстом, прикладывает картинки и путь к исходникам — заявка уходит карточкой в чат отдела, статусы меняются кнопками под ней, автору летят уведомления.

> **Статус**: рабочий прототип, собранный вне разработки (aiogram 3 + SQLite, без тестов и CI). Передаётся «как есть» для переноса на боевую архитектуру — структура и стек ниже даны как отправная точка, а не как требование её сохранять.

## Структура файлов

```
bot/                      # весь код бота (aiogram 3, Python)
  main.py                 # точка входа, регистрация роутеров, запуск polling
  config.py                # чтение .env, дата-класс Config
  db.py                    # доступ к SQLite (без ORM, сырой sqlite3)
  keyboards.py              # инлайн/reply-клавиатуры
  texts.py                 # тексты сообщений бота
  handlers/
    start.py               # /start, приветствие, главное меню
    create.py               # FSM создания заявки (кейс -> описание -> фото -> путь к файлам)
    dept.py                 # карточка заявки в чате отдела, смена статусов
    feedback.py              # причина отклонения, оценка/комментарий после Готово

docs/                     # витрина кейсов (Mini App), деплой на GitHub Pages из /docs
  index.html
  img/                    # обложки кейсов (лицевая + back-версия на каждый кейс)

promo/                    # промо-картинка для чата отдела (не часть рантайма бота)
  welcome.html
  welcome.jpg / welcome.png

requests.sqlite3          # SQLite БД заявок — оставлена 1 демо-запись для примера схемы
requirements.txt          # зависимости (aiogram и т.д.)
run_bot.ps1                # запуск бота с автоперезапуском при падении
register_autostart.ps1     # регистрация автозапуска при входе в Windows (без прав администратора)

.env.example              # шаблон переменных окружения
.env                       # тот же .env.example, но с частично заполненными плейсхолдерами
                           # (TELEGRAM_TOKEN / DEPT_CHAT_ID / DEPT_THREAD_ID — вписать реальные)
```

## Схема БД (`requests.sqlite3`, таблица `requests`)

Одна демо-запись сохранена, чтобы видеть форму данных не по коду, а по факту:

`id, user_id, username, full_name, case_key, description, photo_file_ids, source_path, status, dept_message_id, created_at, updated_at, accepted_by_user_id, accepted_by_username, accepted_by_name, accepted_by_contact, finished_by_user_id, finished_by_username, finished_by_name, finished_by_contact, rejection_reason, feedback, feedback_comment`

Остальные таблицы (`actor_contacts`, `pending_contacts`, `pending_replies`) — служебные, для текущего запроса пусты.

## Настройка (локальный запуск для ознакомления)

1. В `.env` вписать реальные `TELEGRAM_TOKEN`, `DEPT_CHAT_ID`, `DEPT_THREAD_ID` (получить: добавить бота в группу отдела, в нужной ветке дать команду `/id`).
2. Включить GitHub Pages для `docs/` (Settings → Pages → deploy from branch, папка `/docs`), вписать URL в `WEBAPP_URL`.
3. У BotFather `/setmenubutton` не требуется — Mini App открывается с reply-кнопки «Возможности отдела».

## Запуск

```powershell
python -m pip install -r requirements.txt
.\run_bot.ps1
```

Автозапуск при входе в систему (один раз, без прав администратора):

```powershell
.\register_autostart.ps1
```

## Статусы заявок

🆕 Новая → 👀 Принята → ⚙️ В работе → ✅ Готово / ❌ Отклонена.
Меняются кнопками под карточкой заявки в чате отдела; автор получает уведомление в личку.
