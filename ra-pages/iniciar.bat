@echo off
title Sonora - servidor local
cd /d "%~dp0"
echo Iniciando o Sonora...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
