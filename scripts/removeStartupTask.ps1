$ErrorActionPreference = 'Stop'

$taskName = 'DrSnugglesDevWatchdog'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed startup task: $taskName"
} else {
  Write-Host "Startup task not found: $taskName"
}
