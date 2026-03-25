Option Explicit

Dim shell, fso, root, prompt, choice
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
prompt = "Choose mode:" & vbCrLf & vbCrLf & _
  "B = Browser mode" & vbCrLf & _
  "H = Browser mode (hidden shells)" & vbCrLf & _
  "D = Desktop mode" & vbCrLf & _
  "S = Stop running SlayTheList" & vbCrLf & _
  "Q = Quit"

choice = InputBox(prompt, "SlayTheList launcher", "H")
choice = UCase(Trim(choice))

If choice = "" Or choice = "Q" Then
  WScript.Quit 0
End If

If choice = "B" Then
  shell.Run """" & root & "\launchers\windows\start-slaythelist.bat""", 0, False
  WScript.Quit 0
End If

If choice = "H" Then
  shell.Run """" & root & "\launchers\windows\start-slaythelist-hidden.bat""", 0, False
  WScript.Quit 0
End If

If choice = "D" Then
  shell.Run """" & root & "\launch-slaythelist.bat"" D", 0, False
  WScript.Quit 0
End If

If choice = "S" Then
  shell.Run """" & root & "\launchers\windows\stop-slaythelist.bat""", 0, False
  WScript.Quit 0
End If

MsgBox "Enter B, H, D, S, or Q.", vbExclamation, "SlayTheList launcher"
