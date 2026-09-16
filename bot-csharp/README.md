# comp_design_bot — C#-порт

Полный перенос `bot/` (Python/aiogram 3) на C# (.NET 8 + Telegram.Bot 22 +
Microsoft.Data.Sqlite). Архитектура, FSM-переходы, тексты, формат карточки
заявки и формат БД сохранены один в один — это не переписывание "по мотивам",
а построчный порт с той же логикой блокировок и той же схемой SQLite.

> Собирается (`dotnet build`) и проверен смоук-тестом слоя БД (создание схемы,
> миграция колонок, CRUD, JSON-фото, кириллица) без реального Telegram-токена.
> Живого прогона с реальным ботом не было — токен для этого не выдавался.

## Структура

```
CompDesignBot.csproj
Program.cs            # main.py: инициализация, long polling, диспетчер обновлений
Config.cs              # config.py: чтение .env
Db.cs                   # db.py: SQLite (та же схема, тот же файл requests.sqlite3)
RequestRecord.cs         # строка таблицы requests (аналог dict-строк aiosqlite)
Texts.cs                # texts.py: все тексты и кейсы, дословно
Keyboards.cs             # keyboards.py: клавиатуры
StateStore.cs             # аналог aiogram FSMContext + asyncio.Lock (см. ниже)
BotContext.cs              # общие зависимости, которые aiogram сам подставлял в хендлер

Handlers/
  StartHandler.cs      # handlers/start.py
  CreateHandler.cs      # handlers/create.py — FSM заявки, рендерер карточки
  DeptHandler.cs         # handlers/dept.py — статусы в чате отдела
  FeedbackHandler.cs      # handlers/feedback.py — оценка результата
```

## Чем C#-версия отличается от Python по механике (не по поведению)

aiogram даёт из коробки: роутеры с фильтрами, `FSMContext` (состояние +
данные черновика на ключ `(chat_id, user_id)`), глобальный parse_mode. В
Telegram.Bot этого нет "из коробки", поэтому:

- **Диспетчер** (`Program.cs`, `HandleMessageAsync`/`HandleCallbackAsync`) —
  явная цепочка `if`, воспроизводящая порядок роутеров aiogram один в один
  (см. комментарии `--- start.py ---` / `--- create.py ---` и т.д.). Порядок
  критичен: кнопки меню должны прерывать черновик заявки/отзыва, а не
  попадать в текст-ловушку состояния — как и в оригинале.
- **`StateStore`** — свой `enum BotState`, объединяющий все состояния
  из трёх разных `StatesGroup` Python-версии (`NewRequest`, `DeptReply`,
  `FeedbackComment`) в одно поле на ключ `(chat_id, user_id)` — именно так
  физически устроен `FSMContext` в aiogram, отсюда и защита от "уже открыт
  вопрос по другой заявке" работает идентично.
- **`KeyedAsyncLock`** — замена двух словарей `asyncio.Lock` (`_user_locks`
  в create.py, `_req_locks` в dept.py).
- **HTML parse mode** — в aiogram это глобальная настройка бота
  (`DefaultBotProperties(parse_mode=Html)`), в Telegram.Bot нет глобального
  дефолта — `ParseMode.Html` передаётся явно в каждый вызов, где Python
  полагался на дефолт.
- **Экранирование** — как и в Python, только `RequestCard()` (рендерер
  карточки) экранирует пользовательский текст (`WebUtility.HtmlEncode` ≈
  `html.escape`). Остальные шаблоны в `Texts.cs` вставляют текст без
  экранирования — так же, как в оригинале (это существующая, не новая,
  особенность: контакт/причина отклонения/отзыв технически могут сломать
  HTML-парсинг, если в них окажется `<`; в проде это не происходило).
- **Обрезка подписи к фото** (`CaptionLimit = 1024`) считает длину в
  Unicode code points через `Rune`, а не в UTF-16 code units — это точно
  повторяет арифметику Python `len()`, а не "естественную" длину C#-строки
  (там, где в тексте встречаются эмодзи вне BMP, это разные числа).

## Совместимость данных

Схема и миграция колонок в `Db.cs` идентичны `db.py` — файл
`requests.sqlite3`, созданный Python-версией, открывается C#-версией без
изменений (и наоборот). `photo_file_ids` хранится тем же JSON-массивом строк.

## Настройка и запуск

```powershell
cd bot-csharp
# вписать реальные TELEGRAM_TOKEN / DEPT_CHAT_ID / DEPT_THREAD_ID в .env
dotnet run
```

Публикация одним файлом:

```powershell
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
```

**Не запускать одновременно с Python-версией на одном и том же
TELEGRAM_TOKEN** — Telegram отдаёт `getUpdates` только одному процессу,
второй начнёт получать `409 Conflict`. Для параллельного прогона нужен
отдельный токен (второй бот у @BotFather) и свой `DB_FILE`.

## Чего нет (как и в Python-версии)

Нет тестов и CI — черновой прототип, перенос делает архитектуру доступной
для последующей разработки, а не готовым к продакшену сервисом.
