@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "MODE=%~1"

REM -- Parse CLI argument ---------------------------------------------------
if /I "%MODE%"=="browser"  goto browser
if /I "%MODE%"=="desktop"  goto desktop
if /I "%MODE%"=="stop"     goto stop

REM -- GUI launcher (no console flash) --------------------------------------
cscript //nologo "%ROOT%scripts\launcher.vbs" "%ROOT%"
exit /b 0

REM -- Preflight checks ------------------------------------------------------
:preflight
if not exist "%ROOT%node_modules" (
  echo Dependencies not found. Run install.bat first.
  pause
  exit /b 1
)
if not exist "%ROOT%shared\contracts\dist" (
  echo Contracts not built. Run install.bat first.
  pause
  exit /b 1
)
exit /b 0

REM -- Kill previous SlayTheList processes -----------------------------------
:kill_previous
echo Stopping previous SlayTheList processes...

taskkill /F /T /FI "WINDOWTITLE eq SlayTheList API*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList Web*" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [Regex]::Escape((Resolve-Path '%ROOT%').Path); " ^
  "$rx = '(dev:api|@slaythelist/api run dev|tsx watch src/server.ts|dev:web|@slaythelist/web run dev|next dev|startup-status)'; " ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; " ^
  "foreach ($p in $procs) { " ^
  "  $cmd = $p.CommandLine; " ^
  "  if ($cmd -and ($cmd -match $root) -and ($cmd -match $rx)) { cmd /c taskkill /PID $($p.ProcessId) /T /F >$null 2>&1 } " ^
  "}" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [Regex]::Escape((Resolve-Path '%ROOT%').Path); " ^
  "$ports = @(8788, 4000, 4001, 4002, 4003); " ^
  "foreach ($port in $ports) { " ^
  "  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "  foreach ($pid in $pids) { " ^
  "    $p = Get-CimInstance Win32_Process -Filter \"ProcessId = $pid\" -ErrorAction SilentlyContinue; " ^
  "    if ($p -and $p.CommandLine -and $p.CommandLine -match $root) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } " ^
  "  } " ^
  "}; " ^
  "Get-Process -Name 'SlayTheList.OverlayAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1

ping 127.0.0.1 -n 2 >nul
exit /b 0

REM -- Stop ------------------------------------------------------------------
:stop
call :kill_previous
echo Done.
exit /b 0

REM -- Browser mode ----------------------------------------------------------
:browser
call :preflight
if errorlevel 1 exit /b 1

REM Auto-stop any previous instance
call :kill_previous

REM Sync overlay assets
if not exist "%ROOT%frontend\web\public\blocked-overlays" mkdir "%ROOT%frontend\web\public\blocked-overlays"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src = Join-Path '%ROOT%' 'assets\blocked-overlays'; " ^
  "$dst = Join-Path '%ROOT%' 'frontend\web\public\blocked-overlays'; " ^
  "if (Test-Path $src) { Get-ChildItem -Path $src -File -ErrorAction SilentlyContinue | Where-Object { @('.png','.jpg','.jpeg','.webp','.gif') -contains $_.Extension.ToLowerInvariant() } | ForEach-Object { Copy-Item $_.FullName -Destination (Join-Path $dst $_.Name) -Force } }" >nul 2>&1

REM Find available web port
set "WEB_PORT="
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = 4000; while ($true) { $listener = $null; try { $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port); $listener.Start(); $listener.Stop(); Write-Output $port; break } catch { if ($listener) { try { $listener.Stop() } catch {} }; $port++ } }"') do set "WEB_PORT=%%P"
if not defined WEB_PORT set "WEB_PORT=4000"
if not "%WEB_PORT%"=="4000" echo Port 4000 is busy — using port %WEB_PORT%.

REM Launch API + Web (hidden shells)
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','Set-Location -LiteralPath ''%ROOT%''; npm run dev:api'"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ^
  "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','Set-Location -LiteralPath ''%ROOT%''; $env:PORT=''%WEB_PORT%''; npm run dev:web'"

REM Launch overlay if available
set "HAS_OVERLAY=0"
set "OVERLAY_EXE="
if exist "%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\win-x64\publish\SlayTheList.OverlayAgent.exe" (
  set "OVERLAY_EXE=%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\win-x64\publish\SlayTheList.OverlayAgent.exe"
) else if exist "%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\SlayTheList.OverlayAgent.exe" (
  set "OVERLAY_EXE=%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\SlayTheList.OverlayAgent.exe"
) else if exist "%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Debug\net8.0-windows\SlayTheList.OverlayAgent.exe" (
  set "OVERLAY_EXE=%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Debug\net8.0-windows\SlayTheList.OverlayAgent.exe"
)

if defined OVERLAY_EXE (
  start "" "%OVERLAY_EXE%"
  set "HAS_OVERLAY=1"
)

REM Launch startup status GUI
set "GUI_OVERLAY_FLAG="
if "%HAS_OVERLAY%"=="1" set "GUI_OVERLAY_FLAG=-HasOverlay"
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\startup-status.ps1" -WebPort %WEB_PORT% -ApiPort 8788 %GUI_OVERLAY_FLAG%

REM Open browser after a short delay (ping works in hidden consoles, timeout does not)
ping 127.0.0.1 -n 4 >nul
start "" "http://localhost:%WEB_PORT%"
exit /b 0

REM -- Desktop mode ----------------------------------------------------------
:desktop
call :preflight
if errorlevel 1 exit /b 1

REM Auto-stop any previous instance
call :kill_previous

echo Starting desktop mode...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location -LiteralPath '%ROOT%'; npm run desktop:dev"
echo Desktop app is launching — the window will appear when ready.
exit /b 0
