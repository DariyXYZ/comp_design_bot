$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

# Мьютекс: второй запуск (автостарт плюс ручной) не должен драться за порт.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\comp_design_api", [ref]$created)
if (-not $created) {
    Write-Host "comp_design API is already running"
    exit 0
}

# Осиротевший child предыдущей обёртки держит порт и ломает restart-loop.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'uvicorn api\.main:app' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

while ($true) {
    if ((Test-Path "api.err.log") -and ((Get-Item "api.err.log").Length -gt 5MB)) {
        Move-Item -Force "api.err.log" "api.err.old.log"
    }
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "api.log" -Value "[$stamp] запуск API" -Encoding utf8
    # cmd /c: байтовый redirect без PowerShell ErrorRecord/UTF-16 обёртки.
    cmd /c "python -m uvicorn api.main:app --host 127.0.0.1 --port 8011 2>> api.err.log"
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "api.log" -Value "[$stamp] API упал (код $LASTEXITCODE), перезапуск через 10 сек" -Encoding utf8
    Start-Sleep -Seconds 10
}
