@echo off
:: R/StudioGPT Launcher - Immediately delegates to VBS for hidden launch
start "" /B wscript.exe //nologo "%~dp0LaunchApp.vbs"
exit
