# Creates Desktop and Start Menu shortcuts for the HIM+ Code portable build.
#
# The executable is located relative to this script, so the checkout can live
# anywhere. Pass -Target explicitly to point at a build outside the repository.
param(
  [string]$Target = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Target) {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  $Target = Join-Path $repoRoot 'release\HIM+Code-win32-x64\HIM+Code.exe'
}

if (-not (Test-Path -LiteralPath $Target)) {
  throw "HIM+ Code executable not found: $Target`nBuild or unpack the HIM+ Code distribution first, or pass -Target."
}

$target = (Resolve-Path -LiteralPath $Target).Path
$shell = New-Object -ComObject WScript.Shell
$workingDirectory = Split-Path -Parent $target
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
foreach ($directory in @($desktop, $programs)) {
  $shortcutPath = Join-Path $directory 'HIM+ Code.lnk'
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.IconLocation = "$target,0"
  $shortcut.Description = 'HIM+ Code'
  $shortcut.Save()
  Write-Output "created $shortcutPath"
}
