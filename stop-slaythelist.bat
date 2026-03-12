@echo off
setlocal

echo Stopping SlayTheList...

REM Stop API and Web terminals (and their process trees)
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList API*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList Web*" >nul 2>&1

REM Stop overlay GUI if running
taskkill /F /IM "SlayTheList.OverlayAgent.exe" >nul 2>&1

echo Done.
echo If any process remains, close it manually from Task Manager.
exit /b 0
