@echo off
setlocal ENABLEDELAYEDEXPANSION

REM ============================================================================
REM   SlayTheList - Updater (run this every time you want to play / test)
REM
REM   First-time users: run install.bat (console) or install-wizard.bat (GUI)
REM   ONCE first. After that, just double-click update.bat each session.
REM
REM   This is a thin launcher: it opens the GUI wizard (scripts\setup-wizard.ps1)
REM   which checks for updates, applies only what changed, and launches the app.
REM   All status, progress, and errors are shown in that window.
REM ============================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

REM Strip the trailing backslash: passing "...\path\" makes the closing \" an
REM escaped quote, which mangles the -Root argument (same fix as launcher.vbs).
set "ROOTNB=%ROOT:~0,-1%"

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%scripts\setup-wizard.ps1" -Mode Update -Root "%ROOTNB%"
exit /b 0
