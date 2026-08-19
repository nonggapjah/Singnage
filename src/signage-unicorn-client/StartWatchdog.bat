@echo off
title Signage Unicorn Watchdog Launcher
echo Starting Watchdog in background...
powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0Watchdog.ps1"
