' serve.vbs -- start serve.bat with no console window.
'
' The same wrapper ollama-serve.vbs and sync-repos.vbs use, and for the same
' reason: a scheduled task that executes a .bat directly flashes a cmd window
' at every start. SyncRepos is the one thing on this machine that still does
' that; this is not going to be the second.
'
' wscript exits as soon as the .bat is spawned, so the task will read Ready
' rather than Running. That is expected -- the loop in the .bat is what keeps
' the server alive.

Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run """" & here & "serve.bat""", 0, False
