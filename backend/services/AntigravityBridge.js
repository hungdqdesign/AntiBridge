/**
 * AntigravityBridge - Kết nối CDP với Antigravity
 * Inject messages và lắng nghe responses
 */

const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const path = require('path');
const ChatLogger = require('./ChatLogger');
const messageLogger = require('./MessageLogger');

class AntigravityBridge {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.browser = null;
        this.page = null;
        this.isConnected = false;
        this.debugUrl = 'http://127.0.0.1:9000';

        // Selectors cho Antigravity UI (cần điều chỉnh theo thực tế)
        this.selectors = {
            chatInput: 'textarea[placeholder*="message"], textarea[data-testid="chat-input"], .chat-input textarea',
            sendButton: 'button[type="submit"], button[aria-label*="send"], .send-button',
            messageContainer: '.messages-container, .chat-messages, [data-testid="messages"]',
            lastMessage: '.message:last-child, .chat-message:last-child'
        };

        // Chat extraction state
        this.lastMessages = [];
        this.lastMessageHashes = new Set();
        this.chatPollInterval = null;

        // Chat logger
        this.chatLogger = new ChatLogger();

        // Streaming detection - STABLE THRESHOLD (chờ content ổn định trước khi emit complete)
        this.streamBuffer = '';           // Buffer for streaming AI text
        this.isStreaming = false;          // Flag: AI is currently streaming
        this.lastTotalContent = 0;         // Total content length from last poll
        this.stableCount = 0;             // Số poll cycles mà content không đổi
        this.STREAM_STABLE_THRESHOLD = 6; // Chờ 6 cycles ổn định (6 × 2s = 12 giây)



        // ========== NOISE PATTERNS: Loại bỏ tên model và UI elements ==========
        this.NOISE_PATTERNS = [
            // Model names (GPT-OSS có 2 chữ S!)
            /^GPT-?OS{1,2}\s+\d+\w*\s*\([^)]+\)\s*$/i,     // GPT-OS / GPT-OSS 120B (Medium)
            /^Claude\s+\d+(\.\d+)?\s*\w*\s*(\([^)]+\))?\s*$/i,  // Claude 3.5 Sonnet (Thinking)
            /^Gemini\s+\d+(\.\d+)?\s*\w*\s*(\([^)]+\))?\s*$/i,  // Gemini 2.0 Flash (High)
            /^Llama\s+\d+(\.\d+)?\s*\w*\s*$/i,            // Llama 3.1 70B
            /^GPT-?4[ov]?\s*(-turbo|-mini)?\s*$/i,        // GPT-4, GPT-4o, GPT-4-turbo
            /^o[123]-?(mini|preview)?\s*$/i,              // o1-mini, o3-preview
            /^Anthropic\s+/i,
            /^Mistral\s+/i,
            /^DeepSeek\s+/i,
            /Claude Opus/i,     // Claude Opus 4.5 (Thinking)
            /Claude Sonnet/i,   // Claude Sonnet 4.5
            /Gemini \d+ Pro/i,  // Gemini 3 Pro (High/Low)

            // UI Labels từ Antigravity (từ log file)
            /^AI may make mistakes/i,
            /^Double-check all generated code/i,
            /^Agent will execute tasks directly/i,
            /^Agent can plan before executing/i,
            /^Use for (simple|deep|complex)/i,
            /^Conversation mode$/i,
            /^Ask anything/i,
            /^Ctrl\+[A-Z]/i,           // Keyboard shortcuts
            /^@ to mention/i,
            /^\/ for workflows$/i,

            // ========== NEW: Model selector dropdown ==========
            /Add\s*context/i,
            /^Images$/i,
            /^Mentions$/i,
            /^Workflows$/i,
            /^Planning$/i,
            /^Fast$/i,
            /^Model$/i,
            /^New$/i,
            /^Claude.*\(Thinking\)\s*$/i,     // EXACT: "Claude Opus 4.5 (Thinking)"
            /^Claude Sonnet[\s\d.]*$/i,        // EXACT: "Claude Sonnet 4.5" (chỉ tên model đứng một mình)
            /^Claude Opus[\s\d.]*$/i,          // EXACT: "Claude Opus 4.5"
            /^Gemini\s*\d+[\s\w()]*$/i,        // EXACT: "Gemini 3 Pro (High)"
            /^GPT-OSS[\s\d\w()]*$/i,           // EXACT: "GPT-OSS 120B (Medium)"
            /^\s*\(High\)\s*$|^\s*\(Low\)\s*$|^\s*\(Medium\)\s*$/i,   // EXACT: quality labels alone
            /Nhập lệnh cho AI agent/i,         // Vietnamese placeholder

            // Conversation titles (từ sidebar)
            /^Synchronize Server/i,
            /^Implementing Chat/i,
            /^Debug Antigravity/i,
            /^Fixing (Chat|Noise|Mobile)/i,
            /^Testing (Mobile|Remote|Server)/i,

            // File paths (Windows & Unix)
            /^[a-zA-Z]:\\[^<>:"|?*]+$/,                   // d:\01_BUILD_APP\...
            /^\/[^<>:"|?*]+$/,                            // /home/user/...

            // Folder/path segments (từ screenshot user)
            /^\.agent\\?$/i,                              // .agent or .agent\
            /^\\+$/,                                      // \ or \\ alone
            /^workflows?$/i,                              // workflows or workflow
            /^scripts?$/i,                                // scripts or script
            /^backend$/i,                                 // backend
            /^frontend$/i,                                // frontend
            /^node_modules$/i,                            // node_modules
            /^[a-zA-Z0-9_-]+\\$/,                         // any\folder\ending\with\backslash

            // UI elements (short texts)
            /^(Accept|Reject|Cancel|Submit|Send|Gửi|Hủy|Copy|Edit|Delete)$/i,
            /^(Yes|No|OK|Done|Close|Đóng|Xác nhận)$/i,
            /^\d+\s*(tokens?|words?|chars?)\s*$/i,       // "123 tokens"
            /^Model:?\s*$/i,
            /^Response:?\s*$/i,
            /^Thinking\.{0,3}$/i,       // "Thinking..."
            /^Loading\.{0,3}$/i,        // "Loading..."
            /^Generating\.{0,3}$/i,     // "Generating..."
            /^Thinking for \d+s$/i,     // "Thinking for 11s"
            /^Progress Updates$/i,
            /^Show items analyzed$/i,
            /^\d+ Files With Changes$/i,
            /^Error while editing$/i,
            /^Auto-proceeded by/i,
        ];

        // Minimum content length for valid AI response (giảm xuống 20 để không bỏ lỡ messages)
        this.MIN_RESPONSE_LENGTH = 20;

    }

    /**
     * Gửi phím Enter thông qua CDP Input (Mạnh mẽ hơn JS event)
     */
    async simulateEnterKey() {
        if (!this.page) return false;
        try {
            console.log('⌨️ CDP: Sending Enter Key...');
            await this.page.keyboard.press('Enter');
            return true;
        } catch (e) {
            console.error('❌ CDP Enter Key Error:', e.message);
            return false;
        }
    }

    /**
     * Click vào toạ độ (x, y) thông qua CDP Input
     */
    async simulateClick(x, y) {
        if (!this.page) return false;
        try {
            console.log(`🖱️ CDP: Clicking at (${x}, ${y})...`);
            await this.page.mouse.click(x, y);
            return true;
        } catch (e) {
            console.error('❌ CDP Click Error:', e.message);
            return false;
        }
    }

    /**
     * Inject text trực tiếp vào ô chat thông qua CDP Frames API
     * Điều này bypass cross-origin restrictions mà chat_bridge_ws.js gặp phải
     * @param {string} text - Text cần inject vào ô chat
     * @returns {boolean} - true nếu inject thành công
     */
    async injectTextToChat(text) {
        if (!this.page) return false;

        try {
            console.log(`📝 CDP: Injecting text to chat: "${text.substring(0, 50)}..."`);

            // Tìm tất cả frames (bao gồm cross-origin)
            const frames = this.page.frames();

            for (const frame of frames) {
                const frameUrl = frame.url();

                // Skip empty, about:blank, devtools
                if (!frameUrl || frameUrl === 'about:blank' || frameUrl.includes('devtools')) {
                    continue;
                }

                // Chỉ quan tâm frame extension (chứa chat)
                if (!frameUrl.includes('extension')) {
                    continue;
                }

                try {
                    // ========== FIX V4: Puppeteer click + Clipboard paste ==========
                    // Approach: Click input → Clear → Clipboard paste → Enter
                    // Đây là cách đáng tin cậy nhất vì:
                    // 1. Puppeteer click đảm bảo focus đúng chỗ
                    // 2. Clipboard giữ nguyên newlines
                    // 3. Paste không trigger Enter sớm

                    // Tìm input element trong frame
                    const inputSelector = await frame.$('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]');

                    if (!inputSelector) {
                        continue;
                    }

                    console.log(`✅ CDP: Found input in frame: ${frameUrl.substring(0, 50)}...`);

                    // 1. Click vào input để focus (triple click để select all)
                    await inputSelector.click({ clickCount: 3 });
                    await new Promise(r => setTimeout(r, 100));
                    console.log(`✅ CDP: Clicked input (triple click)`);

                    // 2. Xóa nội dung cũ (nếu có)
                    await this.page.keyboard.press('Backspace');
                    await new Promise(r => setTimeout(r, 50));

                    // 3. Đặt text vào clipboard qua hệ thống
                    const { exec } = require('child_process');
                    const isWin = process.platform === 'win32';
                    const copyCmd = isWin ? 'clip' : 'pbcopy';

                    await new Promise((resolve, reject) => {
                        const copyProcess = exec(copyCmd, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                        copyProcess.stdin.write(text);
                        copyProcess.stdin.end();
                    });
                    console.log(`✅ CDP: Text copied to clipboard (${text.length} chars)`);

                    // 4. Paste từ clipboard (Ctrl+V or Meta+V)
                    const modifier = isWin ? 'Control' : 'Meta';
                    await this.page.keyboard.down(modifier);
                    await this.page.keyboard.press('v');
                    await this.page.keyboard.up(modifier);
                    await new Promise(r => setTimeout(r, 200));
                    console.log(`✅ CDP: Pasted from clipboard`);

                    // 5. Nhấn Enter để gửi
                    await this.page.keyboard.press('Enter');
                    console.log(`✅ CDP: Enter key sent`);

                    return { injected: true, submitted: true };

                } catch (frameErr) {
                    // Frame evaluation failed, try next
                    console.log(`⚠️ CDP: Frame error: ${frameErr.message}`);
                }
            }

            console.log('⚠️ CDP: No input found in any frame');
            return false;
        } catch (e) {
            console.error('❌ CDP Inject Text Error:', e.message);
            return false;
        }
    }

    async connect(retryCount = 3) {
        if (this.isConnected) return true;

        for (let attempt = 1; attempt <= retryCount; attempt++) {
            console.log(`🔌 AntigravityBridge: Đang kết nối tới ${this.debugUrl}... (lần ${attempt}/${retryCount})`);

            try {
                // Thử lấy WebSocket endpoint trước
                let wsEndpoint = null;

                try {
                    const versionRes = await fetch(`${this.debugUrl}/json/version`);
                    const versionData = await versionRes.json();
                    wsEndpoint = versionData.webSocketDebuggerUrl;
                    console.log(`📡 WebSocket endpoint: ${wsEndpoint}`);
                } catch (e) {
                    // Thử lấy từ /json
                    try {
                        const jsonRes = await fetch(`${this.debugUrl}/json`);
                        const jsonData = await jsonRes.json();
                        if (jsonData.length > 0) {
                            // Ưu tiên page có title Antigravity
                            const targetPage = jsonData.find(p => p.title.includes('Antigravity')) || jsonData[0];
                            wsEndpoint = targetPage.webSocketDebuggerUrl;
                        }
                    } catch (e2) {
                        console.log('⚠️ Không fetch được endpoint');
                    }
                }

                if (wsEndpoint) {
                    this.browser = await puppeteer.connect({
                        browserWSEndpoint: wsEndpoint,
                        defaultViewport: null // FIX: Giữ nguyên kích thước cửa sổ
                    });
                } else {
                    this.browser = await puppeteer.connect({
                        browserURL: this.debugUrl,
                        defaultViewport: null // FIX: Giữ nguyên kích thước cửa sổ
                    });
                }

                console.log('✅ AntigravityBridge: Đã kết nối Puppeteer!');

                // Tìm trang Antigravity
                const pages = await this.browser.pages();
                console.log(`📄 Tìm thấy ${pages.length} pages`);

                // Tìm page có chứa chat UI - ƯU TIÊN page workbench chính
                let candidatePages = [];
                for (const page of pages) {
                    const title = await page.title().catch(() => '');
                    const url = page.url();
                    console.log(`   - "${title}" : ${url}`);

                    // Skip blank và devtools
                    if (url.includes('about:blank') || url.includes('devtools')) continue;

                    candidatePages.push({ page, title, url });
                }

                // Ưu tiên 1: Page có title chứa "Antigravity" (main workbench)
                // Ưu tiên 2: Page có url chứa "workbench.html"
                // Ưu tiên 3: KHÔNG chọn page có title "Launchpad"
                let selectedPage = candidatePages.find(p =>
                    p.title.includes('Antigravity') && !p.title.includes('Launchpad')
                );
                if (!selectedPage) {
                    selectedPage = candidatePages.find(p => p.url.includes('workbench.html'));
                }
                if (!selectedPage) {
                    selectedPage = candidatePages.find(p => p.title !== 'Launchpad');
                }
                if (!selectedPage && candidatePages.length > 0) {
                    selectedPage = candidatePages[0];
                }

                if (selectedPage) {
                    this.page = selectedPage.page;
                    console.log(`✅ Đã chọn page: "${selectedPage.title}"`);
                } else if (pages.length > 0) {
                    this.page = pages[0];
                }

                if (this.page) {
                    this.isConnected = true;
                    console.log('✅ AntigravityBridge: Đã chọn page chính');

                    // Theo dõi DOM changes
                    await this.setupDOMObserver();

                    // 🚀 AUTO-INJECT chat_bridge_ws.js
                    await this.injectChatBridge();

                    return true;
                } else {
                    throw new Error('Không tìm thấy page phù hợp');
                }

            } catch (err) {
                console.error(`❌ AntigravityBridge: Lỗi kết nối (lần ${attempt}):`, err.message);
                this.isConnected = false;

                if (attempt < retryCount) {
                    console.log(`⏳ Đợi 2 giây rồi thử lại...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        return false;
    }

    async setupDOMObserver() {
        if (!this.page) return;

        // ========== DISABLED: Dùng startChatPolling() thay thế ==========
        // DOM Observer gây spam logs vì quá sensitive với focus/blur events
        // Chat polling với continuous streaming đã đủ để extract messages
        console.log('ℹ️ DOM Observer disabled - using startChatPolling() instead');
        return;

        /* LEGACY CODE - Kept for reference
        try {
            // 1. Expose function để browser context gọi về Node.js
            // QUAN TRỌNG: Phải capture 'this' vì exposeFunction không giữ context
            const self = this;
            const MIN_LEN = this.MIN_RESPONSE_LENGTH;
            const PATTERNS = this.NOISE_PATTERNS;

            await this.page.exposeFunction('onNewMessage', (content, role = 'assistant') => {
                // ... noise filter logic ...
            });

            // 2. Inject script để theo dõi DOM changes
            await this.page.evaluate((selectors) => {
                // ... observer logic ...
            }, this.selectors);

            console.log('✅ DOM Observer đã được thiết lập');
        } catch (err) {
            console.log('⚠️ DOM Observer error:', err.message);
        }
        */
    }

    /**
     * 🚀 AUTO-INJECT chat_bridge_ws.js vào Antigravity
     * Giúp user không cần paste script thủ công mỗi lần mở app
     */
    async injectChatBridge() {
        if (!this.page) return false;

        try {
            const fs = require('fs');
            const scriptPath = path.resolve(__dirname, '../../scripts/chat_bridge_ws.js');

            // Check if script file exists
            if (!fs.existsSync(scriptPath)) {
                console.log(`⚠️ Chat bridge script not found: ${scriptPath}`);
                return false;
            }

            // Read script content
            const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
            console.log(`📜 Loaded chat_bridge_ws.js (${scriptContent.length} bytes)`);

            // Check if already injected (avoid duplicate)
            const alreadyInjected = await this.page.evaluate(() => {
                return typeof window.chatBridge !== 'undefined';
            });

            if (alreadyInjected) {
                console.log('ℹ️ Chat bridge already injected, skipping');
                return true;
            }

            // Inject script vào page context
            await this.page.evaluate((code) => {
                try {
                    eval(code);
                } catch (e) {
                    console.error('❌ Chat bridge inject error:', e.message);
                }
            }, scriptContent);

            // Verify injection
            const verified = await this.page.evaluate(() => {
                return typeof window.chatBridge !== 'undefined';
            });

            if (verified) {
                console.log('✅ Chat bridge AUTO-INJECTED successfully!');
                return true;
            } else {
                console.log('⚠️ Chat bridge injection verification failed');
                return false;
            }

        } catch (err) {
            console.error('❌ injectChatBridge error:', err.message);
            return false;
        }
    }


    /**
     * Lấy toàn bộ log chat hiện tại
     */
    async getChatLog() {
        if (!this.page) return null;
        try {
            return await this.page.evaluate((selectors) => {
                const container = document.querySelector(selectors.messageContainer);
                if (!container) return 'Message container not found';
                return container.innerText;
            }, this.selectors);
        } catch (err) {
            return `Error: ${err.message}`;
        }
    }

    /**
     * Lấy response cuối cùng từ AI
     */
    async getLastResponse() {
        if (!this.isConnected) {
            const connected = await this.connect();
            if (!connected) return null;
        }

        try {
            return await this.page.evaluate((selectors) => {
                // Thử tìm message container
                const container = document.querySelector(selectors.messageContainer);
                if (!container) return null;

                // Lấy tất cả messages
                // Giả định cấu trúc chat standard: container -> children nodes
                const children = Array.from(container.children);
                if (children.length === 0) return null;

                // Lấy message cuối cùng
                const lastNode = children[children.length - 1];
                return lastNode.innerText || lastNode.textContent;
            }, this.selectors);
        } catch (err) {
            console.error('Error getting last response:', err);
            return null;
        }
    }

    /**
     * Dump HTML để debug selector
     */
    async dumpPageSource() {
        if (!this.page) return 'No page connected';
        try {
            return await this.page.content();
        } catch (err) {
            return `Error dumping source: ${err.message}`;
        }
    }

    /**
     * Extract chat content từ iframe (V3 - CDP FRAMES)
     * V3: Sử dụng Puppeteer frames() API để bypass cross-origin restrictions
     * Thay vì đọc contentDocument từ parent page, ta trực tiếp evaluate trong iframe context
     */
    async extractChatFromIframe() {
        if (!this.page) return [];

        try {
            // ========== V4: Ưu tiên frame extension (chứa chat) ==========
            const frames = this.page.frames();
            const results = [];

            for (const frame of frames) {
                const frameUrl = frame.url();

                // Skip empty, about:blank, and devtools frames
                if (!frameUrl ||
                    frameUrl === 'about:blank' ||
                    frameUrl.includes('devtools') ||
                    frameUrl.includes('chrome-extension://')) {
                    continue;
                }

                // ===== CHỈ QUAN TÂM FRAME EXTENSION (chứa chat) =====
                if (!frameUrl.includes('extension')) {
                    continue;
                }

                try {
                    // Evaluate trực tiếp trong frame context
                    const frameMessages = await frame.evaluate(() => {
                        const msgs = [];

                        // Helper functions
                        function getClassName(el) {
                            if (!el.className) return '';
                            if (typeof el.className === 'string') return el.className;
                            if (el.className.baseVal !== undefined) return el.className.baseVal;
                            return '';
                        }

                        function getCleanText(el) {
                            const clone = el.cloneNode(true);
                            clone.querySelectorAll('pre, code, script, style, noscript').forEach(n => n.remove());
                            return clone.innerText ? clone.innerText.trim() : '';
                        }

                        // NEW: Get HTML content (preserves tables, code blocks, formatting)
                        function getHtmlContent(el) {
                            const clone = el.cloneNode(true);
                            clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
                            return clone.innerHTML ? clone.innerHTML.trim() : '';
                        }

                        // ===== STRATEGY 1: Tìm message containers (selectors) =====
                        const messageSelectors = [
                            '[class*="message"]',
                            '[class*="Message"]',
                            '[class*="response"]',
                            '[class*="Response"]',
                            '[class*="assistant"]',
                            '[class*="user"]',
                            '[class*="chat-item"]',
                            '[class*="bubble"]',
                            '[data-role]',
                            '[data-message-role]',
                            // Antigravity specific selectors
                            '[class*="turn-"]',
                            '[class*="conversation"]',
                            // NEW: Thêm selectors phổ biến khác
                            '[class*="content"]',
                            '[class*="text"]',
                            '[class*="paragraph"]',
                            'article',
                            '.prose'
                        ];

                        const seenTexts = new Set();

                        for (const selector of messageSelectors) {
                            try {
                                document.querySelectorAll(selector).forEach(container => {
                                    const className = getClassName(container);
                                    const classLower = className.toLowerCase();

                                    // Skip code editor, UI elements
                                    if (classLower.includes('cm-') || classLower.includes('monaco')) return;
                                    if (classLower.includes('hljs') || classLower.includes('prism')) return;
                                    if (classLower.includes('input') || classLower.includes('textarea')) return;
                                    if (classLower.includes('dropdown') || classLower.includes('menu')) return;
                                    if (classLower.includes('modal') || classLower.includes('tooltip')) return;
                                    if (classLower.includes('sidebar') || classLower.includes('toolbar')) return;
                                    if (classLower.includes('header') || classLower.includes('footer')) return;
                                    if (classLower.includes('empty-pane')) return; // Skip empty pane messages

                                    const text = getCleanText(container);
                                    if (!text || text.length < 30) return;

                                    // Skip UI noise patterns
                                    if (/^(File|Edit|Selection|View|Go|Run|Terminal|Help)\s*$/i.test(text)) return;
                                    if (/^Drag a view here/i.test(text)) return;
                                    if (/^Press desired key/i.test(text)) return;

                                    // Skip model name noise
                                    const modelKeywords = ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Pro', 'Flash'];
                                    let modelCount = 0;
                                    for (const kw of modelKeywords) {
                                        if (text.includes(kw)) modelCount++;
                                    }
                                    if (modelCount >= 3) return;

                                    // Dedupe
                                    const textKey = text.substring(0, 100) + text.length;
                                    if (seenTexts.has(textKey)) return;
                                    seenTexts.add(textKey);

                                    // Detect role
                                    let role = 'unknown';
                                    if (classLower.includes('user') || classLower.includes('human')) {
                                        role = 'user';
                                    } else if (classLower.includes('assistant') || classLower.includes('ai') ||
                                        classLower.includes('response') || classLower.includes('bot')) {
                                        role = 'assistant';
                                    }

                                    msgs.push({
                                        text: text,
                                        html: getHtmlContent(container), // NEW: Include HTML for tables
                                        class: className,
                                        role: role,
                                        method: 'cdp-selector'
                                    });
                                });
                            } catch (e) {
                                // Selector error, skip
                            }
                        }

                        // ===== STRATEGY 2: Fallback - Lấy raw text từ body nếu không tìm được =====
                        if (msgs.length === 0) {
                            const bodyText = document.body?.innerText || '';
                            if (bodyText.length > 100) {
                                // Tách text thành các đoạn bằng newlines
                                const paragraphs = bodyText.split(/\n{2,}/).filter(p => p.trim().length > 30);

                                // Chỉ lấy các đoạn có vẻ là AI response (không phải UI)
                                for (const para of paragraphs) {
                                    const trimmed = para.trim();

                                    // Skip UI patterns
                                    if (/^(File|Edit|Selection|View|Go|Run|Terminal|Help|Open|Close|Save)/i.test(trimmed)) continue;
                                    if (/^Drag a view|^Press desired|^Keyboard Shortcuts/i.test(trimmed)) continue;
                                    if (trimmed.length < 50) continue;

                                    // Skip if already seen
                                    const textKey = trimmed.substring(0, 100) + trimmed.length;
                                    if (seenTexts.has(textKey)) continue;
                                    seenTexts.add(textKey);

                                    msgs.push({
                                        text: trimmed,
                                        class: 'raw-body',
                                        role: 'assistant',
                                        method: 'cdp-raw'
                                    });
                                }
                            }
                        }

                        return msgs;
                    });

                    if (frameMessages && frameMessages.length > 0) {
                        console.log(`✅ CDP Extracted ${frameMessages.length} messages from extension frame`);
                        results.push(...frameMessages);
                    }

                } catch (frameErr) {
                    // Frame evaluation failed, likely detached or cross-origin issue
                }
            }

            // Fallback: Nếu không tìm được từ extension frame, thử main page
            if (results.length === 0) {
                return await this.extractChatFromMainPage();
            }

            return results;

        } catch (err) {
            return [];
        }
    }

    /**
     * Fallback: Extract từ main page nếu không tìm được iframe
     */
    async extractChatFromMainPage() {
        try {
            const script = `
            (function() {
                const results = [];
                const iframes = document.querySelectorAll('iframe');
                
                // Helper để xử lý SVGAnimatedString
                function getClassName(el) {
                    if (!el.className) return '';
                    if (typeof el.className === 'string') return el.className;
                    if (el.className.baseVal !== undefined) return el.className.baseVal;
                    return '';
                }
                
                // Helper: lấy full text từ element (skip code blocks)
                function getCleanText(el) {
                    // Clone element để không modify DOM gốc
                    const clone = el.cloneNode(true);
                    
                    // Remove code blocks, scripts, styles
                    clone.querySelectorAll('pre, code, script, style, noscript').forEach(n => n.remove());
                    
                    // Lấy innerText (giữ line breaks)
                    return clone.innerText.trim();
                }
                
                iframes.forEach((iframe, idx) => {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!doc || !doc.body) return;
                        
                        // ===== PHƯƠNG ÁN 1: Tìm MESSAGE CONTAINERS =====
                        // Các selector phổ biến cho chat messages
                        const messageSelectors = [
                            '[class*="message"]',
                            '[class*="Message"]',
                            '[class*="response"]',
                            '[class*="Response"]',
                            '[class*="assistant"]',
                            '[class*="user"]',
                            '[class*="chat-item"]',
                            '[data-role]',
                            '[data-message-role]'
                        ];
                        
                        const seenTexts = new Set(); // Tránh duplicate
                        
                        for (const selector of messageSelectors) {
                            try {
                                const containers = doc.querySelectorAll(selector);
                                containers.forEach(container => {
                                    const className = getClassName(container);
                                    const classLower = className.toLowerCase();
                                    
                                    // Skip containers quá nhỏ hoặc là code editor
                                    if (classLower.includes('cm-') || classLower.includes('monaco')) return;
                                    if (classLower.includes('hljs') || classLower.includes('prism')) return;
                                    if (classLower.includes('input') || classLower.includes('textarea')) return;
                                    
                                    // ========== NEW: Skip UI containers (không phải chat) ==========
                                    const uiPatterns = ['dropdown', 'picker', 'menu', 'modal', 'dialog', 
                                                       'popover', 'tooltip', 'select', 'command-palette',
                                                       'settings', 'sidebar', 'toolbar', 'navigation'];
                                    for (const ui of uiPatterns) {
                                        if (classLower.includes(ui)) return;
                                    }
                                    
                                    const text = getCleanText(container);
                                    if (text.length < 20) return; // Skip quá ngắn
                                    
                                    // ========== NEW: Skip if text contains too many model names ==========
                                    const modelKeywords = ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Pro', 'Flash', 'Thinking'];
                                    let modelCount = 0;
                                    for (const kw of modelKeywords) {
                                        if (text.includes(kw)) modelCount++;
                                    }
                                    if (modelCount >= 3) return; // Likely UI dropdown content
                                    
                                    // ========== NEW: Skip UI text patterns ==========
                                    if (/Ask anything|@ to mention|\/ for workflows|Add context/i.test(text)) return;
                                    if (/Conversation mode|Planning|Fast|Model/i.test(text) && text.length < 200) return;
                                    
                                    // Tránh duplicate (bằng cách hash text ngắn)
                                    const textKey = text.substring(0, 100) + text.length;
                                    if (seenTexts.has(textKey)) return;
                                    seenTexts.add(textKey);
                                    
                                    // Detect role
                                    let role = 'unknown';
                                    const dataRole = container.getAttribute('data-role') || 
                                                     container.getAttribute('data-message-role') || '';
                                    
                                    if (dataRole) {
                                        role = dataRole.toLowerCase().includes('user') ? 'user' : 'assistant';
                                    } else if (classLower.includes('user') || classLower.includes('human')) {
                                        role = 'user';
                                    } else if (classLower.includes('assistant') || classLower.includes('ai') || 
                                               classLower.includes('response') || classLower.includes('bot')) {
                                        role = 'assistant';
                                    }
                                    
                                    results.push({
                                        text: text,
                                        class: className,
                                        tag: container.tagName,
                                        role: role,
                                        iframeIdx: idx,
                                        method: 'container'
                                    });
                                });
                            } catch (e) {
                                // Selector không hợp lệ, skip
                            }
                        }
                        
                        // ===== PHƯƠNG ÁN 2: Fallback về TreeWalker nếu không tìm được containers =====
                        if (results.length === 0) {
                            const walker = doc.createTreeWalker(
                                doc.body,
                                NodeFilter.SHOW_TEXT,
                                null,
                                false
                            );
                            
                            let node;
                            while (node = walker.nextNode()) {
                                const text = node.textContent.trim();
                                if (text.length > 30) {
                                    const parent = node.parentElement;
                                    if (!parent) continue;
                                    
                                    const className = getClassName(parent);
                                    const tag = parent.tagName;
                                    
                                    // Filter noise
                                    if (className.includes('cm-') || className.includes('monaco')) continue;
                                    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
                                    
                                    results.push({
                                        text: text,
                                        class: className,
                                        tag: tag,
                                        role: 'unknown',
                                        iframeIdx: idx,
                                        method: 'walker'
                                    });
                                }
                            }
                        }
                        
                    } catch (e) {
                        // Cross-origin iframe, skip
                    }
                });
                
                return results;
            })();
            `;

            const result = await this.page.evaluate(script);
            return result || [];
        } catch (err) {
            // Suppress error to reduce log spam
            // console.error('❌ extractChatFromIframe error:', err.message);
            return [];
        }
    }

    /**
     * Kiểm tra text có phải noise (model name, UI elements) không
     * Kiểm tra text có phải noise (model name, UI elements) không
     */
    isNoiseText(text) {
        // ========== FILTER ENABLED ==========
        if (!text || text.length < this.MIN_RESPONSE_LENGTH) return true;

        const trimmed = text.trim();

        // Check từng pattern
        for (const pattern of this.NOISE_PATTERNS) {
            if (pattern.test(trimmed)) {
                // Suppress logging to reduce spam
                // console.log(`🚫 Filtered noise: "${trimmed.substring(0, 50)}"`);
                return true;
            }
        }

        // Thêm check: Nếu text chứa quá nhiều model names liên tiếp → noise
        const modelKeywords = ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Pro', 'Flash'];
        let keywordCount = 0;
        for (const kw of modelKeywords) {
            if (trimmed.includes(kw)) keywordCount++;
        }
        if (keywordCount >= 3) {
            // console.log(`🚫 Filtered multi-model noise: "${trimmed.substring(0, 80)}"`);
            return true;
        }

        return false;
    }

    /**
     * Tạo hash đơn giản cho message để detect duplicates
     */
    hashMessage(msg) {
        const str = `${msg.text}_${msg.role}_${msg.iframeIdx}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }


    /**
     * Bắt đầu polling chat từ iframe và stream qua WebSocket
     * STABLE THRESHOLD: Emit chat_update khi streaming, chat_complete khi ổn định
     * @param {string} sessionId - Session ID để emit events
     * @param {number} intervalMs - Polling interval (default 2000ms)
     */
    startChatPolling(sessionId, intervalMs = 2000) {
        if (this.chatPollInterval) {
            console.log('⚠️ Chat polling đã đang chạy');
            return;
        }

        console.log(`🔄 Bắt đầu chat polling cho session ${sessionId} (${intervalMs}ms interval, threshold=${this.STREAM_STABLE_THRESHOLD})`);

        // Reset state
        this.stableCount = 0;
        this.streamBuffer = '';
        this.isStreaming = false;

        this.chatPollInterval = setInterval(async () => {
            try {
                const messages = await this.extractChatFromIframe();

                // Detect new messages bằng hash
                const newMessages = messages.filter(msg => {
                    const hash = this.hashMessage(msg);
                    if (this.lastMessageHashes.has(hash)) {
                        return false;
                    }
                    this.lastMessageHashes.add(hash);
                    return true;
                });

                // ========== FILTER NOISE ==========
                // DEBUG: Log số lượng messages trước khi filter
                if (newMessages.length > 0) {
                    console.log(`📊 DEBUG: ${newMessages.length} new messages extracted`);
                    newMessages.forEach((m, i) => {
                        console.log(`   [${i}] role=${m.role}, len=${m.text.length}, text="${m.text.substring(0, 80)}..."`);
                    });
                }

                const filteredMessages = newMessages.filter(m => !this.isNoiseText(m.text));

                // DEBUG: Log sau khi filter
                if (newMessages.length > 0 && filteredMessages.length === 0) {
                    console.log(`⚠️ DEBUG: ALL messages filtered! Check noise patterns.`);
                }

                // ========== STABLE THRESHOLD LOGIC ==========
                const currentContent = filteredMessages.map(m => m.text).join('\n');
                const totalContent = this.streamBuffer + currentContent;

                if (filteredMessages.length > 0) {
                    // Có tin mới → reset stable count, update buffer
                    this.stableCount = 0;
                    this.streamBuffer = totalContent;
                    this.isStreaming = true;

                    // Emit chat_update (partial)
                    if (this.eventBus) {
                        console.log(`📨 Update: ${filteredMessages.length} tin mới (stable: ${this.stableCount}/${this.STREAM_STABLE_THRESHOLD})`);

                        // FIX: Broadcast to ALL sessions instead of just current sessionId
                        this.eventBus.broadcast('chat_update', {
                            messages: filteredMessages,
                            partial: true,
                            timestamp: new Date().toISOString(),
                            source_session: sessionId // Optional: track origin
                        });
                    }
                } else if (this.isStreaming) {
                    // Không có tin mới nhưng đang streaming → tăng stable count
                    this.stableCount++;
                    // Suppress stable check logging
                    // console.log(`⏳ Stable check: ${this.stableCount}/${this.STREAM_STABLE_THRESHOLD}`);

                    // Đủ threshold → emit chat_complete
                    if (this.stableCount >= this.STREAM_STABLE_THRESHOLD) {
                        console.log(`✅ Content ổn định! Emit chat_complete`);

                        if (this.eventBus && this.streamBuffer.length > 0) {
                            // Get HTML from last extracted message (nếu có)
                            const lastMsg = this.lastMessages[this.lastMessages.length - 1];
                            const htmlContent = lastMsg?.html || '';

                            // FIX: Broadcast to ALL sessions
                            this.eventBus.broadcast('chat_complete', {
                                content: this.streamBuffer,
                                html: htmlContent, // NEW: Forward HTML for tables
                                timestamp: new Date().toISOString(),
                                source_session: sessionId
                            });

                            // Log final message
                            this.chatLogger.logMessage('assistant', this.streamBuffer, { type: 'complete', htmlLen: htmlContent.length });

                            // SAVE TO HISTORY for mobile app
                            messageLogger.saveHistory('assistant', this.streamBuffer, htmlContent);

                            console.log(`📤 chat_complete sent to ALL: textLen=${this.streamBuffer.length}, htmlLen=${htmlContent.length}`);
                        }

                        // Reset state
                        this.isStreaming = false;
                        this.streamBuffer = '';
                        this.stableCount = 0;
                    }
                }

                this.lastMessages = filteredMessages.length > 0 ? filteredMessages : this.lastMessages;

            } catch (err) {
                console.error('❌ Chat polling error:', err.message);

                // ========== AUTO RECONNECT CDP ==========
                // Nếu lỗi liên quan đến connection, thử reconnect
                if (err.message.includes('Session closed') ||
                    err.message.includes('Protocol error') ||
                    err.message.includes('Target closed') ||
                    err.message.includes('not connected') ||
                    err.message.includes('Execution context')) {
                    console.log('🔄 CDP connection lost, attempting reconnect...');
                    this.isConnected = false;

                    // Thử reconnect (async, không block polling)
                    this.connect().then(ok => {
                        if (ok) {
                            console.log('✅ CDP reconnected successfully!');
                            // Clear hash cache để re-detect messages
                            this.lastMessageHashes.clear();
                        } else {
                            console.log('❌ CDP reconnect failed');
                        }
                    }).catch(e => {
                        console.log('❌ CDP reconnect error:', e.message);
                    });
                }
            }
        }, intervalMs);
    }

    /**
     * Dừng chat polling
     */
    stopChatPolling() {
        if (this.chatPollInterval) {
            clearInterval(this.chatPollInterval);
            this.chatPollInterval = null;
            this.lastMessageHashes.clear();
            console.log('⏹️ Đã dừng chat polling');
        }
    }

    /**
     * Gửi message vào Antigravity chat
     * Thứ tự ưu tiên: CDP Frame (background) → DOM injection → PowerShell fallback
     */
    async sendMessage(sessionId, message) {
        // Ensure CDP connection
        if (!this.isConnected) {
            const connected = await this.connect();
            if (!connected) {
                console.log('⚠️ CDP không kết nối được, dùng PowerShell fallback...');
                return await this.sendMessageViaPowerShell(sessionId, message);
            }
        }

        console.log(`📤 Gửi message: "${message.substring(0, 50)}..."`);

        // ========== PRIORITY 1: CDP FRAME (BACKGROUND - ưu tiên cao nhất) ==========
        try {
            console.log('🎯 Thử CDP Frame injection (background)...');
            const frameSent = await this.sendMessageViaCDPFrame(sessionId, message);
            if (frameSent) {
                await this.waitForResponse(sessionId);
                return true;
            }
        } catch (frameErr) {
            console.log('⚠️ CDP Frame failed:', frameErr.message);
        }

        // ========== PRIORITY 2: DOM INJECTION ==========
        try {
            console.log('🎯 Thử DOM injection...');
            const domSent = await this.sendMessageViaDOM(sessionId, message);
            if (domSent) {
                await this.waitForResponse(sessionId);
                return true;
            }
        } catch (domErr) {
            console.log('⚠️ DOM injection failed:', domErr.message);
        }

        // ========== PRIORITY 3: POWERSHELL FALLBACK ==========
        console.log('🎯 Fallback: PowerShell clipboard...');
        return await this.sendMessageViaPowerShell(sessionId, message);
    }

    /**
     * PHƯƠNG ÁN 2: Gửi message qua DOM injection vào iframe
     * Không dùng clipboard, không ảnh hưởng app khác
     * @param {string} sessionId - Session ID
     * @param {string} message - Tin nhắn cần gửi
     * @returns {Promise<boolean>}
     */
    async sendMessageViaDOM(sessionId, message) {
        if (!this.page) {
            throw new Error('Page not connected');
        }

        console.log(`📝 Sending via DOM injection: "${message.substring(0, 50)}..."`);

        try {
            const result = await this.page.evaluate((text) => {
                const results = { success: false, method: '', error: null };

                // 1. TÌM TẤT CẢ IFRAME
                const iframes = document.querySelectorAll('iframe');

                for (const iframe of iframes) {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (!doc || !doc.body) continue;

                        // 2. TÌM INPUT ELEMENT (ưu tiên theo thứ tự)
                        const inputSelectors = [
                            'textarea',
                            '[contenteditable="true"]',
                            '[role="textbox"]',
                            'input[type="text"]',
                            '[data-testid*="input"]',
                            '[data-testid*="chat"]',
                        ];

                        let inputEl = null;
                        for (const sel of inputSelectors) {
                            const el = doc.querySelector(sel);
                            if (el) {
                                // Kiểm tra visible
                                const rect = el.getBoundingClientRect();
                                if (rect.width > 0 && rect.height > 0) {
                                    inputEl = el;
                                    break;
                                }
                            }
                        }

                        if (!inputEl) continue;

                        // 3. INJECT TEXT VÀO INPUT (xử lý newlines đúng cách)
                        inputEl.focus();

                        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                            // Textarea xử lý \n tự nhiên
                            inputEl.value = text;
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                            results.method = 'textarea.value';
                        } else if (inputEl.getAttribute('contenteditable') === 'true') {
                            // Contenteditable: KHÔNG dùng execCommand insertText vì sẽ hiểu \n như Enter
                            // Thay vào đó, set innerHTML với các paragraphs
                            const escapeHtml = (str) => str
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;');

                            const lines = text.split('\n');
                            if (lines.length > 1) {
                                // Multi-line: wrap mỗi dòng trong <p>
                                inputEl.innerHTML = lines.map(line =>
                                    `<p>${escapeHtml(line) || '<br>'}</p>`
                                ).join('');
                            } else {
                                // Single line
                                inputEl.textContent = text;
                            }
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            results.method = 'contenteditable';
                        } else {
                            // Fallback: set textContent
                            inputEl.textContent = text;
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            results.method = 'textContent';
                        }

                        // 4. TÌM VÀ CLICK NÚT SUBMIT
                        const submitSelectors = [
                            'button[type="submit"]',
                            'button[aria-label*="send" i]',
                            'button[aria-label*="gửi" i]',
                            '[data-testid*="submit"]',
                            '[data-testid*="send"]',
                            '.send-button',
                            'button:has(svg)',  // Button có icon
                        ];

                        let submitBtn = null;
                        for (const sel of submitSelectors) {
                            try {
                                submitBtn = doc.querySelector(sel);
                                if (submitBtn) break;
                            } catch (e) {
                                // Selector không hợp lệ (như :has)
                            }
                        }

                        if (submitBtn) {
                            submitBtn.click();
                            results.success = true;
                            results.method += ' + button.click';
                        } else {
                            // Fallback: dispatch Enter key
                            inputEl.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true
                            }));
                            results.success = true;
                            results.method += ' + Enter key';
                        }

                        return results;

                    } catch (e) {
                        results.error = e.message;
                        // Cross-origin iframe, tiếp tục với iframe khác
                    }
                }

                // Nếu không tìm thấy iframe phù hợp, thử trên main document
                results.error = 'No suitable iframe found, trying main document';
                return results;

            }, message);

            console.log(`✅ DOM injection result:`, result);

            if (result.success) {
                // Log message đã gửi
                this.chatLogger.logMessage('user', message);

                // Emit event
                if (this.eventBus && sessionId) {
                    this.eventBus.emit(sessionId, 'terminal', {
                        line: `📤 Đã gửi (DOM): ${message}`
                    });
                }
                return true;
            } else {
                throw new Error(result.error || 'DOM injection failed');
            }

        } catch (err) {
            console.error('❌ DOM injection error:', err.message);
            throw err;
        }
    }

    /**
     * 🚀 PHƯƠNG ÁN 3: Gửi message qua CDP Frames API
     * Bypass cross-origin bằng cách evaluate trực tiếp trong iframe context
     * HOÀN TOÀN BACKGROUND - không cần focus window!
     * @param {string} sessionId - Session ID
     * @param {string} message - Tin nhắn cần gửi
     * @returns {Promise<boolean>}
     */
    async sendMessageViaCDPFrame(sessionId, message) {
        if (!this.page) {
            throw new Error('Page not connected');
        }

        console.log(`📝 [CDP Frame] Sending: "${message.substring(0, 50)}..."`);

        try {
            const frames = this.page.frames();

            for (const frame of frames) {
                const frameUrl = frame.url();

                // Chỉ quan tâm frame extension (chứa chat)
                if (!frameUrl || !frameUrl.includes('extension')) {
                    continue;
                }

                try {
                    // Evaluate trực tiếp trong frame context
                    const result = await frame.evaluate((text) => {
                        const results = { success: false, method: '', error: null, debug: [] };

                        // 1. TÌM INPUT ELEMENT
                        const inputSelectors = [
                            'textarea',
                            '[contenteditable="true"]',
                            '[role="textbox"]',
                            'input[type="text"]',
                            '[data-testid*="input"]',
                            '[data-testid*="chat"]',
                        ];

                        let inputEl = null;
                        for (const sel of inputSelectors) {
                            try {
                                const el = document.querySelector(sel);
                                if (el) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.width > 0 && rect.height > 0) {
                                        inputEl = el;
                                        results.debug.push(`Found input: ${sel}`);
                                        break;
                                    }
                                }
                            } catch (e) { }
                        }

                        if (!inputEl) {
                            results.error = 'No input element found';
                            return results;
                        }

                        // 2. INJECT TEXT VÀO INPUT (xử lý newlines đúng cách)
                        inputEl.focus();

                        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                            // Textarea xử lý \n tự nhiên
                            inputEl.value = text;
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                            results.method = 'textarea.value';
                        } else if (inputEl.getAttribute('contenteditable') === 'true') {
                            // Contenteditable: convert \n thành Shift+Enter behavior
                            // QUAN TRỌNG: Không dùng textContent (sẽ mất newlines)
                            // Thay vào đó, set innerHTML với các <p> hoặc <br> tags
                            inputEl.innerHTML = '';

                            // Escape HTML và convert newlines thành line breaks
                            const escapeHtml = (str) => str
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;');

                            // Split by newlines và wrap mỗi dòng
                            const lines = text.split('\n');
                            if (lines.length > 1) {
                                // Multi-line: dùng <p> hoặc <div> cho mỗi dòng
                                inputEl.innerHTML = lines.map(line =>
                                    `<p>${escapeHtml(line) || '<br>'}</p>`
                                ).join('');
                            } else {
                                // Single line: chỉ cần text
                                inputEl.textContent = text;
                            }

                            inputEl.dispatchEvent(new InputEvent('input', {
                                bubbles: true,
                                cancelable: true,
                                inputType: 'insertText',
                                data: text
                            }));
                            results.method = 'contenteditable';
                            results.debug.push(`Text has ${lines.length} lines`);
                        } else {
                            inputEl.textContent = text;
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            results.method = 'textContent';
                        }

                        results.debug.push(`Injected text via ${results.method}`);

                        // 3. TÌM VÀ CLICK NÚT SUBMIT (priority order)
                        const submitSelectors = [
                            'button[type="submit"]',
                            'button[aria-label*="send" i]',
                            'button[aria-label*="gửi" i]',
                            'button[aria-label*="Submit" i]',
                            '[data-testid*="submit"]',
                            '[data-testid*="send"]',
                            '.send-button',
                        ];

                        let submitBtn = null;
                        for (const sel of submitSelectors) {
                            try {
                                const btn = document.querySelector(sel);
                                if (btn && !btn.disabled) {
                                    submitBtn = btn;
                                    results.debug.push(`Found submit button: ${sel}`);
                                    break;
                                }
                            } catch (e) { }
                        }

                        // Fallback: tìm button có icon SVG (thường là nút gửi)
                        if (!submitBtn) {
                            const buttons = document.querySelectorAll('button');
                            for (const btn of buttons) {
                                const svg = btn.querySelector('svg');
                                const text = (btn.innerText || '').toLowerCase();
                                // Nút gửi thường có icon và không có text, hoặc text là "send"
                                if (svg && (btn.innerText.trim().length < 10 || text.includes('send'))) {
                                    const rect = btn.getBoundingClientRect();
                                    if (rect.width > 0 && rect.height > 0 && !btn.disabled) {
                                        submitBtn = btn;
                                        results.debug.push('Found submit button via SVG icon');
                                        break;
                                    }
                                }
                            }
                        }

                        if (submitBtn) {
                            submitBtn.click();
                            results.success = true;
                            results.method += ' + button.click';
                            results.debug.push('Clicked submit button');
                        } else {
                            // Fallback: Enter key với nhiều event types
                            results.debug.push('No submit button, trying Enter key...');

                            // Try keydown + keypress + keyup sequence
                            const enterEvent = {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true,
                                cancelable: true
                            };

                            inputEl.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
                            inputEl.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
                            inputEl.dispatchEvent(new KeyboardEvent('keyup', enterEvent));

                            // Thêm: Tìm form và submit
                            const form = inputEl.closest('form');
                            if (form) {
                                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                                results.debug.push('Dispatched form submit event');
                            }

                            results.success = true;
                            results.method += ' + Enter key sequence';
                        }

                        return results;

                    }, message);

                    console.log(`📝 [CDP Frame] Result:`, JSON.stringify(result));

                    if (result.success) {
                        // ========== QUAN TRỌNG: Click vào input trong frame trước ==========
                        // page.keyboard.press sẽ gửi vào element đang focus
                        // Cần click vào input trong frame để focus đúng
                        console.log(`📝 [CDP Frame] Text injected, clicking input to focus...`);

                        // Tìm và click vào input trong frame này
                        const inputSelectors = ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]'];
                        for (const sel of inputSelectors) {
                            try {
                                const el = await frame.$(sel);
                                if (el) {
                                    await frame.click(sel);
                                    console.log(`📝 [CDP Frame] Clicked on ${sel} in frame`);
                                    break;
                                }
                            } catch (e) { }
                        }

                        // Delay nhỏ để focus update
                        await new Promise(r => setTimeout(r, 100));

                        // Gửi Enter qua Puppeteer keyboard
                        console.log(`📝 [CDP Frame] Pressing Enter via Puppeteer...`);
                        await this.page.keyboard.press('Enter');

                        console.log(`✅ [CDP Frame] Enter pressed via Puppeteer keyboard!`);

                        // Log message đã gửi
                        this.chatLogger.logMessage('user', message);

                        // Emit event
                        if (this.eventBus && sessionId) {
                            this.eventBus.emit(sessionId, 'terminal', {
                                line: `📤 Đã gửi (CDP Frame + Enter): ${message}`
                            });
                        }

                        console.log(`✅ [CDP Frame] Message sent successfully via: ${result.method} + Puppeteer Enter`);
                        return true;
                    } else {
                        console.log(`⚠️ [CDP Frame] Failed in this frame: ${result.error}`);
                    }

                } catch (frameErr) {
                    console.log(`⚠️ [CDP Frame] Frame error: ${frameErr.message}`);
                }
            }

            // Không tìm thấy frame phù hợp
            throw new Error('No suitable extension frame found for chat injection');

        } catch (err) {
            console.error('❌ [CDP Frame] Error:', err.message);
            throw err;
        }
    }

    /**
     * Gửi message qua PowerShell (fallback khi CDP không hoạt động)
     */
    async sendMessageViaPowerShell(sessionId, message) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, '..', 'inject_text.ps1');

            // Escape special characters for PowerShell
            const escapedMessage = message.replace(/"/g, '`"').replace(/\$/g, '`$');

            const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Text "${escapedMessage}"`;

            console.log(`📤 Gửi message qua PowerShell: "${message.substring(0, 50)}..."`);

            exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ PowerShell inject error:', error.message);
                    reject(new Error(`Không thể inject text: ${error.message}`));
                    return;
                }

                const output = stdout.trim();
                console.log('PowerShell output:', output);

                if (output === 'OK') {
                    console.log('✅ Đã gửi message qua PowerShell');

                    // Emit event
                    if (this.eventBus && sessionId) {
                        this.eventBus.emit(sessionId, 'terminal', {
                            line: `📤 Đã gửi (PowerShell): ${message}`
                        });
                    }

                    resolve(true);
                } else {
                    reject(new Error(`PowerShell failed: ${output}`));
                }
            });
        });
    }

    /**
     * Chờ và stream response từ Antigravity
     */
    async waitForResponse(sessionId) {
        // Response đã được handle bởi DOM Observer (realtime)
        // Hàm này chỉ mang tính chất fallback hoặc chờ đợi explicit
        // Không cần làm gì nhiều nếu setupDOMObserver hoạt động tốt
        console.log('⏳ Đang chờ response (qua Observer)...');
    }

    /**
     * Gửi Accept hoặc Reject vào Antigravity
     * @param {string} decision - 'accept' hoặc 'reject'
     * @returns {Promise<boolean>} - true nếu thành công
     */
    async sendApproval(decision) {
        if (!this.isConnected) {
            const connected = await this.connect();
            if (!connected) {
                throw new Error('Không thể kết nối tới Antigravity. Đảm bảo Antigravity đang chạy với debug mode.');
            }
        }

        console.log(`🔘 Đang gửi ${decision} vào Antigravity...`);

        try {
            // Thử tìm và click nút Accept/Reject
            const buttonSelectors = decision === 'accept'
                ? [
                    'button:has-text("Accept")',
                    'button:has-text("Chấp nhận")',
                    'button:has-text("Yes")',
                    'button:has-text("OK")',
                    '[data-testid="accept-button"]',
                    '.accept-button',
                    '.btn-accept'
                ]
                : [
                    'button:has-text("Reject")',
                    'button:has-text("Từ chối")',
                    'button:has-text("No")',
                    'button:has-text("Cancel")',
                    '[data-testid="reject-button"]',
                    '.reject-button',
                    '.btn-reject'
                ];

            let clicked = false;

            // Thử click các button selectors
            for (const selector of buttonSelectors) {
                try {
                    const button = await this.page.$(selector);
                    if (button) {
                        await button.click();
                        clicked = true;
                        console.log(`✅ Đã click vào: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Thử selector tiếp theo
                }
            }

            // Nếu không tìm thấy button, thử dùng keyboard
            if (!clicked) {
                console.log('⚠️ Không tìm thấy button, thử dùng keyboard...');

                // Escape để đóng bất kỳ focus nào trên chat input
                await this.page.keyboard.press('Escape');
                await new Promise(r => setTimeout(r, 100));

                // Gửi phím tương ứng
                if (decision === 'accept') {
                    // Thử các phím thường dùng cho Accept
                    await this.page.keyboard.press('y');
                } else {
                    await this.page.keyboard.press('Escape');
                }

                console.log(`✅ Đã gửi keyboard shortcut cho ${decision}`);
                clicked = true;
            }

            return clicked;

        } catch (err) {
            console.error(`❌ Lỗi khi gửi ${decision}:`, err.message);
            throw err;
        }
    }

    /**
     * Ngắt kết nối
     */
    disconnect() {
        // Dừng chat polling trước
        this.stopChatPolling();

        if (this.browser) {
            this.browser.disconnect();
            this.browser = null;
            this.page = null;
            this.isConnected = false;
            console.log('👋 AntigravityBridge: Đã ngắt kết nối');
        }
    }
}

module.exports = AntigravityBridge;
