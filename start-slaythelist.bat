@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Starting SlayTheList...
echo.

if not exist "%ROOT%node_modules" (
  echo Dependencies not found. Run "npm install" first.
  pause
  exit /b 1
)

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
  pause
  exit /b 1
)

start "SlayTheList API" cmd /k "cd /d ""%ROOT%"" && npm run dev:api"
start "SlayTheList Web" cmd /k "cd /d ""%ROOT%"" && npm run dev:web"

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
