@echo off
title AntiBridge - Auto Inject Script
color 0B

echo.
echo  ╔════════════════════════════════════════════════════════════╗
echo  ║         AntiBridge - Inject Chat Bridge Script             ║
echo  ╚════════════════════════════════════════════════════════════╝
echo.

echo  [*] This script injects the chat_bridge_ws.js into Antigravity
echo  [*] Make sure Antigravity is running with CDP (port 9000)
echo.

:: Read the script content
set SCRIPT_PATH=%~dp0chat_bridge_ws.js

if not exist "%SCRIPT_PATH%" (
    echo  [!] ERROR: chat_bridge_ws.js not found!
    pause
    exit /b 1
)

echo  [*] Script found: %SCRIPT_PATH%
echo  [*] Open Antigravity DevTools (F12) and paste the script content
echo  [*] Or the server will auto-inject when connected
echo.

pause
