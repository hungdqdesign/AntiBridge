@echo off
title AntiBridge v1.2.0 - Server
color 0B

echo.
echo  ╔════════════════════════════════════════════════════════════╗
echo  ║              AntiBridge v1.2.0 - Starting...               ║
echo  ╚════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0backend"

:: Check if node_modules exists
if not exist "node_modules" (
    echo  [!] Dependencies not installed. Running npm install...
    echo.
    npm install
    echo.
)

echo  [*] Starting server...
echo.
npm start

pause
