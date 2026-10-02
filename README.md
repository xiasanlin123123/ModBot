# AI 聊天助手（自带 Key · 豆包 / DeepSeek 双协议）

基于 Flask 的聊天机器人网页，**同时支持豆包（火山方舟 Ark）和 DeepSeek（OpenAI 兼容接口）**，
界面里可随时切换。支持流式输出、多图 / 多文件上传、Markdown 渲染与代码高亮。

最大的特点是 **BYOK（Bring Your Own Key，自带 Key）**：服务器不保存任何 API Key，
每位访问者在自己的浏览器里填自己的 Key。所以这个网址可以直接分享给别人用 ——
大家各花各的额度，你不用为别人的调用付钱。

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动（不需要任何配置）
python app.py
# 浏览器打开 http://127.0.0.1:5000
```

打开后会有一次**配置向导**，引导你去 DeepSeek 官网领一个 API Key 填进来，之后浏览器会记住，下次不用再填。

Windows 用户也可以直接双击 `start_chatbot.bat`。

## 访客的使用流程（三步）

1. 打开网址 → 弹出配置向导
2. 去 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 注册 → 创建 API Key → 复制 `sk-` 开头那串
3. 粘贴进向导 → 点「开始聊天」。地址和模型名已经预填好了，不用改

Key 存进浏览器 localStorage。**下次打开同一个网址会自动读取，不需要重新填**——
除非换了浏览器、换了电脑，或者清了浏览器缓存。

想分享给朋友，只要把网址发给他们，他们各自填各自的 Key 就行。

## 支持的模型服务

后端协议适配是自动的：**前端只按一套格式发消息，后端根据 API 地址决定转成哪家的格式**。

| 服务 | 接口协议 | API 地址 | 模型名示例 |
| --- | --- | --- | --- |
| DeepSeek | OpenAI 兼容 | `https://api.deepseek.com/chat/completions` | `deepseek-flash`、`deepseek-v4-pro` |
| 豆包（火山方舟） | Ark Responses | `https://ark.cn-beijing.volces.com/api/v3/responses` | `doubao-seed-evolving` |
| OpenAI / Kimi / 通义 / 硅基流动 … | OpenAI 兼容 | 各家的 `/chat/completions` | 各自的模型名 |

两家协议本身不一样（豆包用 `input` + `instructions`，DeepSeek 用 `messages`；
流式事件的结构也不同），这些差异全在后端 `app.py` 里被抹平，前端不需要关心。

> DeepSeek 默认用 `deepseek-flash`（便宜、快，**支持图片输入**）；
> `deepseek-v4-pro` 更强但**不支持图片**，用它时请在设置里取消勾选「该模型支持图片输入」。

## 🔒 关于 API Key（重要）

**服务器端不读取、不保存任何 API Key。**

| 环节 | Key 在哪 |
| --- | --- |
| 访客填写 | 浏览器表单 |
| 持久化 | 访客浏览器的 localStorage |
| 每次聊天 | 随请求体发给本站后端 → 后端原样转发给上游 API |
| 本站服务器 | 只在这次请求的内存里存在几秒，不落盘、不写日志 |

因此：

- 你的仓库和服务器上都没有可泄露的密钥，`git push` 不需要任何脱敏处理
- 站点公开出去，不会有人刷爆你的额度 —— 每个人用自己那把 Key
- 想撤销访问，访客自己到模型平台删掉 Key 即可

**唯一需要注意的是访客侧**：Key 存在浏览器里，在网吧 / 共享电脑上用完后，
应该在「⚙️ 设置」里点「清除本机保存的 Key」。

### 那 .env 里还需要填什么？

**什么都不用填。** `.env` 现在只放服务器自己的运行参数（`HOST` / `PORT` / `FLASK_DEBUG`），
以及可选的「给访客预填的默认地址和模型名」。历史上版本里的 `ARK_API_KEY` / `DEEPSEEK_API_KEY`
已经不再被读取了。

## 模型预设

侧边栏「⚙️ 设置」里可以管理多套模型配置
（预设名称 / API Key / API 地址 / 接口协议 / 模型名 / 多模态开关 / 系统提示词）：

- 顶部「快捷预设」按钮可一键新建豆包或 DeepSeek 预设，地址和模型名自动填好
- 选一个预设 → 改配置 → 点「✅ 保存并使用」立即生效
- 表单有改动但未保存时，标题旁会显示「● 未保存」
- 预设保存在浏览器 localStorage；「清除本机保存的 Key」可以一键抹掉所有 Key


## 关于「思考过程」

豆包和 DeepSeek 的思考模式都会先输出一段推理内容。前端会把它折叠显示在回复上方：

```
💭 思考过程   ← 默认展开，正文开始出现后自动收起
```

推理内容不会混进正文，但会随对话一起保存。

## 功能

- 流式输出（SSE），打字机效果
- 最多 50 张图片 + 10 个文件（≤10MB/个），支持拖拽和粘贴
- Markdown 渲染、代码块高亮与一键复制
- 多对话历史，右侧问题列表快速跳转
- 首次配置向导 + 多套模型预设，随时切换

## 服务端环境变量

现在只剩这些（都不涉及密钥）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址，`serve_public.py` 里默认 `0.0.0.0` |
| `PORT` | `5000` | 监听端口，`serve_public.py` 里默认 `8000` |
| `FLASK_DEBUG` | `0` | 设为 `1` 开启调试模式（仅限本机监听） |
| `THREADS` | `16` | `serve_public.py` 的线程数 |
| `LLM_API_URL` | `https://api.deepseek.com/chat/completions` | 向导里预填给访客的地址 |
| `LLM_MODEL_NAME` | `deepseek-flash` | 向导里预填的模型名 |
| `ARK_API_URL` | `https://ark.cn-beijing.volces.com/api/v3/responses` | 同上，豆包 |
| `ARK_MODEL_NAME` | `doubao-seed-evolving` | 同上，豆包 |

## 目录结构

```
chatbot/
├── app.py                  # Flask 后端（协议适配 + 转发，不存 Key）
├── serve_public.py         # 对外发布用（waitress）
├── requirements.txt
├── .env.example            # 服务器参数模板（.env 本身不入库）
├── start_chatbot.bat       # 本机启动
├── start_public.bat        # 对外发布启动
├── start_chatbot.vbs       # 后台静默启动
├── templates/index.html
├── static/
│   ├── css/style.css
│   └── js/chat.js
└── uploads/                # 上传文件，已忽略
```
