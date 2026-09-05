@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-FM-SaveLens-24.ps1"
if errorlevel 1 pause
