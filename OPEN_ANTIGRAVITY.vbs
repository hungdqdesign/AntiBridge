' AntiBridge - Open Antigravity with CDP
' This script opens Antigravity IDE with remote debugging enabled
' Required for AntiBridge to communicate with Antigravity

Set WshShell = CreateObject("WScript.Shell")

' Path to Antigravity - update this if your installation is different
Dim antigravityPath
antigravityPath = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\antigravity\Antigravity.exe"

' Check if Antigravity exists
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(antigravityPath) Then
    MsgBox "Antigravity not found at:" & vbCrLf & antigravityPath & vbCrLf & vbCrLf & "Please update the path in this script.", vbExclamation, "AntiBridge"
    WScript.Quit
End If

' Launch Antigravity with CDP enabled on port 9000
Dim command
command = """" & antigravityPath & """ --remote-debugging-port=9000"

WshShell.Run command, 1, False

' Show notification
MsgBox "Antigravity is starting with CDP enabled on port 9000." & vbCrLf & vbCrLf & "Now run START.bat to start the server.", vbInformation, "AntiBridge"
