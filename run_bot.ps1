# Запуск comp_design_bot с автоперезапуском при падении.
# Однократный запуск гарантируется мьютексом: вторая копия (ручной запуск
# поверх задачи планировщика) сразу выходит, иначе два polling-процесса
# дерутся за getUpdates с ошибкой 409.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\comp_design_bot", [ref]$created)
if (-not $created) {
    Write-Host "comp_design_bot уже запущен - выходим."
    exit 0
}

while ($true) {
    # Ротация: не даём err-логу расти бесконечно на 24/7 работе.
    if ((Test-Path "bot.err.log") -and ((Get-Item "bot.err.log").Length -gt 5MB)) {
        Move-Item -Force "bot.err.log" "bot.err.old.log"
    }
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "bot.log" -Value "[$stamp] запуск бота" -Encoding utf8
    python -m bot.main 2>> "bot.err.log"
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "bot.log" -Value "[$stamp] бот упал (код $LASTEXITCODE), перезапуск через 10 сек" -Encoding utf8
    Start-Sleep -Seconds 10
}
