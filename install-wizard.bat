@echo off
setlocal ENABLEDELAYEDEXPANSION

REM ============================================================================
REM   SlayTheList - First-time Setup (GUI)
REM
REM   A friendly wizard version of install.bat. Run this ONCE on a new machine.
REM   It checks/installs Node + .NET, installs dependencies, builds shared types,
REM   creates the config file, and builds the overlay agent - all in a window.
REM
REM   Prefer a console install instead? Run install.bat.
REM   After setup, use update.bat each session to update + launch.
REM ============================================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

REM Strip the trailing backslash: passing "...\path\" makes the closing \" an
REM escaped quote, which mangles the -Root argument (same fix as launcher.vbs).
set "ROOTNB=%ROOT:~0,-1%"

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%app\scripts\setup-wizard.ps1" -Mode Install -Root "%ROOTNB%\app"
exit /b 0
