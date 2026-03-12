@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
set "NO_PAUSE=%~1"
cd /d "%ROOT%"

echo Starting SlayTheList...
echo.

REM Clean up stale named shells from previous runs.
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList API*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList Web*" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$rx = '(dev:api|@slaythelist/api run dev|tsx watch src/server.ts|dev:web|@slaythelist/web run dev|next dev)'; " ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; " ^
  "foreach ($p in $procs) { " ^
  "  $cmd = $p.CommandLine; " ^
  "  if ($cmd -and ($cmd -match $rx)) { cmd /c taskkill /PID $($p.ProcessId) /T /F >$null 2>&1 } " ^
  "}" >nul 2>&1

if not exist "%ROOT%node_modules" (
  echo Dependencies not found. Run "npm install" first.
  if /I not "%NO_PAUSE%"=="--no-pause" pause
  exit /b 1
)

if not exist "%ROOT%frontend\web\public\blocked-overlays" mkdir "%ROOT%frontend\web\public\blocked-overlays"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src = Join-Path '%ROOT%' 'assets\blocked-overlays'; " ^
  "$dst = Join-Path '%ROOT%' 'frontend\web\public\blocked-overlays'; " ^
  "if (Test-Path $src) { Get-ChildItem -Path $src -File -ErrorAction SilentlyContinue | Where-Object { @('.png','.jpg','.jpeg','.webp','.gif') -contains $_.Extension.ToLowerInvariant() } | ForEach-Object { Copy-Item $_.FullName -Destination (Join-Path $dst $_.Name) -Force } }" >nul 2>&1

set "PORT_BUSY="
for %%P in (8788 3000) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul
  if not errorlevel 1 (
    echo Port %%P is already in use. Close existing instance first.
    set "PORT_BUSY=1"
  )
)

if defined PORT_BUSY (
  echo.
  echo Startup cancelled to avoid duplicate running versions.
  if /I not "%NO_PAUSE%"=="--no-pause" pause
  exit /b 1
)

start "SlayTheList API" cmd /c "cd /d ""%ROOT%"" && npm run dev:api"
start "SlayTheList Web" cmd /c "cd /d ""%ROOT%"" && npm run dev:web"

set "OVERLAY_EXE="
if exist "%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\SlayTheList.OverlayAgent.exe" (
  set "OVERLAY_EXE=%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\SlayTheList.OverlayAgent.exe"
) else if exist "%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Debug\net8.0-windows\SlayTheList.OverlayAgent.exe" (
  set "OVERLAY_EXE=%ROOT%desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Debug\net8.0-windows\SlayTheList.OverlayAgent.exe"
)

if defined OVERLAY_EXE (
  start "SlayTheList Overlay" "%OVERLAY_EXE%"
) else (
  echo Overlay executable not found. Build it once with:
  echo dotnet build "desktop/overlay-agent/SlayTheList.OverlayAgent.sln" -c Release
)

timeout /t 2 >nul
start "" "http://localhost:3000"

echo.
echo SlayTheList started.
echo - API terminal: SlayTheList API
echo - Web terminal: SlayTheList Web
if defined OVERLAY_EXE echo - Overlay app: SlayTheList Overlay
echo - Browser: http://localhost:3000
echo.
echo To stop everything at once, run: stop-slaythelist.bat
exit /b 0
