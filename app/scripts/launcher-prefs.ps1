# SlayTheList — Launcher preferences reader (single source of truth)
#
# The launchers run before the API server exists, so they cannot ask it for a
# setting. The API mirrors the few settings they need into
# <data dir>\launcher-prefs.json (see writeLauncherPrefs in backend/api/src/store.ts);
# this reads one of them back and prints "true" or "false".
#
# Usage: launcher-prefs.ps1 -Name openBrowserOnStartup [-Default true] [-Root <app dir>]

param(
  [Parameter(Mandatory)] [string]$Name,
  [ValidateSet('true', 'false')] [string]$Default = 'true',
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$Root = $Root.TrimEnd('\', '/')

# The API's data dir follows its own working directory, so the normal location
# is backend\api\data. The repo-root data\ folder is the older layout.
$candidates = @(
  (Join-Path $Root 'backend\api\data\launcher-prefs.json'),
  (Join-Path (Split-Path -Parent $Root) 'data\launcher-prefs.json')
)

foreach ($file in $candidates) {
  if (-not (Test-Path $file)) { continue }
  try {
    $prefs = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  } catch {
    continue
  }
  $value = $prefs.$Name
  if ($null -eq $value) { continue }
  if ([bool]$value) { Write-Output 'true' } else { Write-Output 'false' }
  exit 0
}

Write-Output $Default
