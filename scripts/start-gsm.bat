@echo off
chcp 65001 >nul
title GitHub Stars Manager (GSM)
cd /d "%~dp0\.."
node scripts\launch.mjs
pause
