/**
 * 🚀 Antigravity Chat Bridge v4.1 (Force Click & Debug Enhanced)
 * 
 * Chiến lược: Scan toàn document với filter mạnh
 * - Không cần transcript root
 * - Dùng MutationObserver trên document.body
 * - Filter dựa trên text patterns và DOM structure
 */

(function () {
    const WS_URL = 'ws://localhost:8000/ws/bridge';
    const FINALIZE_DELAY = 1500;
    const POLL_INTERVAL = 500;  // Fallback polling

    console.log('🚀 Antigravity Chat Bridge v4.1 - Installing...');

    // =========================================
    // STATE
    // =========================================
    let ws = null;
    let isConnected = false;
    let lastText = '';
    let lastHtml = '';  // Track HTML content too
    let finalizeTimer = null;
    let reconnectTimer = null;
    let pollTimer = null;
    let observer = null;

    // =========================================
    // BLOCKLIST PATTERNS (UI spam)
    // =========================================
    const BLOCKLIST_STARTS = [
        'Files With Changes', 'Reject All', 'Accept All', 'Add Context', 'Mentions', 'Images',
        'Conversation Mode', 'Model', 'Planning', 'Verification', 'Execution',
        'Claude', 'Gemini', 'GPT', 'Submit', 'Cancel', 'Undo', 'Redo',
        'Copy', 'Paste', 'Save', 'Delete', 'New', 'Open', 'Close',
        'Settings', 'Preferences', 'Help', 'About', 'Version',
        'Update', 'Upgrade', 'Download', 'Upload', 'Export', 'Import'
    ];

    const BLOCKLIST_CONTAINS = [
        'files with changes', 'reject all', 'accept all', 'add context',
        'execute tasks directly', 'simple tasks that can be completed',
        'agent can plan', 'deep research', 'complex tasks', 'conversation mode',
        'use for simple tasks', 'use for deep', 'use for complex',
        '+0 -0', 'Auto', 'Toggle', 'Expand', 'Collapse', 'Show more', 'Show less',
        'Load more', 'Loading...', 'Thinking...', 'Generating...', 'Processing...'
    ];

    // =========================================
    // HELPER: Visibility Check
    // =========================================
    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    }

    // =========================================
    // FILTER: Check if text is UI spam
    // =========================================
    function isBlockedText(text) {
        if (!text || text.length < 20) return true;
        if (text.length > 50000) return true;

        const trimmed = text.trim();

        // Check starts with blocklist
        for (const pattern of BLOCKLIST_STARTS) {
            if (trimmed.startsWith(pattern)) return true;
        }

        // Check contains blocklist (case insensitive)
        const lower = trimmed.toLowerCase();
        for (const pattern of BLOCKLIST_CONTAINS) {
            if (lower.includes(pattern.toLowerCase())) return true;
        }

        // Check if mostly numbers/symbols
        const alphaRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;
        if (alphaRatio < 0.3 && trimmed.length < 100) return true;

        return false;
    }

    // =========================================
    // EXTRACT: Find assistant messages (SCAN IFRAMES!)
    // =========================================
    function findAssistantMessages() {
        const results = [];
        const iframes = document.querySelectorAll('iframe');

        function getClassName(el) {
            if (!el.className) return '';
            if (typeof el.className === 'string') return el.className;
            if (el.className.baseVal !== undefined) return el.className.baseVal;
            return '';
        }

        function getCleanText(el) {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
            return (clone.innerText || '').trim();
        }

        function getHtmlContent(el) {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('script, style, noscript').forEach(n => n.remove());
            return (clone.innerHTML || '').trim();
        }

        iframes.forEach((iframe, idx) => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!doc || !doc.body) return;

                const messageSelectors = [
                    '[class*="message"]', '[class*="Message"]', '[class*="response"]', '[class*="Response"]',
                    '[class*="assistant"]', '[class*="user"]', '[class*="chat-item"]', '[class*="bubble"]',
                    '[data-role]', '[data-message-role]', '[class*="turn-"]', '[class*="conversation"]'
                ];

                const seenTexts = new Set();

                for (const selector of messageSelectors) {
                    try {
                        doc.querySelectorAll(selector).forEach(container => {
                            const className = getClassName(container);
                            const classLower = className.toLowerCase();

                            if (classLower.includes('cm-') || classLower.includes('monaco')) return;
                            if (classLower.includes('hljs') || classLower.includes('prism')) return;
                            if (classLower.includes('input') || classLower.includes('textarea')) return;
                            if (classLower.includes('dropdown') || classLower.includes('menu')) return;
                            if (classLower.includes('modal') || classLower.includes('tooltip')) return;
                            if (classLower.includes('sidebar') || classLower.includes('toolbar')) return;

                            const text = getCleanText(container);
                            if (!text || text.length < 30) return;

                            const modelKeywords = ['Claude', 'Gemini', 'GPT', 'Opus', 'Sonnet', 'Pro', 'Flash'];
                            let modelCount = 0;
                            for (const kw of modelKeywords) {
                                if (text.includes(kw)) modelCount++;
                            }
                            if (modelCount >= 3) return;

                            const textKey = text.substring(0, 100) + text.length;
                            if (seenTexts.has(textKey)) return;
                            seenTexts.add(textKey);

                            if (isBlockedText(text)) return;

                            let role = 'unknown';
                            if (classLower.includes('user') || classLower.includes('human')) {
                                role = 'user';
                            } else if (classLower.includes('assistant') || classLower.includes('ai') ||
                                classLower.includes('response') || classLower.includes('bot')) {
                                role = 'assistant';
                            }

                            const rect = container.getBoundingClientRect();
                            results.push({
                                el: container,
                                text: text,
                                html: getHtmlContent(container),
                                rect: rect,
                                role: role,
                                iframeIdx: idx
                            });
                        });
                    } catch (e) { /* selector error */ }
                }
            } catch (e) { /* cross-origin skip */ }
        });

        if (results.length === 0) {
            // console.log(`⚠️ findAssistantMessages: Found ${iframes.length} iframes, 0 messages`);
        }

        results.sort((a, b) => (b.rect?.top || 0) - (a.rect?.top || 0));
        return results;
    }

    // =========================================
    // MAIN EXTRACT FUNCTION
    // =========================================
    function extractLastAssistantText() {
        const messages = findAssistantMessages();
        if (messages.length === 0) return null;

        const latest = messages[0];
        return {
            text: latest.text,
            html: latest.html,
            role: 'assistant'
        };
    }

    // =========================================
    // INJECT MESSAGE TO CHAT (SEND FROM PHONE)
    // =========================================
    function injectMessageToChat(text) {
        console.log('📝 Injecting message to chat:', text.substring(0, 50) + '...');

        const iframes = document.querySelectorAll('iframe');
        let injected = false;

        iframes.forEach((iframe) => {
            if (injected) return;

            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!doc || !doc.body) return;

                const inputSelectors = [
                    'textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]'
                ];

                let inputEl = null;
                for (const sel of inputSelectors) {
                    const el = doc.querySelector(sel);
                    if (el) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            inputEl = el;
                            break;
                        }
                    }
                }

                if (!inputEl) return;

                // Focus & Inject
                inputEl.focus();

                // ========== FIX: KHÔNG dùng execCommand('insertText') ==========
                // execCommand interpret \n như Enter key → gửi tin nhắn sớm!
                // Thay bằng set value/innerHTML trực tiếp để giữ nguyên \n

                if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
                    // Textarea/Input: set value trực tiếp (giữ nguyên \n)
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                    if (nativeInputValueSetter) {
                        nativeInputValueSetter.call(inputEl, text);
                    } else {
                        inputEl.value = text;
                    }
                } else if (inputEl.getAttribute('contenteditable') === 'true') {
                    // Contenteditable: convert \n thành <p> hoặc <br>
                    const escapeHtml = (str) => str
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');

                    const lines = text.split('\n');
                    if (lines.length > 1) {
                        // Multi-line: wrap trong <p> tags
                        inputEl.innerHTML = lines.map(line =>
                            `<p>${escapeHtml(line) || '<br>'}</p>`
                        ).join('');
                    } else {
                        // Single line
                        inputEl.textContent = text;
                    }
                } else {
                    // Fallback: set textContent
                    inputEl.textContent = text;
                }

                // Dispatch Events
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                injected = true;

                // WAIT & CLICK SEND
                setTimeout(() => {
                    // NEW: Improved Button Finding Logic
                    // 1. Tìm nút Submit hoặc Send
                    const submitBtns = Array.from(doc.querySelectorAll('button, [role="button"], div[role="button"]'));
                    let submitBtn = null;

                    // Ưu tiên tìm nút có icon send hoặc text send
                    for (const btn of submitBtns) {
                        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                        const txt = (btn.innerText || '').toLowerCase();
                        const title = (btn.title || '').toLowerCase();
                        const dataTestId = (btn.getAttribute('data-testid') || '').toLowerCase();

                        // Check if contains SVG
                        const hasSvg = !!btn.querySelector('svg, img');

                        // Check patterns
                        const isSend =
                            aria.includes('send') || aria.includes('gửi') || aria.includes('submit') ||
                            txt.includes('send') || txt.includes('gửi') ||
                            title.includes('send') || dataTestId.includes('send') ||
                            (hasSvg && (aria.includes('send') || title.includes('send') || aria.includes('prompt')));

                        if (isSend) {
                            // Check visibility
                            const style = window.getComputedStyle(btn);
                            if (style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                                submitBtn = btn;
                                console.log('✅ Found Send Button:', btn);
                                break;
                            }
                        }
                    }

                    // Heuristic Fallback: Tìm nút cuối cùng trong form/container
                    if (!submitBtn && inputEl) {
                        const form = inputEl.closest('form');
                        if (form) {
                            submitBtn = form.querySelector('button[type="submit"]');
                            if (!submitBtn) {
                                // Nút cuối cùng trong form
                                const btns = form.querySelectorAll('button');
                                if (btns.length > 0) submitBtn = btns[btns.length - 1];
                            }
                            if (submitBtn) console.log('⚠️ Found Submit Button via Form:', submitBtn);
                        }
                    }

                    if (submitBtn) {
                        console.log('✅ Clicking Submit Button...');
                        submitBtn.click();
                        setTimeout(() => submitBtn.click(), 100); // Double click safety
                    } else {
                        console.log('⚠️ No submit button found, simulating ENTER...');
                        const keyOpts = {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            bubbles: true, cancelable: true, view: iframe.contentWindow
                        };
                        inputEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
                        inputEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
                        inputEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
                    }

                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'inject_result',
                            success: true,
                            text: text.substring(0, 50)
                        }));
                    }

                }, 400); // Increased delay to 400ms for safety

            } catch (e) {
                console.log('⚠️ Cross-origin iframe logic error:', e.message);
            }
        });

        if (!injected && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'inject_result', success: false, error: 'No input found' }));
        }
    }

    // =========================================
    // WEBSOCKET CONNECTION
    // =========================================
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) return;

        console.log('🔌 Connecting to WebSocket...');

        try {
            ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                console.log('✅ WebSocket connected!');
                isConnected = true;
                ws.send(JSON.stringify({ type: 'bridge_register', source: 'antigravity_console_v4' }));
                startPolling();
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // console.log('📩 Received:', data.type);
                    if (data.type === 'inject_message' && data.text) {
                        injectMessageToChat(data.text);
                    }
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            };

            ws.onclose = () => {
                console.log('🔌 WebSocket disconnected');
                isConnected = false;
                stopPolling();
                scheduleReconnect();
            };

            ws.onerror = () => {
                console.error('❌ WebSocket error');
                isConnected = false;
            };
        } catch (err) {
            console.error('❌ Failed to create WebSocket:', err.message);
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, 5000);
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(tick, POLL_INTERVAL);
        console.log('🔄 Polling started');
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function emitUpdate(text, html) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            type: 'ai_messages',
            messages: [{
                text: text, html: html,
                timestamp: new Date().toISOString(),
                role: 'assistant', isStreaming: true
            }]
        }));
    }

    function emitComplete(text, html) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            type: 'ai_messages',
            messages: [{
                text: text, html: html,
                timestamp: new Date().toISOString(),
                role: 'assistant', isComplete: true
            }]
        }));
    }

    function tick() {
        const msg = extractLastAssistantText();
        if (!msg) return;

        if (msg.text !== lastText) {
            lastText = msg.text;
            lastHtml = msg.html || '';
            emitUpdate(lastText, lastHtml);

            clearTimeout(finalizeTimer);
            finalizeTimer = setTimeout(() => {
                emitComplete(lastText, lastHtml);
            }, FINALIZE_DELAY);
        }
    }

    function start() {
        connect();
        if (!observer && document.body) {
            observer = new MutationObserver(() => tick());
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        tick();
    }

    function stop() {
        if (observer) { observer.disconnect(); observer = null; }
        if (ws) { ws.close(); ws = null; }
        stopPolling();
        clearTimeout(finalizeTimer);
        clearTimeout(reconnectTimer);
    }

    window.chatBridge = {
        start: start, stop: stop,
        status: () => ({ isConnected, lastTextLen: lastText.length, polling: !!pollTimer }),
        testExtract: () => extractLastAssistantText(),
        listMessages: () => findAssistantMessages().length
    };

    start();
    console.log('✅ Antigravity Chat Bridge v4.1 - READY! (Auto-Inject Force Click)');
})();
