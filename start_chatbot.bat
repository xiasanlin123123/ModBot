@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo AI 聊天助手启动中...（仅本机可访问）
echo 访问地址: http://127.0.0.1:5000
echo 关闭此窗口将停止服务
echo.
python app.py
pause
