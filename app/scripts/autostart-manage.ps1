# SlayTheList — Auto-start management (single source of truth)
# Creates / removes / reports the Startup-folder shortcut that launches
# SlayTheList at login. Used by both the GUI launcher and the API server.
# Prints the resulting state as a single JSON line: {"enabled":bool,"path":"..."}

param(
  [Parameter(Mandatory)] [ValidateSet('status', 'enable', 'disable')] [string]$Action,
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Mode = 'browser'
)

$ErrorActionPreference = 'Stop'
$Root = $Root.TrimEnd('\', '/')
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'SlayTheList.lnk'

switch ($Action) {
  'enable' {
    $vbs = Join-Path $Root 'scripts\autostart.vbs'
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $wscript
    $sc.Arguments = "`"$vbs`" $Mode"
    $sc.WorkingDirectory = $Root
    $sc.Description = "Launch SlayTheList at login ($Mode mode)"
    $sc.Save()
  }
  'disable' {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
  }
}

[pscustomobject]@{ enabled = [bool](Test-Path $lnk); path = $lnk } | ConvertTo-Json -Compress
