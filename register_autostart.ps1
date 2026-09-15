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
    # Планировщик закрыт политикой (Access is denied на рабочей машине) —
    # ярлык в автозагрузке пользователя делает то же самое без прав.
    Write-Host "Планировщик недоступен: $($_.Exception.Message)"
    $startup = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startup "$taskName.lnk"
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = $actionArgs
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.Description = "$taskName autostart"
    $shortcut.Save()
    Write-Host "Ярлык в автозагрузке создан: $lnk. Бот будет стартовать при входе в систему."
}
