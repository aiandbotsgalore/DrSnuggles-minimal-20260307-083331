param(
  [switch]$CopyToWorkspace,
  [string]$StagingDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "chat_images"),
  [switch]$NoClipboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select an image for Codex chat"
$dialog.Filter = "Image Files|*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp|All Files|*.*"
$dialog.Multiselect = $false

$result = $dialog.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host "No image selected."
  exit 0
}

$selectedPath = (Resolve-Path $dialog.FileName).Path
$finalPath = $selectedPath

if ($CopyToWorkspace) {
  if (-not (Test-Path -LiteralPath $StagingDir)) {
    New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $source = Get-Item -LiteralPath $selectedPath
  $safeBase = [System.IO.Path]::GetFileNameWithoutExtension($source.Name) -replace "[^a-zA-Z0-9-_]", "_"
  if ([string]::IsNullOrWhiteSpace($safeBase)) {
    $safeBase = "image"
  }
  $targetName = "{0}-{1}{2}" -f $timestamp, $safeBase, $source.Extension
  $targetPath = Join-Path $StagingDir $targetName

  Copy-Item -LiteralPath $selectedPath -Destination $targetPath -Force
  $finalPath = (Resolve-Path $targetPath).Path
}

$message = "Please analyze this image: $finalPath"

if (-not $NoClipboard) {
  try {
    Set-Clipboard -Value $message
  } catch {
    [System.Windows.Forms.Clipboard]::SetText($message)
  }
}

Write-Host ""
Write-Host "Image ready for chat."
Write-Host "Path: $finalPath"
Write-Host ""
if (-not $NoClipboard) {
  Write-Host "Copied to clipboard:"
  Write-Host $message
} else {
  Write-Host "Chat message (copy manually):"
  Write-Host $message
}
Write-Host ""
Write-Host "Paste the message into Codex chat."
