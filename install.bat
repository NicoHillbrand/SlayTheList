@echo off
setlocal

REM ============================================================================
REM   SlayTheList - First-time Setup
REM
REM   Opens the GUI setup wizard (app\scripts\setup-wizard.ps1): checks/installs
REM   Node + .NET, installs dependencies, builds shared types, creates the
REM   config file, and builds the overlay agent - all in a window.
REM
REM   Run this ONCE on a new machine. After that, use update.bat each session
REM   to update + launch, or start.bat to launch without updating.
REM ============================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

REM Strip the trailing backslash: passing "...\path\" makes the closing \" an
REM escaped quote, which mangles the -Root argument (same fix as launcher.vbs).
set "ROOTNB=%ROOT:~0,-1%"

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%app\scripts\setup-wizard.ps1" -Mode Install -Root "%ROOTNB%\app"
exit /b 0
