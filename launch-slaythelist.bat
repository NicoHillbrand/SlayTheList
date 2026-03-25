@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "MODE=%~1"

if /I "%MODE%"=="B" goto browser
if /I "%MODE%"=="H" goto browser_hidden
if /I "%MODE%"=="D" goto desktop
if /I "%MODE%"=="S" goto stop
if /I "%MODE%"=="Q" exit /b 0

echo SlayTheList launcher
echo.
echo   [B] Browser mode
echo   [H] Browser mode (hidden shells)
echo   [D] Desktop mode
echo   [S] Stop running SlayTheList processes
echo   [Q] Quit
echo.

choice /C BHDSQ /N /M "Choose mode: "
set "CHOICE=%ERRORLEVEL%"

if "%CHOICE%"=="5" exit /b 0
if "%CHOICE%"=="4" goto stop
if "%CHOICE%"=="3" goto desktop
if "%CHOICE%"=="2" goto browser_hidden
if "%CHOICE%"=="1" goto browser

exit /b 0

:browser
call "%ROOT%launchers\windows\start-slaythelist.bat"
exit /b %ERRORLEVEL%

:browser_hidden
call "%ROOT%launchers\windows\start-slaythelist-hidden.bat"
exit /b %ERRORLEVEL%

:desktop
if not exist "%ROOT%node_modules" (
  echo.
  echo Dependencies not found. Run "npm install" first.
  pause
  exit /b 1
)

echo.
echo Starting desktop mode...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Location -LiteralPath '%ROOT%'; npm run desktop:dev"
exit /b 0

:stop
call "%ROOT%launchers\windows\stop-slaythelist.bat"
exit /b %ERRORLEVEL%
