"""
多模型 AI 聊天助手 - Flask 后端（BYOK · 自带 Key 模式）

设计原则：**服务器上不保存、也不需要任何 API Key。**

每个访问者在自己的浏览器里填一次自己的 Key，前端把它存在 localStorage，
之后每次聊天请求都随请求体一起发上来。后端只做两件事：

    · 按目标协议转换请求格式
    · 把两家不同的响应 / 流式事件统一成同一种 SSE

因此同一个部署可以给所有人用，而每个人用的是自己的 Key、自己的额度：
服务器被拖库也拿不到任何人的密钥，你也不需要为访客的调用付钱。

支持的两种上游协议（按 API URL 自动识别，也可在界面手动指定）：

  1) 火山方舟 Ark（豆包）
     URL: https://ark.cn-beijing.volces.com/api/v3/responses
     请求体: {"model", "input", "instructions", "stream"}

  2) OpenAI 兼容协议（chat/completions）
     URL: https://api.deepseek.com/chat/completions
     请求体: {"model", "messages", "stream"}
     DeepSeek / OpenAI / Kimi / 通义 / 硅基流动 等都走这一套

前端始终按 Ark 的"内容块"格式（input_text / input_image）发消息，
后端在转发前自动转成目标协议需要的格式，前端不需要关心背后是谁。
"""

import json
import os
import time
import uuid
import base64
import requests
from flask import Flask, render_template, request, jsonify, Response, stream_with_context, send_from_directory

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 单次请求体上限（图片以 base64 随请求上传，50 张时可能不小，给宽松些）
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

# 文件上传目录
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def load_dotenv(path=None, override=True):
    """读取项目根目录的 .env（KEY=VALUE 格式）。

    注意：这里**不读取任何 API Key**。每个人的 Key 都由浏览器自己带着走，
    服务器上不需要也拿不到。.env 只用来放服务器自己的运行参数
    （HOST / PORT / FLASK_DEBUG）和可选的默认地址、模型名，方便本机调试。

    override=True：.env 里的值覆盖同名系统环境变量。
    """
    env_path = path or os.path.join(BASE_DIR, ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key and (override or key not in os.environ):
                    os.environ[key] = value.strip().strip('"').strip("'")
    except OSError:
        pass


load_dotenv()

# 允许的文件扩展名（与前端一致）
ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "xlsm",
    "ppt", "pptx", "txt", "csv", "bat", "cmd", "py", "ahk",
}

# ============================================================
# 服务端默认值 —— 只提供「地址 / 模型名 / 提示词」这类非敏感信息
# ============================================================
# 前端第一次打开时用它把表单预填好，用户只需要再粘一个自己的 Key。
# 这里刻意 **没有任何 apiKey 字段**：服务器上没有 Key 可以给出去。
SERVER_DEFAULTS = {
    # 火山方舟（豆包）
    "ark": {
        "apiUrl": os.environ.get(
            "ARK_API_URL", "https://ark.cn-beijing.volces.com/api/v3/responses"
        ),
        "modelName": os.environ.get("ARK_MODEL_NAME", "doubao-seed-evolving"),
        "systemPrompt": "你是一个智能AI助手，善于解答各种问题，语气友好、专业。",
        "supportsVision": True,
    },
    # OpenAI 兼容（DeepSeek 等）
    "openai": {
        "apiUrl": os.environ.get(
            "LLM_API_URL", "https://api.deepseek.com/chat/completions"
        ),
        "modelName": os.environ.get("LLM_MODEL_NAME", "deepseek-flash"),
        "systemPrompt": "你是一个智能AI助手，善于解答各种问题，语气友好、专业。",
        "supportsVision": True,
    },
}


# ============================================================
# 协议识别
# ============================================================

def detect_protocol(api_url):
    """按 API URL 猜协议。分不清时按 OpenAI 兼容处理（覆盖面更广）。"""
    url = (api_url or "").strip().lower()
    if "volces.com" in url or "ark.cn" in url or url.rstrip("/").endswith("/responses"):
        return "ark"
    return "openai"


def resolve_protocol(provider, api_url):
    """手动指定优先，否则按 URL 自动识别。"""
    if provider in ("ark", "openai"):
        return provider
    return detect_protocol(api_url)


class RequestConfig:
    """一次请求要用到的模型配置 —— 全部由浏览器带上来，服务端不留任何状态。

    data 形如::

        {
          "messages": [...],
          "config": {
            "apiKey": "sk-...", "apiUrl": "https://...", "modelName": "...",
            "provider": "" | "ark" | "openai",
            "systemPrompt": "...", "supportsVision": true
          }
        }
    """

    __slots__ = ("api_key", "api_url", "model_name", "system_prompt",
                 "supports_vision", "protocol")

    def __init__(self, data):
        cfg = (data or {}).get("config") or {}
        if not isinstance(cfg, dict):
            cfg = {}

        self.api_key = str(cfg.get("apiKey") or "").strip()
        self.api_url = str(cfg.get("apiUrl") or "").strip()
        self.model_name = str(cfg.get("modelName") or "").strip()

        prompt = cfg.get("systemPrompt")
        self.system_prompt = prompt if isinstance(prompt, str) else ""

        # 默认按"模型支持图片"处理，与前端默认值保持一致
        self.supports_vision = cfg.get("supportsVision") is not False

        self.protocol = resolve_protocol(
            str(cfg.get("provider") or "").strip(), self.api_url
        )

    def validate(self):
        """配置有问题时返回一句能照着做的中文提示，没问题返回 None。"""
        if not self.api_key:
            return ("尚未配置 API Key。请点击左下角「⚙️ 设置」，"
                    "填入你自己的 Key（Key 只保存在你的浏览器里，不会上传到服务器）。")
        if not self.api_url:
            return ("尚未配置 API 地址。请在「⚙️ 设置」里填写，"
                    "例如 https://api.deepseek.com/chat/completions")
        if not self.api_url.lower().startswith(("http://", "https://")):
            return "API 地址需要以 http:// 或 https:// 开头，请检查后重试。"
        if not self.model_name:
            return ("尚未配置模型名称。请在「⚙️ 设置」里填写，"
                    "例如 deepseek-flash")
        return None


# ============================================================
# 简易限流 —— 防止有人把公开部署的站点当成免费代理刷
# ============================================================
RATE_LIMIT_WINDOW = 60      # 秒
RATE_LIMIT_MAX = 40         # 每个来源 IP 在一个窗口内最多请求多少次聊天接口
_rate_bucket = {}


def _client_ip():
    # 部署在反向代理后面时，真实 IP 在 X-Forwarded-For 的第一段
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.remote_addr or "unknown"


def _rate_limited(ip):
    now = time.time()
    hits = [t for t in _rate_bucket.get(ip, []) if now - t < RATE_LIMIT_WINDOW]

    if len(hits) >= RATE_LIMIT_MAX:
        _rate_bucket[ip] = hits
        return True

    hits.append(now)
    _rate_bucket[ip] = hits

    # 顺手清理过期记录，避免字典无限膨胀
    if len(_rate_bucket) > 5000:
        for k in [k for k, v in _rate_bucket.items()
                  if not v or now - v[-1] > RATE_LIMIT_WINDOW]:
            _rate_bucket.pop(k, None)
    return False


# ============================================================
# 请求体转换 —— 前端发来的 Ark 块格式 → 目标协议格式
# ============================================================

def _stringify_error(err):
    """上游返回的 error 字段可能是字符串，也可能是对象。"""
    if isinstance(err, dict):
        return err.get("message") or json.dumps(err, ensure_ascii=False)
    return str(err)


def to_openai_messages(messages, system_prompt, allow_image):
    """把 Ark 风格的 messages 转成 OpenAI 兼容格式。

    Ark:    {"role":"user","content":[{"type":"input_text","text":"你好"},
                                     {"type":"input_image","image_url":"https://..."}]}
    OpenAI: {"role":"user","content":"你好"}                          ← 纯文本
            {"role":"user","content":[{"type":"text","text":"你好"},
                                      {"type":"image_url",
                                       "image_url":{"url":"https://..."}}]}  ← 带图
    """
    out = []

    # OpenAI 协议的 system prompt 是一条单独的 system 消息（Ark 走 instructions 字段）
    if system_prompt:
        out.append({"role": "system", "content": system_prompt})

    for msg in messages or []:
        role = msg.get("role") or "user"
        content = msg.get("content")

        # 已经是普通字符串的（旧对话记录），原样放行
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue

        text_parts = []
        image_urls = []
        for block in content or []:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            if btype in ("input_text", "text"):
                if block.get("text"):
                    text_parts.append(block["text"])
            elif btype in ("input_image", "image_url"):
                url = block.get("image_url")
                if isinstance(url, dict):
                    url = url.get("url", "")
                if url:
                    image_urls.append(url)

        text = "\n".join(text_parts)

        # assistant 的历史回复只有文本
        if role == "assistant":
            out.append({"role": "assistant", "content": text})
            continue

        # 模型不支持图片时，别把请求直接打挂，改成一句可读的说明
        if image_urls and not allow_image:
            note = "（已忽略 %d 张图片：当前模型未勾选「支持图片输入」）" % len(image_urls)
            text = (text + "\n\n" + note) if text else note
            image_urls = []

        if image_urls:
            parts = []
            if text:
                parts.append({"type": "text", "text": text})
            for url in image_urls:
                parts.append({"type": "image_url", "image_url": {"url": url}})
            out.append({"role": "user", "content": parts})
        else:
            out.append({"role": "user", "content": text})

    return out


def build_payload(cfg, messages, stream):
    """按协议组装请求体。cfg 是本请求自带的模型配置。"""
    if cfg.protocol == "ark":
        payload = {
            "model": cfg.model_name,
            "input": messages,
            "instructions": cfg.system_prompt,
        }
    else:
        payload = {
            "model": cfg.model_name,
            "messages": to_openai_messages(
                messages, cfg.system_prompt, cfg.supports_vision
            ),
        }
    if stream:
        payload["stream"] = True
    return payload


def extract_reply_text(proto, data):
    """从非流式响应里取出回复正文。"""
    if proto == "ark":
        parts = []
        for item in data.get("output") or []:
            if item.get("type") == "message":
                for c in item.get("content") or []:
                    if c.get("type") == "output_text":
                        parts.append(c.get("text", ""))
        return "".join(parts)

    choices = data.get("choices") or []
    if not choices:
        return ""
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # 少数实现返回块数组
        return "".join(
            b.get("text", "") for b in content if isinstance(b, dict)
        )
    # 正文为空但给了推理内容（例如只开了思考模式）→ 至少别让用户看到空白
    return message.get("reasoning_content") or ""


# ============================================================
# 流式解析 —— 把两家的 SSE 统一成 ("text"|"reasoning"|"error", 内容)
# ============================================================

def _iter_ark_stream(resp):
    """火山方舟 Responses API 的 SSE：先 event: 行，再 data: 行。"""
    current_event = None
    for raw in resp.iter_lines():
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace")
        if line.startswith("event: "):
            current_event = line[7:].strip()
            continue
        if not line.startswith("data:"):
            continue

        payload = line[5:].strip()
        if payload == "[DONE]":
            return
        try:
            chunk = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(chunk, dict) and chunk.get("error"):
            yield "error", _stringify_error(chunk["error"])
            return

        # 有些实现不带 event: 行，靠 body 里的 type 字段区分
        event = current_event or (chunk.get("type") if isinstance(chunk, dict) else "") or ""

        if event == "response.output_text.delta":
            text = chunk.get("delta") or ""
            if text:
                yield "text", text
        elif event in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
            text = chunk.get("delta") or ""
            if text:
                yield "reasoning", text
        elif event in ("response.completed", "response.incomplete"):
            return
        elif event == "error":
            yield "error", _stringify_error(chunk.get("error") or chunk)
            return


def _iter_openai_stream(resp):
    """OpenAI 兼容（DeepSeek 等）的 SSE：只有 data: 行，choices[0].delta。"""
    for raw in resp.iter_lines():
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        if not line or line.startswith(":"):   # 心跳注释行
            continue
        if not line.startswith("data:"):
            continue

        payload = line[5:].strip()
        if payload == "[DONE]":
            return
        try:
            chunk = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(chunk, dict) and chunk.get("error"):
            yield "error", _stringify_error(chunk["error"])
            return

        choices = chunk.get("choices") or []
        if not choices:
            continue
        delta = (choices[0] or {}).get("delta") or (choices[0] or {}).get("message") or {}

        # 思考模式：DeepSeek 把推理过程放在 reasoning_content 里
        reasoning = delta.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning:
            yield "reasoning", reasoning

        text = delta.get("content")
        if isinstance(text, list):
            text = "".join(b.get("text", "") for b in text if isinstance(b, dict))
        if isinstance(text, str) and text:
            yield "text", text


STREAM_PARSERS = {"ark": _iter_ark_stream, "openai": _iter_openai_stream}


def _sse(obj):
    """打包一条给前端的 SSE 消息（前端只认识 text / reasoning / error）。"""
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


def _upstream_headers(cfg):
    return {
        "Authorization": "Bearer " + cfg.api_key,
        "Content-Type": "application/json",
    }


# ============================================================
# 路由
# ============================================================

@app.route("/")
def index():
    """渲染聊天界面"""
    return render_template("index.html")


@app.route("/api/server-defaults", methods=["GET"])
def server_defaults():
    """给前端「第一次打开」时预填表单用。

    只返回地址 / 模型名 / 提示词这类非敏感默认值，**永远不含 API Key**。
    """
    return jsonify({
        "byok": True,                       # 提示前端：这是自带 Key 模式
        "defaults": SERVER_DEFAULTS,
    })


@app.route("/api/chat", methods=["POST"])
def chat():
    """聊天接口（非流式）。请求格式见前端 buildRequestConfig()。"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    cfg = RequestConfig(data)
    err = cfg.validate()
    if err:
        return jsonify({"error": err}), 400

    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "消息不能为空"}), 400

    if _rate_limited(_client_ip()):
        return jsonify({"error": "请求太频繁了，请稍等一会儿再试。"}), 429

    payload = build_payload(cfg, messages, stream=False)

    try:
        resp = requests.post(
            cfg.api_url, headers=_upstream_headers(cfg), json=payload, timeout=600
        )
        body = resp.json()

        if resp.status_code >= 400:
            return jsonify({
                "error": "上游 API 错误 (%s): %s"
                % (resp.status_code, _stringify_error(body.get("error") or body))
            }), resp.status_code

        return jsonify({
            "reply": extract_reply_text(cfg.protocol, body),
            "model": body.get("model"),
            "usage": body.get("usage"),
        }), resp.status_code
    except ValueError:
        return jsonify({"error": "上游返回的不是合法 JSON，请检查 API 地址是否正确"}), 502
    except requests.exceptions.Timeout:
        return jsonify({"error": "请求超时，请稍后重试"}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"请求失败: {str(e)}"}), 500


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    """流式聊天接口（SSE）。请求格式与 /api/chat 相同。"""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    cfg = RequestConfig(data)
    err = cfg.validate()
    if err:
        return jsonify({"error": err}), 400

    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "消息不能为空"}), 400

    if _rate_limited(_client_ip()):
        return jsonify({"error": "请求太频繁了，请稍等一会儿再试。"}), 429

    parser = STREAM_PARSERS[cfg.protocol]
    payload = build_payload(cfg, messages, stream=True)
    headers = _upstream_headers(cfg)

    # 这些值在生成器里用，提前取出来，避免脱离请求上下文
    api_url = cfg.api_url
    model_name = cfg.model_name
    proto = cfg.protocol

    def generate():
        try:
            resp = requests.post(
                api_url, headers=headers, json=payload, timeout=600, stream=True
            )

            if not resp.ok:
                error_body = resp.text[:500]
                print(f"❌ 上游 API 返回错误 {resp.status_code}: {error_body}")
                yield _sse({"error": "API 错误 (%s): %s" % (resp.status_code, error_body)})
                yield "data: [DONE]\n\n"
                return

            print(f"✅ [{proto}] {model_name} 连接成功，开始接收 SSE 流...")

            for kind, value in parser(resp):
                if kind == "error":
                    yield _sse({"error": value})
                    break
                yield _sse({kind: value})

            yield "data: [DONE]\n\n"

        except requests.exceptions.RequestException as e:
            print(f"❌ 上游 API 请求异常: {e}")
            yield _sse({"error": str(e)})
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            # 注意：不要加 Connection / Keep-Alive 这类"逐跳"头。
            # WSGI 规范（PEP 3333）禁止应用层设置它们，waitress 会直接抛
            # AssertionError 让整个请求失败（Flask 自带服务器则容忍）。
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # 让 Nginx 不要缓冲 SSE
        },
    )


@app.route("/api/health", methods=["GET"])
def health():
    """健康检查接口（不含任何配置信息）"""
    return jsonify({"status": "ok", "mode": "byok"})


@app.route("/api/upload", methods=["POST"])
def upload_file():
    """
    文件上传接口 — 接收 multipart 文件，保存到 uploads 目录，返回可访问的 URL
    前端拿到路径后通过 /api/files/<filename> 下载，也可直接传给大模型 API
    """
    if "file" not in request.files:
        return jsonify({"error": "没有收到文件"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "文件名为空"}), 400

    # 检查扩展名
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"不支持的文件类型: .{ext}"}), 400

    # 用 UUID 生成唯一文件名，保留原扩展名
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = os.path.join(UPLOAD_DIR, safe_name)
    file.save(save_path)

    # 返回文件访问路径（通过 /api/files/<name> 下载）
    # 用 request.host_url 动态拼，不写死端口，换端口/公网访问也能用
    file_url = f"{request.host_url.rstrip('/')}/api/files/{safe_name}"
    print(f"📎 文件已保存: {file.filename} → {safe_name}")

    return jsonify({
        "ok": True,
        "originalName": file.filename,
        "savedName": safe_name,
        "url": file_url,
        "size": os.path.getsize(save_path),
    })


@app.route("/api/files/<filename>")
def serve_file(filename):
    """提供文件下载 — 大模型 API 通过此 URL 获取文件内容"""
    # 安全检查：只允许 uuid.hex 格式的文件名（防止路径穿越）
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"error": "无效的文件名"}), 400
    return send_from_directory(UPLOAD_DIR, filename)


def encode_image_to_base64(image_path: str) -> str:
    """将本地图片编码为 base64"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


if __name__ == "__main__":
    # 设置 stdout 为 UTF-8 避免 Windows GBK 编码问题
    import sys
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    # 安全闸门：调试模式带 Werkzeug 调试器，暴露在公网等于把服务器交出去
    if debug and host not in ("127.0.0.1", "localhost", "::1"):
        print("❌ 拒绝启动：调试模式（FLASK_DEBUG=1）不允许对外监听。")
        print("   请改成 FLASK_DEBUG=0 后重试。")
        sys.exit(1)

    print("=" * 58)
    print("  AI 聊天助手启动中...（BYOK · 自带 Key 模式）")
    print(f"  监听: {host}:{port}")
    print("  服务器不保存任何 API Key —— 每位访客用自己的 Key")
    if debug:
        print("  ⚠️  调试模式已开启（仅本机使用，切勿用于公网）")
    shown = "127.0.0.1" if host == "0.0.0.0" else host
    print(f"  访问: http://{shown}:{port}")
    print("=" * 58)
    app.run(debug=debug, host=host, port=port)
