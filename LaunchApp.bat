@echo off
:: R/StudioGPT Launcher
:: Runs the app directly from source - always latest version

cd /d "%~dp0"

:: Clear Electron cache to ensure fresh load
if exist "%APPDATA%\r-studiogpt\Cache" (
    rmdir /s /q "%APPDATA%\r-studiogpt\Cache" 2>nul
)
if exist "%APPDATA%\r-studiogpt\GPUCache" (
    rmdir /s /q "%APPDATA%\r-studiogpt\GPUCache" 2>nul
)

:: Start the app
start "" cmd /c "npm start"
