' SlayTheList — Silent GUI launcher
' Launches the PowerShell WPF launcher without any visible console window.

Dim rootDir
If WScript.Arguments.Count > 0 Then
  rootDir = WScript.Arguments(0)
Else
  rootDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\.."
End If

' Remove trailing backslash to avoid quote-escaping issues in shell commands
If Right(rootDir, 1) = "\" Then rootDir = Left(rootDir, Len(rootDir) - 1)

Dim psScript
psScript = rootDir & "\scripts\launcher.ps1"

Dim cmd
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """ -Root """ & rootDir & """"

CreateObject("Wscript.Shell").Run cmd, 0, False
