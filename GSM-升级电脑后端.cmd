@echo off
echo The legacy one-shot backend updater is retired.
echo No deployment or data changes will be made by this entry.
echo Use the existing GSM desktop shortcut to start the application.
echo Current local backend service status:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\home-backend\service.ps1" -Action Status -Root "%~dp0home-backend"
exit /b %errorlevel%
