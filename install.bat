@echo off
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ============================================
echo   SlayTheList — Windows Installer
echo ============================================
echo.

REM ── 1. Node.js ────────────────────────────────────────────────────────────
set "NODE_OK=0"
where node >nul 2>&1
if not errorlevel 1 (
  for /f %%V in ('node -e "process.stdout.write(String(process.versions.node.split(\".\")[0]))"') do (
    if %%V GEQ 20 (
      echo [OK] Node.js found: v%%V
      set "NODE_OK=1"
    ) else (
      echo [!!] Node.js v%%V found but v20+ is required.
    )
  )
)
if "!NODE_OK!"=="0" (
  echo.
  echo Node.js 20+ is required. Attempting install via winget...
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo Automatic install failed. Please install Node.js 20+ manually:
    echo   https://nodejs.org
    echo.
    pause
    exit /b 1
  )
  echo.
  echo [OK] Node.js installed. You may need to restart this terminal for
  echo      the PATH to update, then re-run install.bat.
  echo.
  REM Refresh PATH for this session
  for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
  for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
)

REM ── 2. .NET SDK (for overlay agent) ───────────────────────────────────────
set "DOTNET_OK=0"
where dotnet >nul 2>&1
if not errorlevel 1 (
  for /f "tokens=1 delims=." %%V in ('dotnet --version 2^>nul') do (
    if %%V GEQ 8 (
      echo [OK] .NET SDK found: v%%V
      set "DOTNET_OK=1"
    )
  )
)
if "!DOTNET_OK!"=="0" (
  echo.
  echo .NET 8 SDK is required for the overlay agent. Attempting install via winget...
  winget install Microsoft.DotNet.SDK.8 --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo Automatic install failed. Please install .NET 8 SDK manually:
    echo   https://dotnet.microsoft.com/download/dotnet/8.0
    echo.
    echo The overlay agent won't build without it, but the web app will still work.
  ) else (
    echo [OK] .NET 8 SDK installed.
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"
  )
)

REM ── 3. npm install ────────────────────────────────────────────────────────
echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo [!!] npm install failed. Check the output above.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.

REM ── 4. Build shared contracts ─────────────────────────────────────────────
echo.
echo Building shared contracts...
call npm run build:contracts
if errorlevel 1 (
  echo.
  echo [!!] Contract build failed. Check the output above.
  pause
  exit /b 1
)
echo [OK] Contracts built.

REM ── 5. .env file ──────────────────────────────────────────────────────────
if not exist "backend\api\.env" (
  if exist "backend\api\.env.example" (
    copy "backend\api\.env.example" "backend\api\.env" >nul
    echo [OK] Created backend\api\.env from .env.example
  ) else (
    echo [--] No .env.example found — you may need to create backend\api\.env manually.
  )
) else (
  echo [OK] backend\api\.env already exists.
)

REM ── 6. Build overlay agent ────────────────────────────────────────────────
where dotnet >nul 2>&1
if not errorlevel 1 (
  if exist "desktop\overlay-agent\SlayTheList.OverlayAgent.sln" (
    echo.
    echo Building overlay agent...
    dotnet publish "desktop\overlay-agent\SlayTheList.OverlayAgent" -c Release
    if errorlevel 1 (
      echo [!!] Overlay build failed — the web app will still work without it.
    ) else (
      echo [OK] Overlay agent built.
    )
  )
) else (
  echo [--] .NET not available — skipping overlay agent build.
)

echo.
echo ============================================
echo   Installation complete!
echo   Run start.bat to launch SlayTheList.
echo ============================================
echo.
pause
exit /b 0
