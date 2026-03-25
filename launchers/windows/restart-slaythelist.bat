@echo off
setlocal

set "ROOT=%~dp0..\..\"
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
cd /d "%ROOT%"

echo Restarting SlayTheList...
echo.

call "%ROOT%launchers\windows\stop-slaythelist.bat"
timeout /t 1 >nul

if not exist "%ROOT%node_modules" (
  echo Dependencies not found. Run "npm install" first.
  exit /b 1
)

echo Rebuilding Node workspaces...
call npm run build
if errorlevel 1 (
  echo.
  echo Node build failed. Startup cancelled.
  exit /b 1
)

set "DOTNET_EXE="
if exist "C:\Program Files\dotnet\dotnet.exe" (
  set "DOTNET_EXE=C:\Program Files\dotnet\dotnet.exe"
) else (
  where dotnet >nul 2>&1
  if not errorlevel 1 set "DOTNET_EXE=dotnet"
)

if defined DOTNET_EXE (
  echo Rebuilding overlay agent...
  call "%DOTNET_EXE%" build "desktop\overlay-agent\SlayTheList.OverlayAgent.sln" -c Release
  if errorlevel 1 (
    echo.
    echo Overlay build failed. Startup cancelled.
    exit /b 1
  )
) else (
  echo dotnet not found. Skipping overlay rebuild.
)

echo Starting services...
call "%ROOT%launchers\windows\start-slaythelist.bat" --no-pause
if errorlevel 1 (
  echo.
  echo Startup failed.
  exit /b 1
)

echo.
echo Restart complete.
exit /b 0
