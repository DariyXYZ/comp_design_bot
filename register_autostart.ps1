# Регистрирует автозапуск бота при входе в Windows (без админ-прав).
# Запустить один раз: .\register_autostart.ps1
$taskName = "comp_design_bot"
$script = Join-Path $PSScriptRoot "run_bot.ps1"

$actionArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
    Write-Host "Задача '$taskName' создана. Бот будет стартовать при входе в систему."
    Write-Host "Запустить прямо сейчас: Start-ScheduledTask -TaskName '$taskName'"
} catch {
    Write-Host "Не удалось создать задачу: $($_.Exception.Message)"
    Write-Host "Запасной вариант - ярлык в shell:startup."
}
