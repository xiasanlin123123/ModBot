"""公网 / 局域网发布用的启动脚本（生产级 WSGI 服务器 waitress）。

本地自己用 `python app.py` 就够了；要让别人也能访问，用这个：

    python serve_public.py              # 默认监听 0.0.0.0:8000
    set PORT=8080 && python serve_public.py

为什么不用 `python app.py` 对外开：
  · Flask 自带服务器是开发用的，并发一多人就卡，还会在控制台警告
  · 它的调试模式带交互式调试器，暴露到公网等于把服务器交给别人

安全说明：本服务**不保存任何 API Key**。每位访客在自己浏览器里填自己的 Key，
请求时随请求体带上来，后端只做协议转换和转发。
"""

import os
import sys

try:
    from waitress import serve
except ImportError:
    print("缺少依赖 waitress，请先执行：")
    print("    pip install -r requirements.txt")
    sys.exit(1)

from app import app

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
THREADS = int(os.environ.get("THREADS", "16"))

if __name__ == "__main__":
    print("=" * 58)
    print("  AI 聊天助手 —— 对外发布模式（waitress）")
    print(f"  监听: http://{HOST}:{PORT}")
    print("  服务器不保存任何 API Key，每位访客用自己的 Key")
    print("  停止服务：按 Ctrl+C")
    print("=" * 58)
    sys.stdout.flush()      # 输出被重定向到文件时不会被缓冲住看不见
    serve(app, host=HOST, port=PORT, threads=THREADS)
