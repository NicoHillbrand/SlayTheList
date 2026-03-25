@echo off
setlocal

echo Stopping SlayTheList...

REM First close dedicated API/Web console windows by title (kills process tree).
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList API*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq SlayTheList Web*" >nul 2>&1

REM Kill API/Web dev processes by regex signature (covers surviving shells/tabs).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$rx = '(dev:api|@slaythelist/api run dev|tsx watch src/server.ts|dev:web|@slaythelist/web run dev|next dev)'; " ^
  "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; " ^
  "foreach ($p in $procs) { " ^
  "  $cmd = $p.CommandLine; " ^
  "  if ($cmd -and ($cmd -match $rx)) { cmd /c taskkill /PID $($p.ProcessId) /T /F >$null 2>&1 } " ^
  "}" >nul 2>&1

REM Fallback: kill listeners on API/web ports and stop overlay process
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$titles = @('SlayTheList API*', 'SlayTheList Web*'); " ^
  "foreach ($title in $titles) { " ^
  "  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like $title } | Stop-Process -Force -ErrorAction SilentlyContinue " ^
  "}; " ^
  "$ports = @(8788,3000); " ^
  "foreach ($port in $ports) { " ^
  "  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "  foreach ($owner in $owners) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue } " ^
  "}; " ^
  "Get-Process -Name 'SlayTheList.OverlayAgent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1

ping 127.0.0.1 -n 2 >nul

echo Done.
echo If any process remains, close it manually from Task Manager.
exit /b 0
