# Регистрирует автозапуск бота при входе в Windows (без админ-прав).
# Запустить один раз: .\register_autostart.ps1
$taskName = "comp_design_bot"
$script = Join-Path $PSScriptRoot "run_bot.ps1"
$action = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

schtasks /Create /F /TN $taskName /SC ONLOGON /TR $action /RL LIMITED
if ($LASTEXITCODE -eq 0) {
    Write-Host "Задача '$taskName' создана. Бот будет стартовать при входе в систему."
    Write-Host "Запустить прямо сейчас: schtasks /Run /TN $taskName"
} else {
    Write-Host "Не удалось создать задачу через schtasks. Запасной вариант - ярлык в shell:startup."
}
