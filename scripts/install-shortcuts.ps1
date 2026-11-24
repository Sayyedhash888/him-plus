$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'release\HIM+-win32-x64\HIM+.exe'
$icon = Join-Path $root 'release\HIM+-win32-x64\HIM+.ico'

if (-not (Test-Path -LiteralPath $target)) {
  throw "Packaged app not found at $target. Run npm run package:win first."
}

$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

foreach ($directory in @($programs, $desktop)) {
  $shortcutPath = Join-Path $directory 'HIM+.lnk'
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = Split-Path -Parent $target
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = 'HIM+ - Integrated Development Environment'
  $shortcut.Save()
  Write-Output "Shortcut: $shortcutPath"
}

Write-Output "Start Menu: $programs"
Write-Output "Desktop: $desktop"