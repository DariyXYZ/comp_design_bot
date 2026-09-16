# Развёртывание на Windows-сервере (AI01, bot.ai.ind.studio)

Два службы Windows через [NSSM](https://nssm.cc/download) — он оборачивает
любой процесс в службу с автозапуском и перезапуском при падении.

| Служба | Процесс | Порт |
|---|---|---|
| `comp_design_bot` | `python -m bot.main` (long polling, входящих нет) | — |
| `comp_design_web` | `node node_modules\next\dist\bin\next start -p 3000` | 3000 |

## Шаги

1. Клонировать репо, например в `C:\services\comp_design_bot`.
2. Положить `.env` в корень (см. `.env.example`: токен бота, чат отдела, Pyrus)
   и `web\.env.local` (те же `TELEGRAM_TOKEN`, `PYRUS_*`, `DEPT_*`).
3. Python 3.12: `pip install -r requirements.txt`.
4. Node 20+: `cd web && npm ci && npm run build`.
5. Положить `nssm.exe` рядом со скриптами и запустить от администратора:
   `powershell -ExecutionPolicy Bypass -File deploy\windows\install-services.ps1`
6. Reverse-proxy на `https://bot.ai.ind.studio/` → `http://127.0.0.1:3000`
   (IIS ARR / nginx / Caddy — чем у вас терминируется HTTPS).
7. У бота в `.env`: `WEBAPP_URL=https://bot.ai.ind.studio/`. Тот же адрес —
   в BotFather (Main App, Menu Button).

Обновление: `git pull`, `npm run build` в `web`, `nssm restart comp_design_web`,
`nssm restart comp_design_bot`. Логи — `deploy\windows\logs\`.

Работать должен один экземпляр бота: перед запуском службы выключить бота
на ПК Дария (два процесса с одним токеном спорят за обновления Telegram).
