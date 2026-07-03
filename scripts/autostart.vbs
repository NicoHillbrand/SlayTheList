' SlayTheList — Silent auto-start launcher
' Invoked by the Startup-folder shortcut at login. Runs start.bat <mode>
' with no visible console window. Defaults to browser mode.

Dim fso, mode, rootDir, batPath, q
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count > 0 Then
  mode = WScript.Arguments(0)
Else
  mode = "browser"
End If

' Root is the parent of the scripts\ folder that holds this script.
rootDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
batPath = rootDir & "\start.bat"

q = Chr(34)
' Window style 0 = hidden. start.bat cd's to its own dir, so cwd is irrelevant.
CreateObject("Wscript.Shell").Run q & batPath & q & " " & mode, 0, False
