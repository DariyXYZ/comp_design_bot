# Локальный стенд C#-сервера с публичным адресом через Cloudflare quick tunnel.
#
# Что делает: читает server/.env.dev, поднимает туннель до 127.0.0.1:5089,
# подставляет его адрес в PUBLIC_URL/WEBAPP_URL, собирает статику Mini App в
# wwwroot (если -SkipWeb не задан) и запускает dotnet run. Webhook тестового бота
# регистрируется сам (PUBLIC_URL задан).
#
# Адрес туннеля новый при каждом запуске: его нужно вписать в BotFather →
# тестовый бот → Bot Settings → Configure Mini App (иначе прямая ссылка
# t.me/<бот>/app не откроется). Кнопка в /start подхватывает адрес сама.
#
# Требования: dotnet 10, node, cloudflared.exe (portable, путь ниже).

param(
    [string]$EnvFile = "$PSScriptRoot\..\.env.dev",
    [string]$Cloudflared = "C:\VS Code\tools\cloudflared\cloudflared.exe",
    [switch]$SkipWeb
)

$ErrorActionPreference = "Stop"
$server = Resolve-Path "$PSScriptRoot\.."
$repo = Resolve-Path "$server\.."

if (-not (Test-Path $EnvFile)) { throw "Нет $EnvFile — скопируйте .env.dev.example и заполните" }
if (-not (Test-Path $Cloudflared)) { throw "Нет $Cloudflared — скачать: https://github.com/cloudflare/cloudflared/releases (cloudflared-windows-amd64.exe)" }

foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    $line = $line.Trim()
    if ($line -eq "" -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
    $key, $value = $line.Split("=", 2)
    if ($value.Trim() -ne "") { Set-Item "Env:$($key.Trim())" $value.Trim().Trim("'", '"') }
}
if (-not $env:TELEGRAM_TOKEN) { throw "TELEGRAM_TOKEN пуст в $EnvFile" }
$port = if ($env:ASPNETCORE_URLS) { ([uri]$env:ASPNETCORE_URLS).Port } else { 5089 }

# Туннель. Протокол по умолчанию (QUIC с откатом на http2): отсюда часть
# edge-адресов не отвечает, и первое соединение может занять до минуты —
# ждём именно регистрации, а не появления адреса в логе.
$tunnelLog = Join-Path $env:TEMP "cdb-tunnel.log"
Remove-Item $tunnelLog -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath $Cloudflared -ArgumentList "tunnel", "--url", "http://127.0.0.1:$port" `
    -RedirectStandardError $tunnelLog -PassThru -WindowStyle Hidden
$publicUrl = $null
$registered = $false
for ($i = 0; $i -lt 90 -and -not $registered; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path $tunnelLog)) { continue }
    if (-not $publicUrl) {
        $m = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($m) { $publicUrl = $m.Matches[0].Value }
    }
    if (Select-String -Path $tunnelLog -Pattern "Registered tunnel connection" -Quiet) { $registered = $true }
}
if (-not $registered) { Stop-Process $tunnel -ErrorAction SilentlyContinue; throw "Туннель не поднялся за 90 с, см. $tunnelLog" }

$env:PUBLIC_URL = $publicUrl
$env:WEBAPP_URL = "$publicUrl/"
Write-Host ""
Write-Host "Публичный адрес: $publicUrl" -ForegroundColor Green
Write-Host "BotFather → тестовый бот → Configure Mini App → $publicUrl/" -ForegroundColor Yellow
Write-Host ""

try {
    if (-not $SkipWeb) {
        Push-Location "$repo\web"
        if (-not (Test-Path node_modules)) { npm ci }
        npm run build:static
        if ($LASTEXITCODE -ne 0) { throw "npm run build:static: $LASTEXITCODE" }
        Pop-Location
        $wwwroot = "$server\src\CompDesignBot\wwwroot"
        Remove-Item -Recurse -Force $wwwroot -ErrorAction SilentlyContinue
        Copy-Item -Recurse "$repo\web\out" $wwwroot
    }

    Push-Location "$server\src\CompDesignBot"
    dotnet run
    Pop-Location
}
finally {
    Stop-Process $tunnel -ErrorAction SilentlyContinue
}
