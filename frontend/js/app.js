/**
 * PhoneBridge-AgentHub - Frontend Application (Simplified)
 * Mobile-first PWA for controlling AI agents
 */

class PhoneBridgeApp {
    constructor() {
        this.serverUrl = '';
        this.sessionId = null;
        this.ws = null;
        this.isConnected = false;

        // Streaming state - for message consolidation
        this.streamingBubble = null;
        this.partialMessageIds = new Set();

        // Settings
        this.fontSize = parseInt(localStorage.getItem('phonebridge_font_size')) || 16;
        this.layoutScale = parseInt(localStorage.getItem('phonebridge_layout_scale')) || 100;

        this.init();
    }

    init() {
        this.elements = {
            // Screens
            connectScreen: document.getElementById('connect-screen'),
            mainScreen: document.getElementById('main-screen'),

            // Connect form
            serverUrlInput: document.getElementById('server-url'),
            repoPathInput: document.getElementById('repo-path'),
            connectBtn: document.getElementById('connect-btn'),
            connectError: document.getElementById('connect-error'),

            // Header
            disconnectBtn: document.getElementById('disconnect-btn'),
            statusDot: document.querySelector('.status-dot'),

            // Chat
            messagesContainer: document.getElementById('messages'),
            chatInput: document.getElementById('chat-input'),
            sendBtn: document.getElementById('send-btn'),

            // Settings
            settingsBtn: document.getElementById('settings-btn'),
            settingsModal: document.getElementById('settings-modal'),
            fontSizeDisplay: document.getElementById('font-size-display'),
            fontSizeSlider: document.getElementById('font-size-slider'),
            layoutScaleDisplay: document.getElementById('layout-scale-display'),
            layoutScaleSlider: document.getElementById('layout-scale-slider'),
            settingsSessionId: document.getElementById('settings-session-id'),
            settingsConnectionStatus: document.getElementById('settings-connection-status')
        };

        this.bindEvents();
        this.loadSavedSettings();
        this.applySettings();
        this.autoConnect();
    }

    async autoConnect() {
        const serverUrl = window.location.origin;
        if (!serverUrl || serverUrl === 'null') return;

        try {
            const response = await fetch(`${serverUrl}/api/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_path: 'auto-connect' })
            });

            if (response.ok) {
                const data = await response.json();
                this.serverUrl = serverUrl;
                this.sessionId = data.session_id;

                await this.connectWebSocket();
                this.showMainScreen();
                console.log('✅ Auto-connected!');
            }
        } catch (err) {
            console.log('Auto-connect skipped:', err.message);
        }
    }

    bindEvents() {
        // Connect/Disconnect
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

        // Chat - click button to send
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());

        // Auto-resize textarea
        this.elements.chatInput.addEventListener('input', () => {
            this.elements.chatInput.style.height = 'auto';
            this.elements.chatInput.style.height = Math.min(this.elements.chatInput.scrollHeight, 120) + 'px';
        });

        // Settings button
        this.elements.settingsBtn?.addEventListener('click', () => this.toggleSettings());
    }

    loadSavedSettings() {
        const savedUrl = localStorage.getItem('phonebridge_server_url');
        const savedRepo = localStorage.getItem('phonebridge_repo_path');

        if (savedUrl) {
            this.elements.serverUrlInput.value = savedUrl;
        } else {
            const currentOrigin = window.location.origin;
            if (currentOrigin && currentOrigin !== 'null' && !currentOrigin.includes('localhost')) {
                this.elements.serverUrlInput.value = currentOrigin;
            } else {
                this.elements.serverUrlInput.value = 'http://localhost:8000';
            }
        }

        if (savedRepo) this.elements.repoPathInput.value = savedRepo;
    }

    saveSettings() {
        localStorage.setItem('phonebridge_server_url', this.serverUrl);
        localStorage.setItem('phonebridge_repo_path', this.elements.repoPathInput.value);
    }

    // ==================== CONNECTION ====================

    async connect() {
        const serverUrl = this.elements.serverUrlInput.value.trim();
        const repoPath = this.elements.repoPathInput.value.trim();

        if (!serverUrl) {
            this.showError('Vui lòng nhập địa chỉ Server');
            return;
        }

        if (!repoPath) {
            this.showError('Vui lòng nhập đường dẫn Workspace');
            return;
        }

        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.setConnecting(true);
        this.hideError();

        try {
            const response = await fetch(`${this.serverUrl}/api/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_path: repoPath })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            this.sessionId = data.session_id;

            await this.connectWebSocket();
            this.saveSettings();
            this.showMainScreen();

        } catch (err) {
            console.error('Connection failed:', err);
            this.showError(`Connection failed: ${err.message}`);
        } finally {
            this.setConnecting(false);
        }
    }

    connectWebSocket() {
        return new Promise((resolve, reject) => {
            const wsUrl = this.serverUrl.replace('http', 'ws') + `/ws/${this.sessionId}`;

            this.ws = new WebSocket(wsUrl);
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 10;

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus(true);
                this.startHeartbeat();
                this.startChatPolling();
                resolve();
            };

            this.ws.onclose = (event) => {
                console.log('⚠️ WebSocket disconnected:', event.code, event.reason);
                this.isConnected = false;
                this.updateConnectionStatus(false);
                this.stopHeartbeat();

                if (this.sessionId && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (err) => {
                console.error('❌ WebSocket error:', err);
                reject(new Error('WebSocket connection failed'));
            };

            this.ws.onmessage = (event) => {
                if (event.data === 'pong') return;
                this.handleWebSocketMessage(event);
            };

            setTimeout(() => {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    this.ws.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 5000);
        });
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            if (!this.sessionId) return;

            try {
                await this.connectWebSocket();
            } catch (err) {
                console.error('Reconnect failed:', err);
            }
        }, delay);
    }

    disconnect() {
        this.sessionId = null;
        this.isConnected = false;
        this.stopHeartbeat();
        this.stopChatPolling();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.elements.messagesContainer.innerHTML = '';
        this.elements.mainScreen.classList.remove('active');
        this.elements.connectScreen.classList.add('active');
    }

    async startChatPolling() {
        if (!this.sessionId || !this.serverUrl) return;

        try {
            await fetch(`${this.serverUrl}/api/response/start-chat-polling`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    intervalMs: 2000
                })
            });
            console.log('✅ Chat polling started');
        } catch (err) {
            console.error('Failed to start chat polling:', err);
        }
    }

    async stopChatPolling() {
        if (!this.serverUrl) return;

        try {
            await fetch(`${this.serverUrl}/api/response/stop-chat-polling`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            console.error('Failed to stop chat polling:', err);
        }
    }

    // ==================== UI HELPERS ====================

    setConnecting(connecting) {
        const btnText = this.elements.connectBtn.querySelector('.btn-text');
        const btnLoading = this.elements.connectBtn.querySelector('.btn-loading');

        if (connecting) {
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');
            this.elements.connectBtn.disabled = true;
        } else {
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
            this.elements.connectBtn.disabled = false;
        }
    }

    showError(message) {
        this.elements.connectError.textContent = message;
        this.elements.connectError.classList.remove('hidden');
    }

    hideError() {
        this.elements.connectError.classList.add('hidden');
    }

    showMainScreen() {
        this.elements.connectScreen.classList.remove('active');
        this.elements.mainScreen.classList.add('active');
        this.updateSettingsInfo();
    }

    updateConnectionStatus(connected) {
        if (this.elements.statusDot) {
            this.elements.statusDot.classList.toggle('disconnected', !connected);
        }
        this.updateSettingsInfo();
    }

    updateSettingsInfo() {
        if (this.elements.settingsSessionId) {
            this.elements.settingsSessionId.textContent = this.sessionId || '--';
        }
        if (this.elements.settingsConnectionStatus) {
            this.elements.settingsConnectionStatus.textContent = this.isConnected ? 'Đã kết nối' : 'Mất kết nối';
            this.elements.settingsConnectionStatus.className = 'connection-badge ' + (this.isConnected ? 'connected' : 'disconnected');
        }
    }

    // ==================== CHAT ====================

    async sendMessage() {
        const message = this.elements.chatInput.value.trim();
        if (!message || !this.isConnected) return;

        this.elements.chatInput.value = '';
        this.elements.chatInput.style.height = 'auto';

        // Add user message to UI (no notification needed)
        this.addChatBubble('user', message);

        try {
            await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    message: message,
                    send_mode: 'cdp' // Always use CDP injection
                })
            });
            // No notification shown - just send silently
        } catch (err) {
            console.error('Failed to send message:', err);
            this.addChatBubble('system', `❌ Lỗi gửi: ${err.message}`);
        }
    }

    renderMarkdown(text) {
        if (typeof marked !== 'undefined') {
            try {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
                return marked.parse(text);
            } catch (e) {
                console.error('Marked.js error:', e);
            }
        }

        // Fallback
        return text
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    // ==================== WEBSOCKET HANDLER ====================

    handleWebSocketMessage(event) {
        try {
            const { type, data, ts } = JSON.parse(event.data);

            switch (type) {
                case 'status':
                    console.log('Status:', data.message);
                    break;

                case 'plan':
                    this.addChatBubble('assistant', data.markdown);
                    break;

                case 'ai_messages':
                    // Messages từ chat_bridge_ws.js (auto-injected script)
                    this.handleAiMessages(data);
                    break;

                case 'chat_update':
                    this.handleChatUpdate(data);
                    break;

                case 'chat_complete':
                    this.handleChatComplete(data);
                    break;

                case 'error':
                    this.addChatBubble('system', `❌ Lỗi: ${data.message || 'Lỗi không xác định'}`);
                    break;
            }
        } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
        }
    }

    /**
     * Handle ai_messages từ chat_bridge_ws.js (injected vào Antigravity)
     * Đây là event chính để nhận AI responses
     */
    handleAiMessages(data) {
        if (!data.messages || data.messages.length === 0) return;

        data.messages.forEach(msg => {
            // Prefer HTML (already rendered from Antigravity) over text
            const content = msg.html || msg.text;
            const isHtml = !!msg.html;

            if (msg.isStreaming) {
                // Streaming - update bubble (use text for streaming as it's incomplete)
                this.updateStreamingBubble(msg.text);
            } else if (msg.isComplete) {
                // Complete message - use HTML if available
                if (this.streamingBubble) {
                    this.streamingBubble.remove();
                    this.streamingBubble = null;
                }
                this.addChatBubble('assistant', content, isHtml);
            } else {
                // Regular message - use HTML if available
                this.addChatBubble(msg.role || 'assistant', content, isHtml);
            }
        });
    }

    handleChatUpdate(data) {
        if (!data.messages || data.messages.length === 0) return;

        if (data.partial) {
            data.messages.forEach(msg => {
                if (msg.role === 'assistant' || msg.role === 'unknown') {
                    // Prefer HTML over text for rich formatting
                    const content = msg.html || msg.text;
                    const isHtml = !!msg.html;
                    this.updateStreamingBubble(content, isHtml);
                }
            });
        } else {
            data.messages.forEach(msg => {
                const role = msg.role === 'user' ? 'user' : 'assistant';
                const content = msg.html || msg.text;
                const isHtml = !!msg.html;
                this.addChatBubble(role, content, isHtml);
            });
        }
    }

    handleChatComplete(data) {
        // Prefer HTML over text for rich formatting (tables, code blocks)
        const finalContent = data.html || data.content || data.text || '';
        const isHtml = !!data.html;

        if (this.streamingBubble) {
            this.streamingBubble.remove();
            this.streamingBubble = null;
        }

        this.partialMessageIds.clear();

        if (finalContent && finalContent.length > 0) {
            this.addChatBubble('assistant', finalContent, isHtml);

            // Force scroll after DOM update for final message
            setTimeout(() => {
                const messages = this.elements.messagesContainer.querySelectorAll('.message');
                const lastMessage = messages[messages.length - 1];
                if (lastMessage) {
                    lastMessage.scrollIntoView({ behavior: 'auto', block: 'end' });
                }
            }, 100);
        }
    }

    updateStreamingBubble(content, isHtml = false) {
        if (!this.streamingBubble) {
            this.streamingBubble = document.createElement('div');
            this.streamingBubble.className = 'message assistant streaming';
            this.streamingBubble.innerHTML = `<div class="streaming-indicator">●</div><div class="message-text"></div>`;
            this.elements.messagesContainer.appendChild(this.streamingBubble);
        }

        const textEl = this.streamingBubble.querySelector('.message-text');
        if (textEl) {
            // Use HTML directly if already rendered, otherwise render markdown
            textEl.innerHTML = isHtml ? content : this.renderMarkdown(content);
        }

        // Auto-scroll to bottom - IMMEDIATE scroll
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        requestAnimationFrame(() => {
            this.streamingBubble.scrollIntoView({ behavior: 'auto', block: 'end' });
        });
    }

    addChatBubble(role, text, isHtml = false) {
        const bubble = document.createElement('div');
        bubble.className = `message ${role}`;
        // If isHtml is true, use content directly (already rendered HTML from Antigravity)
        // Otherwise, render markdown
        bubble.innerHTML = isHtml ? text : this.renderMarkdown(text);

        this.elements.messagesContainer.appendChild(bubble);

        // Auto-scroll to new message - IMMEDIATE scroll  
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        requestAnimationFrame(() => {
            bubble.scrollIntoView({ behavior: 'auto', block: 'end' });
        });
    }

    // ==================== SETTINGS ====================

    toggleSettings() {
        this.elements.settingsModal.classList.toggle('hidden');
        this.updateSettingsInfo();
    }

    setFontSize(size) {
        this.fontSize = parseInt(size);
        this.applySettings();
        this.saveUISettings();
    }

    setLayoutScale(scale) {
        this.layoutScale = parseInt(scale);
        this.applySettings();
        this.saveUISettings();
    }

    applySettings() {
        // Apply font size
        document.body.style.fontSize = this.fontSize + 'px';
        if (this.elements.fontSizeDisplay) {
            this.elements.fontSizeDisplay.textContent = this.fontSize + 'px';
        }
        if (this.elements.fontSizeSlider) {
            this.elements.fontSizeSlider.value = this.fontSize;
        }

        // Apply layout scale
        document.body.style.transform = `scale(${this.layoutScale / 100})`;
        document.body.style.transformOrigin = 'top left';
        document.body.style.width = `${10000 / this.layoutScale}%`;
        document.body.style.height = `${10000 / this.layoutScale}%`;

        if (this.elements.layoutScaleDisplay) {
            this.elements.layoutScaleDisplay.textContent = this.layoutScale + '%';
        }
        if (this.elements.layoutScaleSlider) {
            this.elements.layoutScaleSlider.value = this.layoutScale;
        }
    }

    saveUISettings() {
        localStorage.setItem('phonebridge_font_size', this.fontSize.toString());
        localStorage.setItem('phonebridge_layout_scale', this.layoutScale.toString());
    }

    async restartServer() {
        const btn = document.querySelector('.btn-restart');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Đang restart...';
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/restart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                this.addChatBubble('system', '🔄 Server đang khởi động lại... Vui lòng đợi 5 giây.');
                this.toggleSettings();

                // Disconnect and reconnect after delay
                this.isConnected = false;
                this.updateConnectionStatus(false);

                setTimeout(() => {
                    this.addChatBubble('system', '🔄 Đang kết nối lại...');
                    this.connect();
                }, 5000);
            } else {
                throw new Error('Restart failed');
            }
        } catch (error) {
            this.addChatBubble('system', '❌ Không thể restart server: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 Restart Server';
            }
        }
    }
}

// Initialize app
const app = new PhoneBridgeApp();
