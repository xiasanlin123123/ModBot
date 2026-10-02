' 豆包 AI 聊天机器人 - 静默启动脚本
' 开机后自动在后台运行，不会弹出命令行窗口

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' 工作目录
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' 日志文件
strLog = strPath & "\server_log.txt"

' 写入启动时间到日志
Set objLog = objFSO.OpenTextFile(strLog, 8, True)
objLog.WriteLine Now() & " - 启动聊天机器人..."
objLog.Close

' 后台运行 Python (隐藏窗口)
objShell.Run "cmd /c cd /d """ & strPath & """ && python app.py >> """ & strLog & """ 2>&1", 0, False

Set objShell = Nothing
Set objFSO = Nothing
