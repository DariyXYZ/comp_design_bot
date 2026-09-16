# comp_design_bot — сервер

Одно приложение ASP.NET Core (.NET 10), которое заменяет Python-бота и
Vercel-деплой Mini App. Три входа на одном хосте (`https://bot.ai.ind.studio`):

| Путь | Что это |
| --- | --- |
| `POST /telegram/webhook` | Бот `@comp_design_bot` (Telegram.Bot): диалог заявки, приём формы из Mini App, карточка с кнопками в чате отдела, уточнение, причина отказа, уведомления, оценка |
| `/api/*` | API Mini App: вход по коду и `initData`, заявки и действия по ним, лента доски с обложками, подписка, загрузка фото в Pyrus, справочник проектов, карточки тем |
| `/` | Mini App — статический экспорт Next.js из `wwwroot` |
| `GET /health` | `{"ok":true}` для проверки после выкладки |

Хранилище одно — Pyrus: форма-доска отдела `2457342` (заявки), справочник
«Проект» `278856`. Своей базы у сервиса нет: состояние диалогов живёт в памяти
процесса и сбрасывается при рестарте (как и раньше у Python-бота).

Проект собран по [стандарту C#-сервисов бюро](../docs/csharp-standard.md).

## Состав

```
server/
├── CompDesignBot.slnx
├── global.json                      # SDK 10.0.x
├── Directory.Build.props            # net10.0, nullable, warnings as errors
├── Directory.Packages.props         # версии пакетов
├── src/CompDesignBot/
│   ├── Program.cs                   # DI, конвейер, маршруты
│   ├── Config/AppOptions.cs         # переменные окружения → options
│   ├── Endpoints/                   # /api/*, /telegram/webhook
│   ├── Features/
│   │   ├── Auth/                    # initData, токены сессии, коды входа
│   │   ├── Bot/                     # тексты, клавиатуры, FSM, обработчики, очередь
│   │   ├── Requests/                # заявка: поля доски, статусы, карточка, действия
│   │   ├── Feed/                    # лента доски с кэшем
│   │   └── Topics/                  # карточки тем, справочник проектов
│   ├── Infrastructure/
│   │   ├── Pyrus/                   # клиент Pyrus API v4
│   │   └── Telegram/                # чат отдела
│   ├── Assets/welcome.jpg           # ссылка на ../promo/welcome.jpg
│   └── wwwroot/                     # статика Mini App (не в git, кладётся сборкой)
└── tests/CompDesignBot.Tests/       # xunit: логика + API + сценарии бота на фейках
```

## Переменные окружения

Источник конфигурации — только переменные окружения (`.env`-файлов сервис не
читает). Обязательная переменная не задана — служба не стартует и пишет, какая.

| Переменная | Обяз. | Назначение |
| --- | --- | --- |
| `TELEGRAM_TOKEN` | да | Токен бота. Им же подписаны коды входа и токены сессии Mini App — формат общий с прежними версиями, выданные кнопки и токены продолжают работать |
| `PUBLIC_URL` | нет | Публичный https-адрес сервиса, например `https://bot.ai.ind.studio`. Задан — на старте регистрируется webhook `{PUBLIC_URL}/telegram/webhook`. **Не задан — webhook не трогается** (локальный запуск не отберёт обновления у рабочего бота) |
| `TELEGRAM_WEBHOOK_SECRET` | нет | Секрет webhook: Telegram присылает его в заголовке, чужие POST отбрасываются 403. Любая случайная строка |
| `WEBAPP_URL` | нет | Адрес Mini App для кнопки в чате. Пустой — берётся `PUBLIC_URL/`. Только https |
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

$env:TELEGRAM_TOKEN = '...'
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

1. Служба на AI01 установлена, переменные заданы **без `PUBLIC_URL`**, `/health`
   отвечает, `/` показывает Mini App, `/api/topics/` отдаёт карточки.
2. Остановить Python-бота на машине Дария (иначе после регистрации webhook его
   long polling начнёт получать ошибки).
3. Добавить `PUBLIC_URL` в переменные службы и перезапустить её — сервис сам
   вызовет `setWebhook`. Проверить: `/start` в боте отвечает, кнопка ведёт на
   `bot.ai.ind.studio`, заявка из Mini App доходит до доски и в чат отдела.
4. Vercel-проект отключить. Старые кнопки в чатах ведут на Vercel-адрес — люди
   получат новую кнопку после `/start` или `/app`; можно оставить на Vercel
   редирект на новый адрес на пару недель.
5. В репозитории удалить `bot/`, `api/`, `web/src/app/api`, `web/src/lib/server`,
   переключатель `NEXT_OUTPUT` в `web/next.config.ts`, `bot-csharp/`,
   `deploy/windows/`, workflow `deploy-draft.yml`.

Откат — обратный порядок: убрать `PUBLIC_URL`, `deleteWebhook`
(`https://api.telegram.org/bot<token>/deleteWebhook`), запустить Python-бота.

## Архитектурные решения

- **Логика бота перенесена 1:1 из `bot/`** (Python/aiogram): порядок
  обработчиков, состояния диалога, тексты, формат карточки в чате, комментарии
  в Pyrus. `bot-csharp/` (черновик августа) не использовался: он на SQLite,
  которого больше нет.
- **Webhook отвечает сразу, обработка — в очереди** (`UpdateQueue` +
  `UpdateWorker`): Telegram повторяет обновление, если ответ задержался, а
  отправка заявки (Pyrus + альбом в чат) занимает секунды. Обновления
  обрабатываются параллельно, гонки внутри одного диалога закрывают локи на
  пользователя и на заявку — как в aiogram.
- **FSM в памяти.** Черновик заявки и «жду текст от этого человека» не
  переживают рестарт. Это перенесённое решение, не упущение: вариант с реплаями
  и базой в Python-версии оказался непонятным людям и был убран.
- **Токены общие с прежними версиями.** Код входа в кнопке (`?c=`), токен
  сессии и его продление в `X-Session-Token` — тот же формат
  `base64url(payload).base64url(HMAC-SHA256)` с секретом = токен бота, поэтому
  кнопки в старых чатах и сессии в приложении переживают переезд.
- **Pyrus — по названиям полей**, не по id (API не отдаёт коды полей, id
  меняются при пересоздании). Переименованное поле видно в логе, заявку не ломает.
- **Ошибки внешних систем.** Для бота методы `RequestStore` не бросают: в чате
  статус уже сменён, заявка уже создана — ошибка идёт в лог. Для API те же
  операции с суффиксом `OrThrow`, и фильтр `ApiErrorFilter` превращает
  `PyrusException` в 502, `AuthException` в 401 с причиной.
- **Кэши в памяти**: лента 2 минуты, справочник проектов 10 минут, схема формы —
  на время жизни процесса (после правки формы в Pyrus службу перезапустить).

## Отличия от стандарта

- Решение в формате `.slnx` (новый формат `dotnet new sln` в SDK 10), а не `.sln`.
- `wwwroot/` не в git: статика собирается из `web/` на CI и кладётся рядом с
  публикацией; в репозитории папка пустая.
- Секрет webhook не обязателен: без него любой, кто знает адрес, может
  подсунуть боту обновление. На проде задать.
