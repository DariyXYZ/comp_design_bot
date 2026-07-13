# Запуск comp_design_bot с автоперезапуском при падении.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

while ($true) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "bot.log" -Value "[$stamp] запуск бота" -Encoding utf8
    python -m bot.main 2>> "bot.err.log"
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "bot.log" -Value "[$stamp] бот упал (код $LASTEXITCODE), перезапуск через 10 сек" -Encoding utf8
    Start-Sleep -Seconds 10
}
