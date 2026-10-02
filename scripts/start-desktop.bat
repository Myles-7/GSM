@echo off
chcp 65001 >nul
title GitHub Stars Manager (桌面版)
cd /d "%~dp0\.."
node scripts\launch-desktop.mjs
if errorlevel 1 pause
