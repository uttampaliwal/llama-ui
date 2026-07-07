@echo off
title Llama.cpp Web UI
echo.
echo ===================================
echo    Llama.cpp Web UI Launcher
echo ===================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    npm install
    echo.
)

echo [INFO] Starting Llama.cpp Web UI...
echo [INFO] Open http://localhost:3000 in your browser
echo.
node server.js
