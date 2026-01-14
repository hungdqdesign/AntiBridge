@echo off
title AntiBridge - Setup
color 0B

echo.
echo  ╔════════════════════════════════════════════════════════════╗
echo  ║              AntiBridge v1.2.0 - First Time Setup          ║
echo  ╚════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0backend"

echo  [*] Installing dependencies...
echo.
npm install

echo.
echo  ╔════════════════════════════════════════════════════════════╗
echo  ║                    Setup Complete!                         ║
echo  ╠════════════════════════════════════════════════════════════╣
echo  ║  Next steps:                                               ║
echo  ║  1. Run OPEN_ANTIGRAVITY.vbs to start Antigravity          ║
echo  ║  2. Run START.bat to start the server                      ║
echo  ║  3. Open http://localhost:8000 in your browser             ║
echo  ╚════════════════════════════════════════════════════════════╝
echo.

pause
