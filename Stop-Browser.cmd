@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-FMScout.ps1" -Stop
if errorlevel 1 pause
