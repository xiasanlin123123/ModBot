/**
 * 豆包 AI 聊天机器人 - 前端逻辑
 */

// ============================================================
// 常量
// ============================================================
const MAX_IMAGES = 50;  // 最多上传图片数量
const MAX_FILES = 10;   // 最多上传文件数量
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 单个文件最大 10MB

// 支持的文件扩展名
const ALLOWED_FILE_EXTENSIONS = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "bat": "text/plain",
    "cmd": "text/plain",
    "py": "text/plain",
    "ahk": "text/plain",
};

// 文本类文件 — 可直接读取文本内容，以 input_text 方式发送
const TEXT_FILE_EXTS = ["txt", "csv", "bat", "cmd", "py", "ahk"];

// ============================================================
// 状态管理
// ============================================================
const state = {
    conversations: {},           // { id: { title, messages: [], createdAt } }
    currentConversationId: null,
    isStreaming: false,
    currentImages: [],           // 当前待发送的图片数组 [{base64, name}]
    currentFiles: [],            // 当前待发送的文件数组 [{base64, name, size, ext}]
};

// ============================================================
// DOM 元素引用
// ============================================================
const elements = {
    sidebar: document.getElementById("sidebar"),
    toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
    chatHistory: document.getElementById("chatHistory"),
    newChatBtn: document.getElementById("newChatBtn"),
    conversationTitle: document.getElementById("conversationTitle"),
    clearChatBtn: document.getElementById("clearChatBtn"),
    messagesContainer: document.getElementById("messagesContainer"),
    welcomeScreen: document.getElementById("welcomeScreen"),
    messageInput: document.getElementById("messageInput"),
    sendBtn: document.getElementById("sendBtn"),
    uploadBtn: document.getElementById("uploadBtn"),
    imageInput: document.getElementById("imageInput"),
    imagePreviewArea: document.getElementById("imagePreviewArea"),
    previewGrid: document.getElementById("previewGrid"),
    imageCount: document.getElementById("imageCount"),
    clearAllImagesBtn: document.getElementById("clearAllImagesBtn"),
    // 【修复3】右侧问题收集栏
    questionPanel: document.getElementById("questionPanel"),
    questionList: document.getElementById("questionList"),
    toggleQuestionPanelBtn: document.getElementById("toggleQuestionPanelBtn"),
    // 文件上传相关
    fileUploadBtn: document.getElementById("fileUploadBtn"),
    fileInput: document.getElementById("fileInput"),
    filePreviewArea: document.getElementById("filePreviewArea"),
    filePreviewGrid: document.getElementById("filePreviewGrid"),
    fileCount: document.getElementById("fileCount"),
    clearAllFilesBtn: document.getElementById("clearAllFilesBtn"),
};

// ============================================================
// 初始化
// ============================================================
function init() {
    loadConversationsFromStorage();
    if (Object.keys(state.conversations).length === 0) {
        createNewConversation();
    } else {
        const latestId = Object.keys(state.conversations).sort((a, b) => {
            return state.conversations[b].createdAt - state.conversations[a].createdAt;
        })[0];
        switchConversation(latestId);
    }
    renderChatHistory();
    bindEvents();
    // 先问一下服务端有哪些默认地址/模型名可以预填，再决定要不要弹首次配置向导
    loadServerDefaults().then(function () {
        maybeShowSetupWizard(false);
    });
    updateModelInfoDisplay();      // 更新侧边栏预设/配置状态显示
}

// ============================================================
// 本地存储
// ============================================================
function loadConversationsFromStorage() {
    try {
        const saved = localStorage.getItem("doubao_chat_conversations");
        if (saved) {
            state.conversations = JSON.parse(saved);
        }
    } catch (e) {
        console.error("加载对话历史失败:", e);
        state.conversations = {};
    }
}

function saveConversationsToStorage() {
    try {
        localStorage.setItem(
            "doubao_chat_conversations",
            JSON.stringify(state.conversations)
        );
    } catch (e) {
        console.error("保存对话历史失败:", e);
    }
}

// ============================================================
// 对话管理
// ============================================================
function createNewConversation() {
    const id = "conv_" + Date.now();
    state.conversations[id] = {
        title: "新对话",
        messages: [],
        createdAt: Date.now(),
    };
    state.currentConversationId = id;
    saveConversationsToStorage();
    renderChatHistory();
    resetChatView();
    elements.conversationTitle.textContent = "新对话";
    refreshQuestionList();  // 【修复3】新建对话时清空问题收集栏
}

function switchConversation(id) {
    if (!state.conversations[id]) return;
    state.currentConversationId = id;
    elements.conversationTitle.textContent = state.conversations[id].title;
    renderMessages();
    renderChatHistory();
    refreshQuestionList();  // 【修复3】切换对话时刷新问题收集栏
}

function deleteConversation(id) {
    if (!state.conversations[id]) return;
    delete state.conversations[id];

    if (state.currentConversationId === id) {
        const remaining = Object.keys(state.conversations);
        if (remaining.length > 0) {
            switchConversation(remaining[remaining.length - 1]);
        } else {
            createNewConversation();
        }
    }

    saveConversationsToStorage();
    renderChatHistory();
}

function getCurrentConversation() {
    if (!state.currentConversationId || !state.conversations[state.currentConversationId]) {
        createNewConversation();
    }
    return state.conversations[state.currentConversationId];
}

// ============================================================
// 渲染
// ============================================================
function renderChatHistory() {
    const container = elements.chatHistory;
    container.innerHTML = "";

    const ids = Object.keys(state.conversations).sort((a, b) => {
        return state.conversations[b].createdAt - state.conversations[a].createdAt;
    });

    ids.forEach((id) => {
        const conv = state.conversations[id];
        const item = document.createElement("div");
        item.className = "chat-history-item";
        if (id === state.currentConversationId) {
            item.classList.add("active");
        }

        item.innerHTML = `
            <span class="history-title">${escapeHtml(conv.title)}</span>
            <button class="rename-history-btn" data-id="${id}" title="重命名">✏️</button>
            <button class="delete-history-btn" data-id="${id}">✕</button>
        `;

        // 点击切换对话
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("delete-history-btn") ||
                e.target.classList.contains("rename-history-btn")) {
                return;
            }
            switchConversation(id);
        });

        container.appendChild(item);
    });

    // 绑定删除按钮
    container.querySelectorAll(".delete-history-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm("确定要删除这个对话吗？")) {
                deleteConversation(btn.dataset.id);
            }
        });
    });

    // 绑定重命名按钮
    container.querySelectorAll(".rename-history-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            startRenameConversation(btn.dataset.id);
        });
    });
}

/**
 * 开始内联重命名：将标题替换为输入框
 */
function startRenameConversation(id) {
    const conv = state.conversations[id];
    if (!conv) return;

    const item = document.querySelector('.rename-history-btn[data-id="' + id + '"]').parentElement;
    const titleSpan = item.querySelector(".history-title");
    const oldTitle = conv.title;

    // 替换为输入框
    const input = document.createElement("input");
    input.type = "text";
    input.className = "history-rename-input";
    input.value = oldTitle;
    input.setAttribute("maxlength", "50");

    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    // 保存函数
    function saveRename() {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== oldTitle) {
            renameConversation(id, newTitle);
        }
        // 重新渲染以恢复标题显示
        renderChatHistory();
    }

    input.addEventListener("blur", saveRename);
    input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur();  // blur 会触发 saveRename
        } else if (e.key === "Escape") {
            input.value = oldTitle;
            input.blur();
        }
    });
}

/**
 * 重命名对话并保存
 */
function renameConversation(id, newTitle) {
    if (!state.conversations[id]) return;
    state.conversations[id].title = newTitle;
    saveConversationsToStorage();

    // 如果是当前对话，更新顶栏标题
    if (id === state.currentConversationId) {
        elements.conversationTitle.textContent = newTitle;
    }
}

function renderMessages() {
    const conv = getCurrentConversation();
    const container = elements.messagesContainer;

    // 清除旧消息
    const oldMessages = container.querySelectorAll(".message, .typing-message");
    oldMessages.forEach((m) => m.remove());

    if (conv.messages.length === 0) {
        elements.welcomeScreen.style.display = "flex";
        refreshQuestionList();
        return;
    }

    elements.welcomeScreen.style.display = "none";

    // 【修复1】传递已保存的 contentHtml + 消息索引 + 文件信息，避免依赖 CDN 二次渲染
    conv.messages.forEach(function (msg, idx) {
        appendMessageToDOM(msg.role, msg.content, msg.imageUrls || [], msg.contentHtml || null, idx, msg.fileUrls || [], msg.fileNames || []);
    });

    scrollToBottom(true);  // 页面加载时强制滚到底部
    refreshQuestionList(); // 【修复3】刷新右侧问题收集栏
}

function appendMessageToDOM(role, content, imageUrls, savedHtml, msgIdx, fileUrls, fileNames) {
    const container = elements.messagesContainer;
    elements.welcomeScreen.style.display = "none";

    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${role}`;
    if (msgIdx !== undefined) {
        messageDiv.setAttribute("data-msg-idx", msgIdx);
    }

    const avatar = role === "user" ? "👤" : "🤖";

    let contentHtml = "";

    // 渲染图片列表
    if (imageUrls && imageUrls.length > 0) {
        contentHtml += '<div class="message-images">';
        imageUrls.forEach(function (url) {
            contentHtml += `<img src="${url}" class="message-image" alt="图片" onclick="window.open(this.src)" loading="lazy">`;
        });
        contentHtml += '</div>';
    }

    // 渲染文件附件列表（仅用户消息）
    if (role === "user" && fileUrls && fileUrls.length > 0) {
        contentHtml += '<div class="message-files">';
        for (var fi = 0; fi < fileUrls.length; fi++) {
            var fNameObj = (fileNames && fileNames[fi]) ? fileNames[fi] : ("file_" + (fi + 1));
            var fName = typeof fNameObj === "string" ? fNameObj : (fNameObj.name || ("file_" + (fi + 1)));
            var fExt = fName.split(".").pop().toLowerCase();
            contentHtml +=
                '<div class="message-file-card" onclick="downloadFile(this)"' +
                ' data-base64="' + fileUrls[fi] + '"' +
                ' data-name="' + escapeHtml(fName) + '"' +
                ' title="点击下载: ' + escapeHtml(fName) + '">' +
                '<span class="message-file-icon">' + getFileIcon(fExt) + '</span>' +
                '<span class="message-file-name">' + escapeHtml(fName) + '</span>' +
                '</div>';
        }
        contentHtml += '</div>';
    }

    // 【修复1】如果有已保存的渲染后 HTML，直接使用，避免 marked.js CDN 加载失败导致格式丢失
    if (savedHtml) {
        contentHtml += savedHtml;
    } else if (content) {
        if (role === "bot") {
            contentHtml += renderMarkdown(content);
        } else {
            contentHtml += `<p>${escapeHtml(content)}</p>`;
        }
    }

    messageDiv.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">${contentHtml}</div>
    `;

    container.appendChild(messageDiv);

    // 代码高亮 + 复制按钮
    if (role === "bot") {
        messageDiv.querySelectorAll("pre code").forEach((block) => {
            if (typeof hljs !== "undefined") {
                hljs.highlightElement(block);
            }
        });
        addCopyButtonsToCodeBlocks(messageDiv);
    }

    return messageDiv;
}

function renderMarkdown(text) {
    if (typeof marked !== "undefined") {
        marked.setOptions({
            breaks: true,
            gfm: true,
        });
        return marked.parse(text);
    }
    return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// 智能滚动 — 仅在用户处于底部附近时自动滚动
// ============================================================
function isNearBottom() {
    const container = elements.messagesContainer;
    // 如果用户距离底部超过 150px，说明在阅读历史消息，不强制滚动
    return container.scrollHeight - container.scrollTop - container.clientHeight < 150;
}

function scrollToBottom(force) {
    if (force || isNearBottom()) {
        const container = elements.messagesContainer;
        requestAnimationFrame(function () {
            container.scrollTop = container.scrollHeight;
        });
    }
}

// ============================================================
// 打字指示器
// ============================================================
function showTypingIndicator() {
    const container = elements.messagesContainer;
    elements.welcomeScreen.style.display = "none";

    const typingDiv = document.createElement("div");
    typingDiv.className = "message bot typing-message";
    typingDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(typingDiv);
    scrollToBottom(true);  // 新消息开始时强制滚到底部
    return typingDiv;
}

function removeTypingIndicator() {
    const typing = document.querySelector(".typing-message");
    if (typing) typing.remove();
}

// ============================================================
// 消息发送
// ============================================================
async function sendMessage() {
    if (state.isStreaming) return;

    // 还没配过自己的 Key → 先把配置向导叫出来，别让用户白发一条消息
    if (!isConfigured()) {
        maybeShowSetupWizard(true);
        return;
    }

    const text = elements.messageInput.value.trim();
    const hasImages = state.currentImages.length > 0;
    const hasFiles = state.currentFiles.length > 0;

    if (!text && !hasImages && !hasFiles) return;

    // 清空输入
    elements.messageInput.value = "";
    elements.messageInput.style.height = "auto";

    // 构建用户消息的 content 数组
    const userContent = [];

    // 添加所有图片
    const imageUrls = state.currentImages.map(function (img) {
        return img.base64;
    });

    imageUrls.forEach(function (url) {
        userContent.push({
            type: "input_image",
            image_url: url,
        });
    });

    // 添加所有文件
    var fileUrls = [];
    var fileNames = [];
    var fileTextBlock = "";

    state.currentFiles.forEach(function (f) {
        fileNames.push(f.name);
        if (f.textContent !== undefined) {
            // 文本文件：生成 data URI 供下载，内容直接发给 AI
            var dataUri = "data:text/plain;base64," + btoa(unescape(encodeURIComponent(f.textContent)));
            fileUrls.push(dataUri);
            fileTextBlock += "\n\n[文件: " + f.name + "]\n```\n" + f.textContent + "\n```";
        } else if (f.base64) {
            // 二进制文件：存 base64 用于下载（暂不发送给 AI）
            fileUrls.push(f.base64);
        }
    });

    // 文件内容拼在用户文本前面
    var fullText = fileTextBlock;
    if (text) {
        fullText = fullText ? (fullText + "\n\n" + text) : text;
    }
    if (fullText) {
        userContent.push({
            type: "input_text",
            text: fullText,
        });
    }

    // 渲染用户消息到 DOM，再保存（需要从 DOM 获取 contentHtml）
    const conv = getCurrentConversation();
    var userMsgIdx = conv.messages.length;
    var userMsgDiv = appendMessageToDOM("user", text, imageUrls.slice(), null, userMsgIdx, fileUrls.slice(), fileNames.slice());

    // 保存用户消息（存储图片URL数组 + 文件信息 + 渲染后 HTML）
    conv.messages.push({
        role: "user",
        content: text,
        contentRaw: userContent,
        imageUrls: imageUrls.slice(),  // 复制数组
        fileUrls: fileUrls.slice(),    // 文件 base64 URLs
        fileNames: fileNames.slice(),  // 文件原始名称
        contentHtml: userMsgDiv.querySelector(".message-content").innerHTML,  // 【修复1】保存渲染后 HTML
    });

    // 清除图片预览和文件预览
    clearAllImages();
    clearAllFiles();

    // 自动更新标题
    if (conv.title === "新对话" && text) {
        conv.title = text.slice(0, 30) + (text.length > 30 ? "..." : "");
        elements.conversationTitle.textContent = conv.title;
        renderChatHistory();
    }

    saveConversationsToStorage();

    // 显示打字指示器
    await new Promise(function (r) { setTimeout(r, 100); });
    showTypingIndicator();

    // 构建 API 请求的完整消息历史
    const apiMessages = buildApiMessages(conv);

    // 发送请求 (流式)
    state.isStreaming = true;
    elements.sendBtn.disabled = true;

    try {
        const response = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // 关键：模型配置随每次请求一起发上去。
            // 后端不保存任何 Key，所以同一个网址给多少人用都不会串（各用各的）。
            body: JSON.stringify({
                messages: apiMessages,
                config: buildRequestConfig(),
            }),
        });

        if (!response.ok) {
            // 后端在配置有问题 / 被限流时会返回一句中文说明，优先把它原样显示出来，
            // 别让用户只看到 "HTTP 429" 这种看不懂的东西
            var friendly = "";
            try {
                var errBody = await response.json();
                if (errBody && errBody.error) friendly = String(errBody.error);
            } catch (e) {
                // 不是 JSON（比如网关返回的 HTML 错误页），忽略
            }
            if (friendly) {
                removeTypingIndicator();
                appendMessageToDOM("bot", "❌ " + friendly, []);
                state.isStreaming = false;
                elements.sendBtn.disabled = false;
                elements.messageInput.focus();
                return;
            }
            throw new Error("HTTP " + response.status + ": " + response.statusText);
        }

        removeTypingIndicator();

        // 创建机器人消息气泡（索引 = messages.length，即接下来 push 后的位置）
        var botMsgIdx = conv.messages.length;
        const botMessageDiv = appendMessageToDOM("bot", "", [], null, botMsgIdx);
        const contentDiv = botMessageDiv.querySelector(".message-content");
        let fullResponse = "";
        // 思考模式（DeepSeek 的 thinking / 豆包的推理过程）会先推一段推理内容，
        // 单独折叠显示在正文上方，正文一开始出现就自动收起
        let reasoningText = "";

        var renderStreamContent = function () {
            var html = "";
            if (reasoningText) {
                html += '<details class="reasoning-block"' + (fullResponse ? "" : " open") + '>' +
                    '<summary>💭 思考过程</summary>' +
                    '<div class="reasoning-content">' + escapeHtml(reasoningText) + '</div>' +
                    '</details>';
            }
            if (fullResponse) html += renderMarkdown(fullResponse);
            contentDiv.innerHTML = html;
        };

        // 【修复2】滚动到 bot 消息顶部，让用户从最上面开始阅读
        botMessageDiv.scrollIntoView({ behavior: "smooth", block: "start" });

        // 读取 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let hasError = false;  // 标记是否已收到错误，防止被"未收到回复"覆盖

        while (true) {
            const result = await reader.read();
            const done = result.done;
            const value = result.value;
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.startsWith("data: ")) {
                    var dataStr = line.slice(6);
                    if (dataStr === "[DONE]") continue;

                    try {
                        var data = JSON.parse(dataStr);
                        if (data.error) {
                            contentDiv.innerHTML = '<p style="color:red;">❌ ' +
                                escapeHtml(data.error) + '</p>';
                            hasError = true;
                            break;
                        }
                        if (data.reasoning) {
                            reasoningText += data.reasoning;
                            renderStreamContent();
                        }
                        if (data.text) {
                            fullResponse += data.text;
                            // 流式渲染：只做轻量的 markdown 渲染，保持文字流畅出现
                            renderStreamContent();
                        }
                    } catch (e) {
                        // 跳过无法解析的行
                    }
                }
            }
            // 出错后立即退出 while 循环，避免错误被覆盖
            if (hasError) break;
            // 【修复2】流式输出期间不再自动滚动，让用户从顶部往下阅读
        }

        // 如果已经显示错误，不再做后续处理
        if (hasError) {
            state.isStreaming = false;
            elements.sendBtn.disabled = false;
            elements.messageInput.focus();
            return;
        }

        // 流结束后一次性做代码高亮 + 复制按钮（这些是昂贵操作，只需做一次）
        contentDiv.querySelectorAll("pre code").forEach(function (block) {
            if (typeof hljs !== "undefined") {
                hljs.highlightElement(block);
            }
        });
        addCopyButtonsToCodeBlocks(contentDiv);

        // 保存机器人回复（存储渲染后 HTML）
        if (fullResponse || reasoningText) {
            conv.messages.push({
                role: "assistant",
                content: fullResponse,
                reasoning: reasoningText || undefined,   // 思考过程，便于导出/回看
                contentHtml: contentDiv.innerHTML,  // 【修复1】保存渲染后 HTML
            });
        } else {
            contentDiv.innerHTML = '<p style="color:#888;">（未收到回复，请重试）</p>';
        }

        saveConversationsToStorage();
        refreshQuestionList();  // 【修复3】刷新问题收集栏

    } catch (error) {
        removeTypingIndicator();
        appendMessageToDOM("bot", '❌ 出错了: ' + error.message, []);
        console.error("发送消息失败:", error);
    } finally {
        state.isStreaming = false;
        elements.sendBtn.disabled = false;
        elements.messageInput.focus();
    }
}

/**
 * 构建发送给 API 的消息列表
 */
function buildApiMessages(conv) {
    const apiMessages = [];

    for (var i = 0; i < conv.messages.length; i++) {
        var msg = conv.messages[i];
        if (msg.role === "user") {
            if (msg.contentRaw) {
                apiMessages.push({
                    role: "user",
                    content: msg.contentRaw,
                });
            } else {
                var content = [];
                // 支持单个 imageUrl 和多个 imageUrls（兼容旧数据）
                var urls = msg.imageUrls || (msg.imageUrl ? [msg.imageUrl] : []);
                urls.forEach(function (url) {
                    content.push({
                        type: "input_image",
                        image_url: url,
                    });
                });
                // 兼容旧消息中的文件：文本文件解码后合并到 input_text
                var fUrls = msg.fileUrls || [];
                var fNames = msg.fileNames || [];
                var oldFileText = "";
                fUrls.forEach(function (fUrl, fi) {
                    if (fUrl && fUrl.indexOf("data:text/plain;base64,") === 0) {
                        try {
                            var b64 = fUrl.split(",")[1];
                            var decoded = decodeURIComponent(escape(atob(b64)));
                            oldFileText += "\n\n[文件: " + (fNames[fi] || "file") + "]\n```\n" + decoded + "\n```";
                        } catch(e) {}
                    }
                });
                var msgText = (oldFileText ? oldFileText + "\n\n" : "") + (msg.content || "");
                if (msgText) {
                    content.push({
                        type: "input_text",
                        text: msgText,
                    });
                }
                apiMessages.push({
                    role: "user",
                    content: content,
                });
            }
        } else if (msg.role === "assistant") {
            apiMessages.push({
                role: "assistant",
                content: msg.content,
            });
        }
    }

    return apiMessages;
}

// ============================================================
// 多图处理 (最多50张)
// ============================================================
function addImages(files) {
    var remaining = MAX_IMAGES - state.currentImages.length;

    if (remaining <= 0) {
        alert("最多只能上传 " + MAX_IMAGES + " 张图片，请先删除一些再添加。");
        return;
    }

    if (files.length > remaining) {
        alert("还能添加 " + remaining + " 张图片（上限 " + MAX_IMAGES + " 张），将只添加前 " + remaining + " 张。");
    }

    var toProcess = Math.min(files.length, remaining);
    var processed = 0;

    for (var i = 0; i < toProcess; i++) {
        (function (file) {
            if (!file.type.startsWith("image/")) {
                processed++;
                checkDone();
                return;
            }

            var reader = new FileReader();
            reader.onload = function (e) {
                state.currentImages.push({
                    base64: e.target.result,
                    name: file.name,
                });
                processed++;
                checkDone();
            };
            reader.readAsDataURL(file);
        })(files[i]);
    }

    function checkDone() {
        if (processed >= toProcess) {
            renderImagePreviews();
            elements.messageInput.focus();
        }
    }
}

function removeImage(index) {
    state.currentImages.splice(index, 1);
    renderImagePreviews();
}

function clearAllImages() {
    state.currentImages = [];
    renderImagePreviews();
    elements.imageInput.value = "";
}

function renderImagePreviews() {
    var grid = elements.previewGrid;
    var area = elements.imagePreviewArea;
    var countEl = elements.imageCount;

    if (state.currentImages.length === 0) {
        area.style.display = "none";
        grid.innerHTML = "";
        return;
    }

    area.style.display = "block";
    countEl.textContent = state.currentImages.length;

    grid.innerHTML = "";
    state.currentImages.forEach(function (img, index) {
        var item = document.createElement("div");
        item.className = "preview-item";
        item.innerHTML =
            '<img src="' + img.base64 + '" alt="图片' + (index + 1) + '">' +
            '<button class="remove-preview-btn" data-index="' + index +
            '" title="移除这张图片">✕</button>';

        item.querySelector(".remove-preview-btn").addEventListener("click", function (e) {
            e.stopPropagation();
            removeImage(index);
        });

        grid.appendChild(item);
    });
}

// ============================================================
// 多文件处理 (最多10个，每个最大10MB)
// ============================================================

/**
 * 根据文件扩展名返回 emoji 图标
 */
function getFileIcon(ext) {
    var iconMap = {
        "pdf":  "📑",
        "doc":  "📄",
        "docx": "📄",
        "xls":  "📊",
        "xlsx": "📊",
        "xlsm": "📊",
        "ppt":  "📈",
        "pptx": "📈",
        "txt":  "📝",
        "csv":  "📋",
        "bat":  "⚙️",
        "cmd":  "⚙️",
        "py":   "🐍",
        "ahk":  "⚡",
    };
    return iconMap[ext] || "📄";
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

/**
 * 检查文件类型是否受支持
 */
function isAllowedFileType(file) {
    var ext = file.name.split(".").pop().toLowerCase();
    return ALLOWED_FILE_EXTENSIONS.hasOwnProperty(ext);
}

/**
 * 添加文件到待发送列表
 */
function addFiles(files) {
    var remaining = MAX_FILES - state.currentFiles.length;

    if (remaining <= 0) {
        alert("最多只能上传 " + MAX_FILES + " 个文件，请先删除一些再添加。");
        return;
    }

    if (files.length > remaining) {
        alert("还能添加 " + remaining + " 个文件（上限 " + MAX_FILES + " 个），将只添加前 " + remaining + " 个。");
    }

    var toProcess = Math.min(files.length, remaining);
    var processed = 0;

    for (var i = 0; i < toProcess; i++) {
        (function (file) {
            if (!isAllowedFileType(file)) {
                alert("\"" + file.name + "\" 不是支持的文件类型。\n支持: pdf, doc, docx, xls, xlsx, xlsm, ppt, pptx, txt, csv, bat, cmd, py, ahk");
                processed++;
                checkDone();
                return;
            }

            if (file.size > MAX_FILE_SIZE) {
                alert("\"" + file.name + "\" 文件大小为 " + formatFileSize(file.size) + "，超过上限 10MB，已跳过。");
                processed++;
                checkDone();
                return;
            }

            var ext = file.name.split(".").pop().toLowerCase();
            var isTextFile = TEXT_FILE_EXTS.indexOf(ext) >= 0;

            if (isTextFile) {
                var textReader = new FileReader();
                textReader.onload = function (e) {
                    state.currentFiles.push({
                        name: file.name, size: file.size, ext: ext,
                        textContent: e.target.result,
                    });
                    processed++;
                    checkDone();
                };
                textReader.readAsText(file);
            } else {
                var reader = new FileReader();
                reader.onload = function (e) {
                    state.currentFiles.push({
                        base64: e.target.result,
                        name: file.name, size: file.size, ext: ext,
                    });
                    processed++;
                    checkDone();
                };
                reader.readAsDataURL(file);
            }
        })(files[i]);
    }

    function checkDone() {
        if (processed >= toProcess) {
            renderFilePreviews();
            elements.messageInput.focus();
        }
    }
}

/**
 * 移除单个文件
 */
function removeFile(index) {
    state.currentFiles.splice(index, 1);
    renderFilePreviews();
}

/**
 * 清除所有待发送文件
 */
function clearAllFiles() {
    state.currentFiles = [];
    renderFilePreviews();
    elements.fileInput.value = "";
}

/**
 * 渲染文件预览区域
 */
function renderFilePreviews() {
    var grid = elements.filePreviewGrid;
    var area = elements.filePreviewArea;
    var countEl = elements.fileCount;

    if (!grid || !area) return;

    if (state.currentFiles.length === 0) {
        area.style.display = "none";
        grid.innerHTML = "";
        return;
    }

    area.style.display = "block";
    countEl.textContent = state.currentFiles.length;

    grid.innerHTML = "";
    state.currentFiles.forEach(function (file, index) {
        var item = document.createElement("div");
        item.className = "file-preview-item";
        item.innerHTML =
            '<span class="file-icon">' + getFileIcon(file.ext) + '</span>' +
            '<div class="file-info">' +
                '<span class="file-name" title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</span>' +
                '<span class="file-size">' + formatFileSize(file.size) + '</span>' +
            '</div>' +
            '<button class="remove-file-preview-btn" data-index="' + index +
            '" title="移除这个文件">✕</button>';

        item.querySelector(".remove-file-preview-btn").addEventListener("click", function (e) {
            e.stopPropagation();
            removeFile(index);
        });

        grid.appendChild(item);
    });
}

/**
 * 下载 base64 文件（点击消息中的文件卡片触发）
 */
function downloadFile(el) {
    var base64 = el.getAttribute("data-base64");
    var name = el.getAttribute("data-name");
    var a = document.createElement("a");
    a.href = base64;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ============================================================
// 问题收集栏 — 右侧面板列出所有用户提问
// ============================================================

/**
 * 刷新右侧问题收集栏
 */
function refreshQuestionList() {
    if (!elements.questionList) return;
    var conv = getCurrentConversation();
    var list = elements.questionList;
    list.innerHTML = "";

    if (!conv || conv.messages.length === 0) {
        list.innerHTML = '<div class="question-empty">暂无提问</div>';
        updateQuestionCount(0);
        return;
    }

    var count = 0;
    conv.messages.forEach(function (msg, idx) {
        if (msg.role !== "user" || !msg.content) return;

        var item = document.createElement("div");
        item.className = "question-item";
        item.setAttribute("data-msg-idx", idx);
        item.title = msg.content;  // hover 时显示完整问题
        item.textContent = msg.content;
        count++;

        item.addEventListener("click", function () {
            scrollToMessage(idx);
        });

        list.appendChild(item);
    });

    if (list.children.length === 0) {
        list.innerHTML = '<div class="question-empty">暂无提问</div>';
    }
    updateQuestionCount(count);
}

function updateQuestionCount(n) {
    var countEl = document.getElementById("questionCount");
    if (countEl) {
        countEl.textContent = n;
    }
}

/**
 * 跳转到指定索引的消息并高亮
 */
function scrollToMessage(idx) {
    var target = document.querySelector('.message[data-msg-idx="' + idx + '"]');
    if (!target) return;

    // 滚动到目标消息
    target.scrollIntoView({ behavior: "smooth", block: "start" });

    // 高亮闪烁动画
    target.classList.add("msg-highlight");
    setTimeout(function () {
        target.classList.remove("msg-highlight");
    }, 2000);
}

// ============================================================
// 重置视图
// ============================================================
function resetChatView() {
    const oldMessages = elements.messagesContainer.querySelectorAll(".message, .typing-message");
    oldMessages.forEach(function (m) { m.remove(); });
    elements.welcomeScreen.style.display = "flex";
    elements.messageInput.value = "";
    clearAllImages();
    clearAllFiles();
    elements.messageInput.focus();
    elements.conversationTitle.textContent = "新对话";
}

// ============================================================
// 事件绑定
// ============================================================
function bindEvents() {
    // 发送按钮
    elements.sendBtn.addEventListener("click", sendMessage);

    // 回车发送，Shift+Enter 换行
    elements.messageInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 【修复4】自动调整输入框高度（上限 40vh，类似 Claude Code）
    elements.messageInput.addEventListener("input", function () {
        elements.messageInput.style.height = "auto";
        elements.messageInput.style.height =
            Math.min(elements.messageInput.scrollHeight, window.innerHeight * 0.4) + "px";
    });

    // 上传图片按钮
    elements.uploadBtn.addEventListener("click", function () {
        elements.imageInput.click();
    });
    elements.imageInput.addEventListener("change", function (e) {
        if (e.target.files.length > 0) {
            // 【修复3】支持多选文件
            addImages(e.target.files);
        }
    });

    // 上传文件按钮
    elements.fileUploadBtn.addEventListener("click", function () {
        elements.fileInput.click();
    });
    elements.fileInput.addEventListener("change", function (e) {
        if (e.target.files.length > 0) {
            addFiles(e.target.files);
        }
    });

    // 清除所有图片
    elements.clearAllImagesBtn.addEventListener("click", function () {
        clearAllImages();
    });

    // 清除所有文件
    elements.clearAllFilesBtn.addEventListener("click", function () {
        clearAllFiles();
    });

    // 新建对话
    elements.newChatBtn.addEventListener("click", createNewConversation);

    // 切换侧边栏
    elements.toggleSidebarBtn.addEventListener("click", function () {
        elements.sidebar.classList.toggle("collapsed");
    });

    // 【修复3】切换问题收集栏
    if (elements.toggleQuestionPanelBtn) {
        elements.toggleQuestionPanelBtn.addEventListener("click", function () {
            if (elements.questionPanel) {
                elements.questionPanel.classList.toggle("collapsed");
            }
        });
    }

    // 清空对话
    elements.clearChatBtn.addEventListener("click", function () {
        if (confirm("确定要清空当前对话吗？")) {
            var conv = getCurrentConversation();
            conv.messages = [];
            saveConversationsToStorage();
            resetChatView();
            refreshQuestionList();  // 【修复3】清空后刷新问题收集栏
        }
    });

    // 建议提示词点击
    document.querySelectorAll(".suggestion-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
            elements.messageInput.value = chip.dataset.prompt;
            sendMessage();
        });
    });

    // 【修复3】粘贴图片/文件 — 支持同时粘贴多张/多个
    document.addEventListener("paste", function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        var imageFiles = [];
        var docFiles = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.startsWith("image/")) {
                imageFiles.push(items[i].getAsFile());
            } else if (items[i].kind === "file") {
                var f = items[i].getAsFile();
                if (f && isAllowedFileType(f)) {
                    docFiles.push(f);
                }
            }
        }

        if (imageFiles.length > 0 || docFiles.length > 0) {
            e.preventDefault();
            if (imageFiles.length > 0) addImages(imageFiles);
            if (docFiles.length > 0) addFiles(docFiles);
        }
    });

    // 【修复3】拖拽图片/文件 — 支持同时拖拽多张/多个
    elements.messagesContainer.addEventListener("dragover", function (e) {
        e.preventDefault();
    });
    elements.messagesContainer.addEventListener("drop", function (e) {
        e.preventDefault();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            var imageFiles = [];
            var docFiles = [];
            for (var i = 0; i < files.length; i++) {
                if (files[i].type.startsWith("image/")) {
                    imageFiles.push(files[i]);
                } else if (isAllowedFileType(files[i])) {
                    docFiles.push(files[i]);
                }
            }
            if (imageFiles.length > 0) addImages(imageFiles);
            if (docFiles.length > 0) addFiles(docFiles);
        }
    });

    // 用户手动滚动时记录位置，防止被自动滚动打断
    elements.messagesContainer.addEventListener("scroll", function () {
        // 不需要额外操作，isNearBottom() 已经在 scrollToBottom 中检查
    });

    // 设置面板事件
    bindSettingsEvents();
    bindSetupEvents();
}

// ============================================================
// 代码块复制按钮
// ============================================================
function addCopyButtonsToCodeBlocks(container) {
    container.querySelectorAll("pre").forEach(function (pre) {
        // 跳过已包装的
        if (pre.parentElement.classList.contains("code-block-wrapper")) return;

        var wrapper = document.createElement("div");
        wrapper.className = "code-block-wrapper";

        // 检测语言
        var code = pre.querySelector("code");
        var lang = "";
        if (code && code.className) {
            code.className.split(" ").forEach(function (cls) {
                if (cls.startsWith("language-")) {
                    lang = cls.replace("language-", "");
                }
            });
        }

        // 语言标签 + 复制按钮
        var header = document.createElement("div");
        header.className = "code-block-header";
        header.innerHTML =
            '<span class="code-lang">' + (lang || "code") + "</span>" +
            '<button class="copy-code-btn">📋 复制</button>';

        // 包装 pre
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        // 绑定复制事件
        header.querySelector(".copy-code-btn").addEventListener("click", function () {
            var codeText = pre.querySelector("code").textContent;
            copyTextToClipboard(codeText, this);
        });
    });
}

function copyTextToClipboard(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
            showCopySuccess(btn);
        }).catch(function () {
            fallbackCopy(text, btn);
        });
    } else {
        fallbackCopy(text, btn);
    }
}

function fallbackCopy(text, btn) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand("copy");
        showCopySuccess(btn);
    } catch (e) {
        btn.textContent = "❌ 失败";
        setTimeout(function () { btn.textContent = "📋 复制"; }, 2000);
    }
    document.body.removeChild(textarea);
}

function showCopySuccess(btn) {
    btn.textContent = "✅ 已复制";
    setTimeout(function () {
        btn.textContent = "📋 复制";
    }, 2000);
}

// ============================================================
// 设置管理 — 大模型预设系统
// ============================================================

// 默认预设 —— 出厂默认走 DeepSeek：去官网领个 Key 填进来就能开始用
var DEFAULT_PRESET = {
    name: "DeepSeek",
    apiKey: "",
    apiUrl: "https://api.deepseek.com/chat/completions",
    modelName: "deepseek-flash",
    systemPrompt: "你是一个智能AI助手，善于解答各种问题，语气友好、专业。",
    provider: "openai",          // "" 自动识别 | "ark" 火山方舟 | "openai" OpenAI 兼容
    supportsVision: true         // deepseek-flash 支持图片；换成 deepseek-v4-pro 请取消勾选
};

// 一键填充模板 —— 点一下自动填好地址、模型名和协议，用户只需补自己的 Key
var PRESET_TEMPLATES = {
    doubao: {
        name: "豆包",
        apiUrl: "https://ark.cn-beijing.volces.com/api/v3/responses",
        modelName: "doubao-seed-evolving",
        provider: "ark",
        supportsVision: true,
        systemPrompt: "你是一个智能AI助手，善于解答各种问题，语气友好、专业。"
    },
    deepseek: {
        name: "DeepSeek",
        apiUrl: "https://api.deepseek.com/chat/completions",
        modelName: "deepseek-flash",
        provider: "openai",
        supportsVision: true,       // deepseek-flash 支持图片；换成 deepseek-v4-pro 请取消勾选
        systemPrompt: "你是一个智能AI助手，善于解答各种问题，语气友好、专业。"
    }
};

// 存储 key
var PRESETS_STORAGE_KEY = "doubao_chat_presets";

// 当前在表单中查看/编辑的预设 ID（不一定是活跃预设）
var currentViewingPresetId = null;

/**
 * 加载所有预设数据
 * @returns {{ presets: Array, activePresetId: string|null }}
 */
function loadAllPresets() {
    try {
        var raw = localStorage.getItem(PRESETS_STORAGE_KEY);
        if (raw) {
            var data = JSON.parse(raw);
            if (data.presets && Array.isArray(data.presets)) {
                // provider / supportsVision 是后加的字段，老预设这里补上默认值
                data.presets = data.presets.map(normalizePreset);
                return data;
            }
        }
    } catch (e) {
        console.error("加载预设失败:", e);
    }

    // 尝试迁移旧格式
    var migrated = migrateOldSettings();
    if (migrated) return migrated;

    // 冷启动：创建一个默认预设
    var defaultPreset = createPresetObject(DEFAULT_PRESET.name, DEFAULT_PRESET);
    var initialData = {
        presets: [defaultPreset],
        activePresetId: defaultPreset.id
    };
    saveAllPresets(initialData);
    return initialData;
}

/**
 * 保存所有预设数据
 */
function saveAllPresets(data) {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(data));
}

/**
 * 迁移旧版单条设置 → 新预设格式
 */
function migrateOldSettings() {
    try {
        var oldSettings = localStorage.getItem("doubao_chat_settings");
        if (oldSettings) {
            var old = JSON.parse(oldSettings);
            var preset = createPresetObject("我的配置", {
                name: "我的配置",
                apiKey: old.apiKey || "",
                apiUrl: old.apiUrl || DEFAULT_PRESET.apiUrl,
                modelName: old.modelName || DEFAULT_PRESET.modelName,
                systemPrompt: old.systemPrompt || DEFAULT_PRESET.systemPrompt
            });
            var data = {
                presets: [preset],
                activePresetId: preset.id
            };
            saveAllPresets(data);
            // 清除旧数据
            localStorage.removeItem("doubao_chat_settings");
            console.log("✅ 已从旧格式迁移预设");
            return data;
        }
    } catch (e) {}
    return null;
}

/**
 * 补齐老预设缺少的字段
 */
function normalizePreset(p) {
    if (!p) return p;
    if (p.provider === undefined || p.provider === null) {
        p.provider = "";           // 老预设：交给后端按 URL 自动识别
    }
    if (p.supportsVision === undefined || p.supportsVision === null) {
        p.supportsVision = true;   // 老行为：上传的图片一直都会发出去
    }
    return p;
}

/**
 * 创建一个预设对象
 */
var presetIdSeq = 0;
function createPresetObject(name, fields) {
    // 同一毫秒内连续创建会撞 id，加个自增序号
    presetIdSeq += 1;
    return {
        id: "preset_" + Date.now() + "_" + presetIdSeq,
        name: name || "未命名",
        apiKey: fields.apiKey || "",
        apiUrl: fields.apiUrl || DEFAULT_PRESET.apiUrl,
        modelName: fields.modelName || DEFAULT_PRESET.modelName,
        systemPrompt: fields.systemPrompt || DEFAULT_PRESET.systemPrompt,
        // 老预设没有这两个字段，给出安全默认值
        provider: fields.provider !== undefined ? fields.provider : "",
        supportsVision: fields.supportsVision !== undefined
            ? !!fields.supportsVision
            : (fields.provider === "openai" ? false : true),
        createdAt: Date.now()
    };
}

/**
 * 获取当前活跃的预设
 */
function getActivePreset() {
    var data = loadAllPresets();
    if (!data.activePresetId) return null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === data.activePresetId) {
            return data.presets[i];
        }
    }
    // activePresetId 指向了一个不存在的预设，修复
    if (data.presets.length > 0) {
        data.activePresetId = data.presets[0].id;
        saveAllPresets(data);
        return data.presets[0];
    }
    return null;
}

// ============================================================
// 弹窗交互
// ============================================================

function openSettingsModal() {
    refreshPresetSelector();
    var data = loadAllPresets();

    // 默认选中活跃预设
    var targetId = data.activePresetId;
    if (!targetId && data.presets.length > 0) {
        targetId = data.presets[0].id;
    }
    if (targetId) {
        document.getElementById("presetSelector").value = targetId;
        loadPresetToForm(targetId);
    } else {
        clearPresetForm();
    }

    document.getElementById("apiKeyInput").type = "password";
    document.getElementById("togglePasswordBtn").textContent = "👁️";
    document.getElementById("settingsOverlay").style.display = "flex";
}

function closeSettingsModal() {
    document.getElementById("settingsOverlay").style.display = "none";
}

// ============================================================
// 预设选择器
// ============================================================

function refreshPresetSelector() {
    var data = loadAllPresets();
    var selector = document.getElementById("presetSelector");
    selector.innerHTML = '<option value="">-- 选择预设 --</option>';

    data.presets.forEach(function (p) {
        var option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name + " (" + p.modelName + ")";
        if (p.id === data.activePresetId) {
            option.textContent = "⭐ " + option.textContent;
        }
        selector.appendChild(option);
    });
}

function onPresetSelectorChange() {
    var presetId = document.getElementById("presetSelector").value;
    if (!presetId) {
        clearPresetForm();
        return;
    }
    loadPresetToForm(presetId);
}

/**
 * 把某个预设的数据加载到表单中
 */
function loadPresetToForm(presetId) {
    var data = loadAllPresets();
    var preset = null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === presetId) {
            preset = data.presets[i];
            break;
        }
    }
    if (!preset) return;

    currentViewingPresetId = preset.id;

    document.getElementById("presetNameInput").value = preset.name || "";
    document.getElementById("apiKeyInput").value = preset.apiKey || "";
    document.getElementById("apiUrlInput").value = preset.apiUrl || "";
    document.getElementById("modelNameInput").value = preset.modelName || "";
    document.getElementById("systemPromptInput").value = preset.systemPrompt || "";
    document.getElementById("providerSelect").value = preset.provider || "";
    document.getElementById("supportsVisionInput").checked = preset.supportsVision !== false;
    document.getElementById("apiKeyInput").type = "password";
    document.getElementById("togglePasswordBtn").textContent = "👁️";

    // 显示/隐藏 "使用中" 标记
    var badge = document.getElementById("activePresetBadge");
    var useBtn = document.getElementById("settingsUseBtn");
    if (preset.id === data.activePresetId) {
        badge.style.display = "inline-block";
        useBtn.textContent = "✅ 当前使用中";
        useBtn.classList.add("is-active");
    } else {
        badge.style.display = "none";
        useBtn.textContent = "✅ 保存并使用";
        useBtn.classList.remove("is-active");
    }
    markPresetFormClean();
}

/**
 * 清空表单
 */
function clearPresetForm() {
    currentViewingPresetId = null;
    document.getElementById("presetNameInput").value = "";
    document.getElementById("apiKeyInput").value = "";
    document.getElementById("apiUrlInput").value = DEFAULT_PRESET.apiUrl;
    document.getElementById("modelNameInput").value = DEFAULT_PRESET.modelName;
    document.getElementById("systemPromptInput").value = DEFAULT_PRESET.systemPrompt;
    document.getElementById("providerSelect").value = DEFAULT_PRESET.provider;
    document.getElementById("supportsVisionInput").checked = DEFAULT_PRESET.supportsVision;
    document.getElementById("apiKeyInput").type = "password";
    document.getElementById("togglePasswordBtn").textContent = "👁️";
    document.getElementById("activePresetBadge").style.display = "none";
    document.getElementById("settingsUseBtn").textContent = "✅ 保存并使用";
    document.getElementById("settingsUseBtn").classList.remove("is-active");
    markPresetFormClean();
}

/**
 * 从表单读取当前填写的数据
 */
function readFormAsFields() {
    return {
        name: document.getElementById("presetNameInput").value.trim() || "未命名",
        apiKey: document.getElementById("apiKeyInput").value.trim(),
        apiUrl: document.getElementById("apiUrlInput").value.trim(),
        modelName: document.getElementById("modelNameInput").value.trim(),
        // 提示词不 trim，保留用户故意加的首尾空格/换行
        systemPrompt: document.getElementById("systemPromptInput").value,
        provider: document.getElementById("providerSelect").value,
        supportsVision: document.getElementById("supportsVisionInput").checked
    };
}

// ============================================================
// 表单"未保存"提示
// ============================================================

/** 表单当前内容 与 已存储的预设 是否有差异 */
function isPresetFormDirty() {
    if (!currentViewingPresetId) return false;
    var data = loadAllPresets();
    var preset = null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === currentViewingPresetId) { preset = data.presets[i]; break; }
    }
    if (!preset) return false;

    var f = readFormAsFields();
    return f.name !== (preset.name || "") ||
           f.apiKey !== (preset.apiKey || "") ||
           f.apiUrl !== (preset.apiUrl || "") ||
           f.modelName !== (preset.modelName || "") ||
           f.systemPrompt !== (preset.systemPrompt || "") ||
           f.provider !== (preset.provider || "") ||
           f.supportsVision !== (preset.supportsVision !== false);
}

function updatePresetDirtyState() {
    var hint = document.getElementById("presetDirtyHint");
    if (!hint) return;
    hint.style.display = isPresetFormDirty() ? "inline-block" : "none";
}

function markPresetFormClean() {
    var hint = document.getElementById("presetDirtyHint");
    if (hint) hint.style.display = "none";
}

// ============================================================
// 操作：激活、另存、更新、删除
// ============================================================

/**
 * 激活当前选中的预设
 */
function activateCurrentPreset() {
    var presetId = document.getElementById("presetSelector").value;
    if (!presetId) {
        alert("请先选择一个预设");
        return;
    }

    var data = loadAllPresets();
    var preset = null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === presetId) {
            preset = data.presets[i];
            break;
        }
    }
    if (!preset) return;

    // 【修复】先把表单里的改动写回预设，再激活。
    // 否则下面的 loadPresetToForm() 会用旧值把用户刚编辑的内容覆盖掉，
    // 造成"改了模型名却没生效"。
    var fields = readFormAsFields();
    preset.name = fields.name;
    preset.apiKey = fields.apiKey;
    preset.apiUrl = fields.apiUrl;
    preset.modelName = fields.modelName;
    preset.systemPrompt = fields.systemPrompt;
    preset.provider = fields.provider;
    preset.supportsVision = fields.supportsVision;

    data.activePresetId = presetId;
    saveAllPresets(data);

    // 刷新 UI（refreshPresetSelector 会重建 option，必须重新选中）
    refreshPresetSelector();
    document.getElementById("presetSelector").value = presetId;
    loadPresetToForm(presetId);
    updateModelInfoDisplay();
    markPresetFormClean();

    // 没填 Key 的预设是打不通的，明确提醒一句
    if (!preset.apiKey) {
        alert("已保存。但这套预设还没填 API Key —— 填上之后才能开始聊天哦。");
    }
    console.log("✅ 已保存并切换到预设: " + preset.name);
}

/**
 * 快捷预设：点一下就"新建并切换"到对应供应商的预设。
 *
 * 注意这里刻意不做「往当前表单里填字段」——那样很容易误改：
 * 用户以为新建了 DeepSeek 预设，实际上是把当前选中的「豆包默认」改成了 DeepSeek。
 * 所以同名预设已存在就直接切过去，不存在才新建，不会覆盖任何已有配置。
 */
function applyPresetTemplate(key) {
    var tpl = PRESET_TEMPLATES[key];
    if (!tpl) return;

    var data = loadAllPresets();
    var existing = null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].name === tpl.name) {
            existing = data.presets[i];
            break;
        }
    }

    if (existing) {
        refreshPresetSelector();
        document.getElementById("presetSelector").value = existing.id;
        loadPresetToForm(existing.id);
        console.log("📋 已切换到已有预设: " + tpl.name);
        return;
    }

    // 新建：带上模板的地址 / 模型 / 协议，Key 留空等用户自己填
    // （服务器上没有 Key 可以借用，每人都得填自己的）
    var preset = createPresetObject(tpl.name, {
        name: tpl.name,
        apiKey: "",
        apiUrl: tpl.apiUrl,
        modelName: tpl.modelName,
        systemPrompt: tpl.systemPrompt,
        provider: tpl.provider,
        supportsVision: tpl.supportsVision
    });
    data.presets.push(preset);
    saveAllPresets(data);

    refreshPresetSelector();
    document.getElementById("presetSelector").value = preset.id;
    loadPresetToForm(preset.id);
    markPresetFormClean();
    console.log("📋 已新建预设: " + tpl.name);
}

/**
 * 另存为新预设
 */
function saveAsNewPreset() {
    var fields = readFormAsFields();
    if (!fields.name) {
        alert("请输入预设名称");
        return;
    }

    var newPreset = createPresetObject(fields.name, fields);

    var data = loadAllPresets();
    data.presets.push(newPreset);
    saveAllPresets(data);

    // 更新下拉并选中新预设
    refreshPresetSelector();
    document.getElementById("presetSelector").value = newPreset.id;
    loadPresetToForm(newPreset.id);
    console.log("✅ 新预设已保存: " + newPreset.name);
}

/**
 * 更新当前查看的预设
 */
function updateCurrentPreset() {
    if (!currentViewingPresetId) {
        alert("请先选择一个预设再更新");
        return;
    }

    var fields = readFormAsFields();
    if (!fields.name) {
        alert("请输入预设名称");
        return;
    }

    var data = loadAllPresets();
    var updated = false;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === currentViewingPresetId) {
            data.presets[i].name = fields.name;
            data.presets[i].apiKey = fields.apiKey;
            data.presets[i].apiUrl = fields.apiUrl;
            data.presets[i].modelName = fields.modelName;
            data.presets[i].systemPrompt = fields.systemPrompt;
            data.presets[i].provider = fields.provider;
            data.presets[i].supportsVision = fields.supportsVision;
            updated = true;
            break;
        }
    }

    if (updated) {
        saveAllPresets(data);

        refreshPresetSelector();
        document.getElementById("presetSelector").value = currentViewingPresetId; // 重建 option 后需重新选中
        loadPresetToForm(currentViewingPresetId);
        updateModelInfoDisplay();
        markPresetFormClean();
        console.log("✅ 预设已更新");
    }
}

/**
 * 删除当前选中的预设
 */
function deleteCurrentPreset() {
    if (!currentViewingPresetId) {
        alert("请先选择一个预设再删除");
        return;
    }

    var data = loadAllPresets();
    if (data.presets.length <= 1) {
        alert("至少需要保留一个预设，不能删除");
        return;
    }

    var presetName = "";
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === currentViewingPresetId) {
            presetName = data.presets[i].name;
            break;
        }
    }

    if (!confirm("确定要删除预设 \"" + presetName + "\" 吗？此操作不可撤销。")) {
        return;
    }

    // 删除
    var newPresets = data.presets.filter(function (p) {
        return p.id !== currentViewingPresetId;
    });
    data.presets = newPresets;

    // 如果删除的是活跃预设，切换到第一个
    if (data.activePresetId === currentViewingPresetId) {
        data.activePresetId = newPresets[0].id;
    }

    saveAllPresets(data);
    currentViewingPresetId = null;

    refreshPresetSelector();
    // 自动选中新的活跃预设
    if (data.activePresetId) {
        document.getElementById("presetSelector").value = data.activePresetId;
        loadPresetToForm(data.activePresetId);
    } else {
        clearPresetForm();
    }
    updateModelInfoDisplay();
    console.log("✅ 预设已删除");
}

// ============================================================
// 模型配置（BYOK · 自带 Key）
// ------------------------------------------------------------
// 配置存在**浏览器本地**，每次聊天请求时随请求体一起发给后端。
// 后端不保存任何 Key，所以同一个网址给多少人用都不会互相串：
// 每个人用的都是自己填的那把 Key、自己的额度。
// ============================================================

var SERVER_DEFAULTS = null;      // 服务端给的默认地址 / 模型名（不含 Key）

/**
 * 拼出这次请求要带给后端的配置
 */
function buildRequestConfig() {
    var active = getActivePreset();
    if (!active) return {};
    return {
        apiKey: active.apiKey || "",
        apiUrl: active.apiUrl || "",
        modelName: active.modelName || "",
        provider: active.provider || "",
        systemPrompt: active.systemPrompt || "",
        supportsVision: active.supportsVision !== false
    };
}

/** 现在能不能正常聊天（有 Key 也有地址） */
function isConfigured() {
    var active = getActivePreset();
    if (!active) return false;
    return !!(active.apiKey && String(active.apiKey).trim()) &&
           !!(active.apiUrl && String(active.apiUrl).trim());
}

/**
 * 拉服务端的默认值，用于首次配置时预填表单。
 * 服务端只会给地址 / 模型名 / 提示词，**永远不会给 Key**。
 */
function loadServerDefaults() {
    return fetch("/api/server-defaults")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
            if (json && json.defaults) SERVER_DEFAULTS = json.defaults;
        })
        .catch(function () {
            // 拿不到就用本地模板兜底，不影响使用
        });
}

/** 某协议的默认值：优先服务端给的，回退到本地模板 */
function defaultsFor(provider) {
    var key = provider === "ark" ? "ark" : "openai";
    var local = key === "ark" ? PRESET_TEMPLATES.doubao : PRESET_TEMPLATES.deepseek;
    var remote = (SERVER_DEFAULTS && SERVER_DEFAULTS[key]) || {};
    return {
        apiUrl: remote.apiUrl || local.apiUrl,
        modelName: remote.modelName || local.modelName,
        systemPrompt: remote.systemPrompt || local.systemPrompt,
        provider: key,
        supportsVision: remote.supportsVision !== undefined
            ? !!remote.supportsVision
            : local.supportsVision
    };
}

// ============================================================
// 首次配置向导
// ============================================================

/**
 * 没配过 Key 就弹向导。
 * 已经配过的话什么都不做 —— 这就是"下次打开不用重新填"的地方。
 */
function maybeShowSetupWizard() {
    if (isConfigured()) return;
    openSetupWizard();
}

function openSetupWizard() {
    var overlay = document.getElementById("setupOverlay");
    if (!overlay) return;

    var d = defaultsFor("openai");
    var urlEl = document.getElementById("setupApiUrlInput");
    var modelEl = document.getElementById("setupModelNameInput");
    var providerEl = document.getElementById("setupProviderSelect");
    if (urlEl && !urlEl.value) urlEl.value = d.apiUrl;
    if (modelEl && !modelEl.value) modelEl.value = d.modelName;
    if (providerEl && !providerEl.value) providerEl.value = "";

    var keyEl = document.getElementById("setupApiKeyInput");
    if (keyEl) {
        keyEl.value = "";
        setTimeout(function () { keyEl.focus(); }, 60);
    }
    hideSetupError();
    overlay.style.display = "flex";
}

function closeSetupWizard() {
    var overlay = document.getElementById("setupOverlay");
    if (overlay) overlay.style.display = "none";
}

function showSetupError(msg) {
    var el = document.getElementById("setupError");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
}

function hideSetupError() {
    var el = document.getElementById("setupError");
    if (el) el.style.display = "none";
}

/**
 * 向导里点「开始聊天」：把填的内容写进当前活跃预设（没有就新建一个），
 * 然后立即生效。写进 localStorage 之后，下次打开就不用再填了。
 */
function saveSetupAndStart() {
    var apiKey = (document.getElementById("setupApiKeyInput").value || "").trim();
    if (!apiKey) {
        showSetupError("请先粘贴你的 API Key。还没有的话，看上面第 1 步。");
        return;
    }

    var apiUrl = (document.getElementById("setupApiUrlInput").value || "").trim();
    var modelName = (document.getElementById("setupModelNameInput").value || "").trim();
    var provider = document.getElementById("setupProviderSelect").value || "";

    if (!apiUrl || !modelName) {
        showSetupError("API 地址和模型名称不能为空。");
        return;
    }
    if (apiUrl.indexOf("http://") !== 0 && apiUrl.indexOf("https://") !== 0) {
        showSetupError("API 地址需要以 http:// 或 https:// 开头。");
        return;
    }

    // 注意：loadAllPresets() 每次都从 localStorage 重新解析，返回的是**新对象**，
    // 所以必须直接在 data.presets 里找那一份来改，不能改 getActivePreset() 的返回值，
    // 否则改动写不进存储（改的是另一个对象）。
    var data = loadAllPresets();
    var preset = null;
    for (var i = 0; i < data.presets.length; i++) {
        if (data.presets[i].id === data.activePresetId) {
            preset = data.presets[i];
            break;
        }
    }

    if (!preset) {
        preset = createPresetObject("我的模型", {});
        data.presets.push(preset);
    }

    preset.apiKey = apiKey;
    preset.apiUrl = apiUrl;
    preset.modelName = modelName;
    preset.provider = provider;
    if (!preset.name) preset.name = "我的模型";

    data.activePresetId = preset.id;
    saveAllPresets(data);

    closeSetupWizard();
    updateModelInfoDisplay();
    markPresetFormClean();
    console.log("✅ 配置已保存在本机浏览器，可以开始聊天了");
}

/**
 * 清除本机保存的 Key —— 共享电脑上用完、或者想换一个号时用
 */
function clearStoredKey() {
    if (!confirm("确定要清除这台电脑上保存的 API Key 吗？\n清除后需要重新填写才能继续聊天。")) {
        return;
    }
    var data = loadAllPresets();
    data.presets.forEach(function (p) { p.apiKey = ""; });
    saveAllPresets(data);

    updateModelInfoDisplay();
    console.log("🧹 已清除本机保存的 Key");
    openSetupWizard();
}

// ============================================================
// 侧边栏显示更新
// ============================================================

function updateModelInfoDisplay() {
    var active = getActivePreset();
    var modelEl = document.getElementById("modelInfo");
    if (!modelEl) return;

    if (isConfigured()) {
        modelEl.textContent = active.name + " | " + active.modelName;
        modelEl.classList.remove("model-info-warning");
        modelEl.title = "当前使用的模型配置（保存在本机浏览器，不会上传）";
    } else {
        modelEl.textContent = "⚠️ 未配置 API Key · 点下面「设置」";
        modelEl.classList.add("model-info-warning");
        modelEl.title = "还没填写自己的 API Key，点「设置」填一下就能开始聊天";
    }
}

// ============================================================
// 密码显隐切换
// ============================================================

function togglePasswordVisibility() {
    var input = document.getElementById("apiKeyInput");
    var btn = document.getElementById("togglePasswordBtn");
    if (input.type === "password") {
        input.type = "text";
        btn.textContent = "🙈";
    } else {
        input.type = "password";
        btn.textContent = "👁️";
    }
}

// ============================================================
// 事件绑定
// ============================================================

/**
 * 首次配置向导的事件绑定
 */
function bindSetupEvents() {
    var overlay = document.getElementById("setupOverlay");
    if (!overlay) return;

    document.getElementById("setupStartBtn").addEventListener("click", saveSetupAndStart);
    document.getElementById("setupCloseBtn").addEventListener("click", closeSetupWizard);

    // 点遮罩空白处关闭
    overlay.addEventListener("click", function (e) {
        if (e.target === this) closeSetupWizard();
    });

    // Key 输入框里直接回车 = 开始聊天
    var keyEl = document.getElementById("setupApiKeyInput");
    if (keyEl) {
        keyEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                saveSetupAndStart();
            }
        });
    }

    // 切到豆包时，地址和模型名也跟着换（还没填过地址的才换）
    var providerEl = document.getElementById("setupProviderSelect");
    var urlEl = document.getElementById("setupApiUrlInput");
    var modelEl = document.getElementById("setupModelNameInput");
    var tplRow = document.getElementById("setupTemplateRow");
    var lastAuto = { url: urlEl ? urlEl.value : "", model: modelEl ? modelEl.value : "" };

    function applyProvider(p) {
        var d = defaultsFor(p === "ark" ? "ark" : "openai");
        // 只有当前值还是"上一次自动填的"才覆盖，避免冲掉用户手改的内容
        if (urlEl && urlEl.value === lastAuto.url) urlEl.value = d.apiUrl;
        if (modelEl && modelEl.value === lastAuto.model) modelEl.value = d.modelName;
        lastAuto = { url: d.apiUrl, model: d.modelName };
    }

    if (providerEl) {
        providerEl.addEventListener("change", function () {
            applyProvider(this.value);
        });
    }

    if (tplRow) {
        Array.prototype.forEach.call(
            tplRow.querySelectorAll(".setup-template-btn"),
            function (btn) {
                btn.addEventListener("click", function () {
                    var p = this.getAttribute("data-provider") || "openai";
                    if (providerEl) providerEl.value = p === "ark" ? "ark" : "openai";
                    applyProvider(p);
                    var k = document.getElementById("setupApiKeyInput");
                    if (k) k.focus();
                });
            }
        );
    }

    // ESC 关闭
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay.style.display === "flex") {
            closeSetupWizard();
        }
    });
}

function bindSettingsEvents() {
    document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
    document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsModal);
    document.getElementById("settingsOverlay").addEventListener("click", function (e) {
        if (e.target === this) closeSettingsModal();
    });

    // 预设选择器变化
    document.getElementById("presetSelector").addEventListener("change", onPresetSelectorChange);

    // 操作按钮
    document.getElementById("settingsUseBtn").addEventListener("click", activateCurrentPreset);
    document.getElementById("settingsSaveAsBtn").addEventListener("click", saveAsNewPreset);
    document.getElementById("settingsUpdateBtn").addEventListener("click", updateCurrentPreset);
    document.getElementById("settingsDeleteBtn").addEventListener("click", deleteCurrentPreset);

    // 密码显隐
    document.getElementById("togglePasswordBtn").addEventListener("click", togglePasswordVisibility);

    // 清除本机保存的 Key
    var clearKeyBtn = document.getElementById("clearStoredKeyBtn");
    if (clearKeyBtn) clearKeyBtn.addEventListener("click", clearStoredKey);

    // 表单内容一改就提示"未保存"
    ["presetNameInput", "apiKeyInput", "apiUrlInput", "modelNameInput", "systemPromptInput"]
        .forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener("input", updatePresetDirtyState);
        });

    // 协议下拉 + 多模态开关
    ["providerSelect", "supportsVisionInput"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener("change", updatePresetDirtyState);
    });

    // 一键填充模板
    Array.prototype.forEach.call(
        document.querySelectorAll(".preset-template-btn"),
        function (btn) {
            btn.addEventListener("click", function () {
                applyPresetTemplate(this.getAttribute("data-template"));
            });
        }
    );

    // ESC 关闭
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && document.getElementById("settingsOverlay").style.display === "flex") {
            closeSettingsModal();
        }
    });
}

// ============================================================
// 启动应用
// ============================================================
document.addEventListener("DOMContentLoaded", init);
