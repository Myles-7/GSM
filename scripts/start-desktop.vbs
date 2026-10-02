Option Explicit

Dim shell, files, root, logDir, logPath, nodePath, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

logDir = files.BuildPath(root, "logs")
If Not files.FolderExists(logDir) Then files.CreateFolder(logDir)
logPath = files.BuildPath(logDir, "desktop-" & files.GetTempName & ".log")

nodePath = "node"
If WScript.Arguments.Count > 0 Then nodePath = WScript.Arguments(0)

' The hidden console captures failures without leaving a terminal on the desktop.
command = Quote(shell.ExpandEnvironmentStrings("%ComSpec%")) & " /d /s /c " & _
    Quote(Quote(nodePath) & " " & Quote(files.BuildPath(root, "scripts\launch-desktop.mjs")) & _
    " > " & Quote(logPath) & " 2>&1")

On Error Resume Next
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    MsgBox "Unable to start GitHub Stars Manager." & vbCrLf & Err.Description, _
        vbOKOnly + vbExclamation, "GitHub Stars Manager"
    WScript.Quit 1
End If
On Error GoTo 0

If exitCode <> 0 Then
    MsgBox "GitHub Stars Manager could not start or exited unexpectedly." & vbCrLf & _
        "Details: " & logPath, vbOKOnly + vbExclamation, "GitHub Stars Manager"
End If
WScript.Quit exitCode

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
