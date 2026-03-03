' R/StudioGPT Silent Launcher
' Double-click this file to launch the app without any console window
' Shows an instant splash screen while Electron loads

Option Explicit

Dim WshShell, fso, scriptPath
Dim cacheFolder, gpuCacheFolder

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the script's directory
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)

' Show HTA splash screen IMMEDIATELY (fastest native option)
WshShell.Run "mshta.exe """ & scriptPath & "\splash-native.hta""", 1, False

' Clear Electron cache folders silently in background
On Error Resume Next
cacheFolder = WshShell.ExpandEnvironmentStrings("%APPDATA%") & "\r-studiogpt\Cache"
gpuCacheFolder = WshShell.ExpandEnvironmentStrings("%APPDATA%") & "\r-studiogpt\GPUCache"

If fso.FolderExists(cacheFolder) Then
    fso.DeleteFolder cacheFolder, True
End If
If fso.FolderExists(gpuCacheFolder) Then
    fso.DeleteFolder gpuCacheFolder, True
End If
On Error GoTo 0

' Launch Electron app with hidden console (0 = hidden, False = don't wait)
' Electron will close the HTA splash when ready
WshShell.Run """" & scriptPath & "\node_modules\.bin\electron.cmd"" . --close-splash", 0, False

Set WshShell = Nothing
Set fso = Nothing
