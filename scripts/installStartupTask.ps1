$ErrorActionPreference = 'Stop'

$taskName = 'DrSnugglesDevWatchdog'
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$nodeCmd = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeCmd) {
  throw "node.exe not found on PATH. Install Node.js and retry."
}

$command = "Set-Location -LiteralPath '$projectDir'; & '$nodeCmd' scripts/devWatchdog.js"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `$ErrorActionPreference='Stop'; $command"
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerLogon, $triggerStartup) -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Installed startup task: $taskName"
