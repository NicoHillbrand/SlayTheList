@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0..\..\"
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "NO_PAUSE=%~1"
cd /d "%ROOT%"

echo Starting SlayTheList...
echo.

REM Clean up stale named shells from previous runs.
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList API*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList Web*" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [Regex]::Escape((Resolve-Path '%ROOT%').Path); " ^
  "$rx = '(dev:api|@slaythelist/api run dev|tsx watch src/server.ts|dev:web|@slaythelist/web run dev|next dev)'; " ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; " ^
  "foreach ($p in $procs) { " ^
  "  $cmd = $p.CommandLine; " ^
  "  if ($cmd -and ($cmd -match $root) -and ($cmd -match $rx)) { cmd /c taskkill /PID $($p.ProcessId) /T /F >$null 2>&1 } " ^
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

netstat -ano | findstr /R /C:":8788 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port 8788 is already in use. Close the existing API process first.
  echo.
  echo Startup cancelled to avoid conflicting with another API instance.
  if /I not "%NO_PAUSE%"=="--no-pause" pause
  exit /b 1
)

set "WEB_PORT="
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = 4000; while ($true) { $listener = $null; try { $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port); $listener.Start(); $listener.Stop(); Write-Output $port; break } catch { if ($listener) { try { $listener.Stop() } catch {} }; $port++ } }"') do set "WEB_PORT=%%P"
if not defined WEB_PORT set "WEB_PORT=4000"
if not "%WEB_PORT%"=="4000" echo Port 4000 is busy. Using web port %WEB_PORT% instead.

start "SlayTheList API" cmd /c "cd /d ""%ROOT%"" && npm run dev:api"
start "SlayTheList Web" cmd /c "cd /d ""%ROOT%"" && set ""PORT=%WEB_PORT%"" && npm run dev:web"

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
start "" "http://localhost:%WEB_PORT%"

echo.
echo SlayTheList started.
echo - API terminal: SlayTheList API
echo - Web terminal: SlayTheList Web
if defined OVERLAY_EXE echo - Overlay app: SlayTheList Overlay
echo - Browser: http://localhost:%WEB_PORT%
echo.
echo Tip: You can control SlayTheList with Claude Code using MCP (todos, habits,
echo predictions, reflections). See docs\claude-todo-api-skill.md for setup.
echo.
echo To stop everything at once, run: launch-slaythelist.bat and choose Stop
exit /b 0
