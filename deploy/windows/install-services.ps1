# Ставит две службы Windows через NSSM. Запускать от администратора из корня репо.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nssm = Join-Path $PSScriptRoot "nssm.exe"
if (-not (Test-Path $nssm)) { throw "Положите nssm.exe в $PSScriptRoot (https://nssm.cc/download)" }
$logs = Join-Path $PSScriptRoot "logs"; New-Item -ItemType Directory -Force $logs | Out-Null
$python = (Get-Command python).Source
$node = (Get-Command node).Source

function Install-Svc($name, $exe, $args, $dir) {
    & $nssm stop $name 2>$null; & $nssm remove $name confirm 2>$null
    & $nssm install $name $exe $args
    & $nssm set $name AppDirectory $dir
    & $nssm set $name AppStdout (Join-Path $logs "$name.out.log")
    & $nssm set $name AppStderr (Join-Path $logs "$name.err.log")
    & $nssm set $name AppRotateFiles 1
    & $nssm set $name AppRotateBytes 5000000
    & $nssm set $name AppExit Default Restart
    & $nssm set $name AppRestartDelay 10000
    & $nssm set $name Start SERVICE_AUTO_START
    & $nssm start $name
    Write-Host "Служба $name установлена и запущена."
}

Install-Svc "comp_design_bot" $python "-m bot.main" $root
Install-Svc "comp_design_web" $node "node_modules\next\dist\bin\next start -p 3000" (Join-Path $root "web")
