# comp_design_bot — сервер

Одно приложение ASP.NET Core (.NET 10), которое заменяет Python-бота и
Vercel-деплой Mini App. Три входа на одном хосте (`https://bot.ai.ind.studio`):

| Путь | Что это |
| --- | --- |
| `/` | Mini App — статический экспорт Next.js из `wwwroot`. Открывается по прямой ссылке из любого чата |
| `/api/*` | API Mini App: вход по `initData`, создание заявки, заявки и действия по ним, лента доски с обложками, подписка, загрузка фото в Pyrus, справочник проектов, карточки тем |
| `POST /telegram/webhook` | Бот `@comp_design_bot`: кнопки статусов под карточкой в чате отдела, причина отказа и вопрос заявителю текстом, уведомления автору и подписчикам, оценка. **Диалога заявки в боте нет** — заявка создаётся из Mini App через API |
| `GET /health` | `{"ok":true}` для проверки после выкладки |

Хранилище одно — Pyrus: форма-доска отдела `2457342` (заявки), справочник
«Проект» `278856`. Своей базы у сервиса нет: состояние «ждём текст в чате
отдела» живёт в памяти процесса и сбрасывается при рестарте (перенос в SQLite —
шаг 3 по `docs/ARCHITECTURE.md` §10).

Структура — по [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) и
[стандарту C#-сервисов бюро](../docs/csharp-standard.md).

## Состав

```
server/
├── CompDesignBot.slnx
├── global.json                      # SDK 10.0.x
├── Directory.Build.props            # net10.0, nullable, warnings as errors
├── Directory.Packages.props         # версии пакетов
├── src/CompDesignBot/
│   ├── Program.cs                   # логи, хост, подключение частей
│   ├── Hosting/                     # AppOptions из env, ServiceRegistration (DI), ошибки API, статика
│   ├── Features/
│   │   ├── Identity/                # initData → токен сессии; endpoint /api/auth/exchange
│   │   ├── Requests/                # RequestService (все операции с заявкой), IRequestRegistry,
│   │   │                            # IDeptChannel, поля доски и статусы, действия, endpoints
│   │   ├── Catalog/                 # карточки тем, справочник проектов, endpoints
│   │   ├── Feed/                    # лента доски с кэшем, endpoints
│   │   └── Notifications/           # INotifier и тексты уведомлений
│   ├── Channels/Telegram/           # webhook, очередь обновлений, кнопки статусов, тексты,
│   │                                # DeptChat (карточка в чат), TelegramNotifier (уведомления)
│   ├── Infrastructure/Pyrus/        # клиент Pyrus API v4, PyrusRequestRegistry
│   ├── Assets/welcome.jpg           # ссылка на ../promo/welcome.jpg
│   └── wwwroot/                     # статика Mini App (не в git, кладётся сборкой)
└── tests/CompDesignBot.Tests/       # xunit: логика + API + сценарии бота на фейках
```

Как связано: HTTP-endpoints и Telegram-канал вызывают один `RequestService`;
он пишет в реестр (`IRequestRegistry` → Pyrus), публикует карточку
(`IDeptChannel` → чат отдела) и уведомляет (`INotifier` → личка Telegram).

## Переменные окружения

Источник конфигурации — только переменные окружения (`.env`-файлов сервис не
читает). Обязательная переменная не задана — служба не стартует и пишет, какая.

| Переменная | Обяз. | Назначение |
| --- | --- | --- |
| `TELEGRAM_TOKEN` | да | Токен бота. Им подписаны данные запуска Mini App (`initData`) |
| `SESSION_SECRET` | да | Секрет токенов сессии Mini App. Отдельный от токена бота: утечка одного не отдаёт и бота, и все сессии. Любая длинная случайная строка; смена = все сессии сброшены |
| `PUBLIC_URL` | нет | Публичный https-адрес сервиса, например `https://bot.ai.ind.studio`. Задан — на старте регистрируется webhook `{PUBLIC_URL}/telegram/webhook`. **Не задан — webhook не трогается** (локальный запуск не отберёт обновления у рабочего бота) |
| `TELEGRAM_WEBHOOK_SECRET` | нет | Секрет webhook: Telegram присылает его в заголовке, чужие POST отбрасываются 403. Любая случайная строка |
| `WEBAPP_URL` | нет | Адрес Mini App для кнопки в сообщениях бота. Пустой — берётся `PUBLIC_URL/`. Только https. Тот же адрес задаётся в BotFather как Main Mini App — для прямой ссылки `t.me/comp_design_bot/app` |
| `DEPT_CHAT_ID` | нет | Чат отдела (`-1003204218879`). Без него заявки создаются в Pyrus, но карточка в чат не уходит |
| `DEPT_THREAD_ID` | нет | Ветка заявок в чате отдела (`5011`) |
| `PYRUS_LOGIN`, `PYRUS_SECURITY_KEY` | нет* | Аккаунт Pyrus с доступом к форме и правами администратора формы (иначе задачи не закрываются). Пустые — интеграция выключена: бот отвечает, но заявки не создаёт, API отдаёт 503/`disabled` |
| `PYRUS_FORM_ID` | нет* | Форма-доска, `2457342` |
| `PYRUS_PROJECT_CATALOG_ID` | нет | Справочник проектов, по умолчанию `278856` |
| `LOG_DIR` | нет | Папка логов, по умолчанию `logs/` рядом с exe. Файлы `bot-YYYYMMDD.log`, хранится 30 дней |
| `ASPNETCORE_URLS` | нет | Адрес прослушивания, например `http://127.0.0.1:5089` — за обратным прокси с HTTPS |

\* Без Pyrus сервис запускается, но бесполезен — это режим для локальной отладки.

Значения сейчас лежат у Дария: `.env` Python-бота (те же имена) и переменные
Vercel-проекта. Аккаунт Pyrus пока личный (`dariy.n@indarchitects.ru`) — все
задачи подписаны им; служебный аккаунт заводится отдельно и подставляется без
правки кода.

## Локальный запуск

```powershell
cd server
dotnet restore
dotnet build
dotnet test

$env:TELEGRAM_TOKEN = '...'; $env:SESSION_SECRET = 'любая-длинная-строка'
$env:PYRUS_LOGIN = '...'; $env:PYRUS_SECURITY_KEY = '...'; $env:PYRUS_FORM_ID = '2457342'
$env:DEPT_CHAT_ID = '-1003204218879'; $env:DEPT_THREAD_ID = '5011'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5089'
dotnet run --project src/CompDesignBot
```

`PUBLIC_URL` локально не задавать: иначе webhook переедет на localhost и
рабочий бот перестанет получать обновления. Проверить бота локально можно,
подав обновление в `POST /telegram/webhook` руками или через тесты
(`tests/…/BotFlowTests.cs` — сценарии на фейковых Telegram и Pyrus).

Статика Mini App для локального просмотра:

```powershell
cd web
npm ci
npm run build:static          # → web/out
Copy-Item -Recurse -Force out\* ..\server\src\CompDesignBot\wwwroot\
```

## Сборка

```powershell
cd server
dotnet publish src/CompDesignBot -c Release -o publish
cd ../web && npm run build:static
Copy-Item -Recurse -Force out\* ..\server\publish\wwwroot\
```

Итог — папка `publish/`: `CompDesignBot.exe`, зависимости, `Assets/welcome.jpg`,
`wwwroot/`. Framework-dependent: на сервере нужен ASP.NET Core Runtime 10
(на AI01 стоит).

Ровно это делает job `verify` в `.github/workflows/server.yml` на каждом пуше и
PR: `dotnet build/test/format`, `npm lint/typecheck/test`, экспорт, publish —
и выкладывает артефакт `server-publish`.

## Установка службы на AI01

Один раз, от администратора:

```powershell
$dir = 'C:\Services\CompDesignBot'
New-Item -ItemType Directory -Force $dir
# распаковать сюда артефакт server-publish (или папку publish/ из сборки)

sc.exe create CompDesignBot binPath= "$dir\CompDesignBot.exe" start= auto DisplayName= "Comp Design Bot"
sc.exe description CompDesignBot "Telegram-бот и Mini App отдела вычислительного проектирования"
sc.exe failure CompDesignBot reset= 86400 actions= restart/5000/restart/30000/restart/60000
```

Переменные окружения — только для этой службы, в реестре (машинные переменные
не трогаем; секреты не попадают в общий список):

```powershell
$vars = @(
  'TELEGRAM_TOKEN=...',
  'SESSION_SECRET=...',
  'TELEGRAM_WEBHOOK_SECRET=...',
  'PUBLIC_URL=https://bot.ai.ind.studio',
  'DEPT_CHAT_ID=-1003204218879',
  'DEPT_THREAD_ID=5011',
  'PYRUS_LOGIN=...',
  'PYRUS_SECURITY_KEY=...',
  'PYRUS_FORM_ID=2457342',
  'ASPNETCORE_URLS=http://127.0.0.1:5089'
)
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\CompDesignBot' -Name Environment -Value $vars -Type MultiString
Start-Service CompDesignBot
Invoke-WebRequest http://127.0.0.1:5089/health
```

Обратный прокси (IIS/nginx/Caddy — как принято на AI01) терминирует HTTPS для
`bot.ai.ind.studio` и проксирует на `127.0.0.1:5089` целиком: и `/`, и
`/api/*`, и `/telegram/webhook`. Telegram шлёт webhook только на https с
валидным сертификатом. Заголовков `X-Forwarded-*` сервису не нужно — он не
строит абсолютных адресов из запроса.

Логи: `C:\Services\CompDesignBot\logs\bot-YYYYMMDD.log`. Служба стартует и без
Telegram/Pyrus (ошибки на старте — в лог, не падение): сеть может подняться позже.

Прежние NSSM-скрипты в `deploy/windows/` относятся к Python-версии и больше не
нужны.

## Деплой через GitHub Actions

Job `deploy` в `server.yml` включается переменной репозитория
`DEPLOY_ENABLED=true` (Settings → Secrets and variables → Actions → Variables)
и работает только с `main`. Нужен self-hosted runner на AI01 с метками
`self-hosted, windows, ai01`, запущенный от учётной записи с правом
останавливать/запускать службу и писать в папку службы. Environment `ai01` в
настройках репозитория — для правила «кто может деплоить» и защиты ветки.

Что делает job: скачивает артефакт `verify`, останавливает службу,
`robocopy /MIR` в папку (папка `logs` не трогается), запускает службу, ждёт
`/health`. Переменные `DEPLOY_DIR` (по умолчанию `C:\Services\CompDesignBot`)
и `HEALTH_PORT` (по умолчанию `5089`) задаются там же, где `DEPLOY_ENABLED`.

Секретов в workflow нет: конфигурация службы живёт на сервере.

## Переключение с Python-бота и Vercel

Порядок важен: у Telegram один получатель обновлений на токен.

0. **Клиент Mini App переведён на API** (`web/`): форма отправляет
   `POST /api/requests` вместо `sendData`, вход только через
   `POST /api/auth/exchange`, при первой заявке — `requestWriteAccess()`.
   Без этого новый сервер заявки из старого клиента не примет (он не
   обрабатывает `sendData`). Пока клиент на Vercel работает с Python-ботом.
1. В BotFather настроен Main Mini App с адресом сервиса — прямая ссылка
   `t.me/comp_design_bot/app` открывает приложение из любого чата.
2. Служба на AI01 установлена, переменные заданы **без `PUBLIC_URL`**, `/health`
   отвечает, `/` показывает Mini App, `/api/topics/` отдаёт карточки.
3. Остановить Python-бота на машине Дария (иначе после регистрации webhook его
   long polling начнёт получать ошибки).
4. Добавить `PUBLIC_URL` в переменные службы и перезапустить её — сервис сам
   вызовет `setWebhook`. Проверить: `/start` в боте отвечает кнопкой, заявка из
   Mini App доходит до доски и в чат отдела, кнопки статусов работают.
5. Vercel-проект отключить. Старые кнопки в чатах ведут на Vercel-адрес —
   можно оставить там редирект на новый адрес на пару недель.
6. В репозитории удалить `bot/`, `api/`, `web/src/app/api`, `web/src/lib/server`,
   переключатель `NEXT_OUTPUT` в `web/next.config.ts`, `bot-csharp/`,
   `deploy/windows/`.

Откат — обратный порядок: убрать `PUBLIC_URL`, `deleteWebhook`
(`https://api.telegram.org/bot<token>/deleteWebhook`), запустить Python-бота.

## Архитектурные решения

- **Один сервис заявок.** `Features/Requests/RequestService` — создать,
  сменить статус, действие заявителя, причина отказа, вопрос, оценка, подписка.
  HTTP и Telegram зовут его; цепочка «Pyrus → карточка в чат → уведомление»
  существует в одном экземпляре.
- **Заявка через API, бота-диалога нет.** Mini App открывается по прямой
  ссылке, отправляет форму в `POST /api/requests`; картинки грузятся заранее
  через `POST /api/uploads` и едут guid-ами. Бот отвечает на любой текст в
  личке кнопкой приложения.
- **Вход — только `initData`.** Токен сессии подписан `SESSION_SECRET`,
  продлевается заголовком `X-Session-Token`, когда осталось меньше недели.
  Второй способ входа (Plancy, вне Telegram) — отдельный этап.
- **Webhook отвечает сразу, обработка — в очереди** (`UpdateQueue` +
  `UpdateWorker`): Telegram повторяет обновление, если ответ задержался.
  Обновления обрабатываются параллельно, гонки на одной заявке закрывает лок.
- **Состояние «ждём текст» в памяти.** Причина отказа и вопрос заявителю —
  следующее сообщение того же человека в чате отдела; перезапуск службы это
  ожидание теряет. Перенос в SQLite — шаг 3 по `docs/ARCHITECTURE.md`.
- **Уведомления в личку** возможны только после `/start` или разрешения
  `requestWriteAccess` из Mini App. Отказ — «не доставлено» в логе, статус всё
  равно виден в приложении.
- **Pyrus — по названиям полей**, не по id (API не отдаёт коды полей, id
  меняются при пересоздании). Схема кэшируется по форме на время жизни
  процесса — после правки формы службу перезапустить.
- **Ошибки внешних систем.** Адаптер бросает `PyrusException`; сервис заявок
  решает, что критично (запись — наверх), а что нет (картинки, id карточки —
  в лог). HTTP превращает исключение в 502 одним фильтром, канал — в ответ
  человеку.
- **Подписки** пока комментариями в задаче (`Подписка: tg:<id>`); со штатными
  подписчиками Pyrus заменяются, когда появится учётка сотрудника.
- **Кэши в памяти**: лента 2 минуты, справочник проектов 10 минут.

## Отличия от стандарта

- Решение в формате `.slnx` (новый формат `dotnet new sln` в SDK 10), а не `.sln`.
- `wwwroot/` не в git: статика собирается из `web/` на CI и кладётся рядом с
  публикацией; в репозитории папка пустая.
- Секрет webhook не обязателен: без него любой, кто знает адрес, может
  подсунуть боту обновление. На проде задать.
- `Features/Feed` читает `IPyrusClient` напрямую (нужны вложения и комментарии
  задач) — контракта уровня модуля у ленты пока нет.
