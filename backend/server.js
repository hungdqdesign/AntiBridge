/**
 * AntiBridge v1.2.0 - Web Control for Antigravity
 * Backend Server - Express + WebSocket
 * 
 * Author: Linh Bui (linhbq82@gmail.com)
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import routes
const sessionRoutes = require('./routes/session');
const chatRoutes = require('./routes/chat');
const approveRoutes = require('./routes/approve');
const diffRoutes = require('./routes/diff');

// Import services
const SessionStore = require('./services/SessionStore');
const EventBus = require('./services/EventBus');
const AntigravityBridge = require('./services/AntigravityBridge');
const ConversationWatcher = require('./services/ConversationWatcher');
const messageLogger = require('./services/MessageLogger');

// Configuration
const PORT = process.env.PORT || 8000;
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Initialize services
const sessionStore = new SessionStore();
const eventBus = new EventBus(wss);
const antigravityBridge = new AntigravityBridge(eventBus);
const conversationWatcher = new ConversationWatcher(eventBus);

// Make services available to routes
app.locals.sessionStore = sessionStore;
app.locals.eventBus = eventBus;
app.locals.antigravityBridge = antigravityBridge;
app.locals.conversationWatcher = conversationWatcher;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(FRONTEND_PATH));

// API Routes
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/approve', approveRoutes);
app.use('/api/diff', diffRoutes);
app.use('/api/restart', require('./routes/restart'));
app.use('/api/response', require('./routes/response'));
app.use('/api/debug', require('./routes/debug'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        version: '1.2.0',
        timestamp: new Date().toISOString(),
        sessions: sessionStore.count()
    });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';

    // ===== HANDLE BRIDGE CONNECTION (from Antigravity console script) =====
    if (urlPath === '/ws/bridge') {
        console.log('🌉 WebSocket: Bridge client connected (Antigravity)');

        ws.isBridge = true;

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'bridge_register') {
                    console.log('✅ Bridge registered from:', message.source);
                    ws.send(JSON.stringify({ type: 'bridge_registered', status: 'ok' }));
                    app.locals.bridgeWs = ws;
                    console.log('📌 Bridge WebSocket saved');
                    return;
                }

                if (message.type === 'ai_messages' && message.messages) {
                    console.log(`📨 Bridge: Received ${message.messages.length} AI messages`);

                    // Separate streaming vs complete messages
                    const streamingMsgs = message.messages.filter(m => m.isStreaming);
                    const completeMsgs = message.messages.filter(m => m.isComplete);

                    // Forward to ALL connected clients
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN && !client.isBridge) {
                            // Send streaming updates
                            if (streamingMsgs.length > 0) {
                                client.send(JSON.stringify({
                                    type: 'chat_update',
                                    data: {
                                        messages: streamingMsgs.map(m => ({
                                            role: m.role || 'assistant',
                                            text: m.text,
                                            html: m.html,
                                            format: m.html ? 'html' : 'text',
                                            timestamp: m.timestamp
                                        })),
                                        partial: true,
                                        source: 'bridge'
                                    },
                                    ts: new Date().toISOString()
                                }));
                            }

                            // Send complete messages
                            completeMsgs.forEach(m => {
                                client.send(JSON.stringify({
                                    type: 'chat_complete',
                                    data: {
                                        content: m.text,
                                        html: m.html,
                                        format: m.html ? 'html' : 'text',
                                        role: m.role || 'assistant',
                                        timestamp: m.timestamp,
                                        source: 'bridge'
                                    },
                                    ts: new Date().toISOString()
                                }));
                            });
                        }
                    });

                    // Log messages
                    if (streamingMsgs.length > 0) {
                        messageLogger.logStreaming(streamingMsgs);
                    }
                    completeMsgs.forEach(m => messageLogger.logComplete(m));

                    console.log(`✅ Forwarded: streaming=${streamingMsgs.length}, complete=${completeMsgs.length}`);
                }
            } catch (err) {
                console.error('❌ Bridge message error:', err.message);
            }
        });

        ws.on('close', () => {
            console.log('👋 Bridge client disconnected');
        });

        return;
    }

    // ===== HANDLE REGULAR SESSION CONNECTION =====
    const match = urlPath.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);

    if (!match) {
        console.log('❌ WebSocket: Invalid connection URL:', urlPath);
        ws.close(4000, 'Invalid session URL');
        return;
    }

    const sessionId = match[1];
    console.log(`🔌 WebSocket: Client connected to session ${sessionId}`);

    // Register client with EventBus
    eventBus.addClient(sessionId, ws);

    // Send welcome message
    eventBus.emit(sessionId, 'status', {
        message: 'Connected to AntiBridge',
        session_id: sessionId
    });

    // ===== SYNC HISTORY =====
    try {
        const history = messageLogger.getRecentHistory(50);
        if (history.length > 0) {
            console.log(`📂 Sending ${history.length} history messages to client`);
            history.forEach(msg => {
                ws.send(JSON.stringify({
                    type: 'chat_complete',
                    data: {
                        content: msg.text,
                        html: msg.html,
                        format: msg.format || 'text',
                        role: msg.role,
                        timestamp: msg.timestamp,
                        source: 'history'
                    }
                }));
            });
        }
    } catch (err) {
        console.error('❌ Error sending history:', err.message);
    }

    // ===== AUTO-START CHAT POLLING =====
    (async () => {
        try {
            const connected = await antigravityBridge.connect();
            if (connected) {
                console.log(`🚀 Auto-starting chat polling for session ${sessionId}`);
                antigravityBridge.startChatPolling(sessionId);
            } else {
                console.log(`⚠️ CDP not available, chat polling not started`);
                eventBus.emit(sessionId, 'status', {
                    message: 'Warning: CDP not connected. AI responses may not be received.',
                    type: 'warning'
                });
            }
        } catch (err) {
            console.error('❌ Auto-start chat polling error:', err.message);
        }
    })();

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            // Handle ping/pong for keepalive
            if (message.type === 'ping') {
                ws.send('pong');
                return;
            }

            console.log(`📨 WebSocket: Received from ${sessionId} [${message.type}]`);

            // Handle Send Message
            if (message.type === 'send_message' && message.text) {
                console.log(`💬 User sent message: "${message.text.substring(0, 50)}..."`);

                // 1. Save to History
                messageLogger.saveHistory('user', message.text, null);

                // 2. Broadcast to ALL clients (SYNC)
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && !client.isBridge) {
                        client.send(JSON.stringify({
                            type: 'chat_complete',
                            data: {
                                content: message.text,
                                role: 'user',
                                timestamp: new Date().toISOString(),
                                source: 'sync'
                            }
                        }));
                    }
                });

                // 3. Inject to Antigravity
                (async () => {
                    const bridgeWs = app.locals.bridgeWs;

                    ws.send(JSON.stringify({ type: 'status', message: '🚀 Processing...', level: 'info' }));

                    // Inject Text via Bridge WebSocket
                    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'status', message: '📝 Injecting text...', level: 'info' }));
                        bridgeWs.send(JSON.stringify({ type: 'inject_message', text: message.text }));
                    } else {
                        ws.send(JSON.stringify({ type: 'status', message: '⚠️ Bridge WS not connected', level: 'warning' }));
                    }

                    // Press Enter via CDP
                    setTimeout(async () => {
                        if (antigravityBridge.isConnected) {
                            ws.send(JSON.stringify({ type: 'status', message: '⌨️ Pressing ENTER...', level: 'info' }));
                            const enterResult = await antigravityBridge.simulateEnterKey();

                            if (enterResult) {
                                ws.send(JSON.stringify({ type: 'status', message: '✅ Message sent!', level: 'success' }));
                            } else {
                                ws.send(JSON.stringify({ type: 'status', message: '❌ ENTER key failed', level: 'error' }));
                            }
                        } else {
                            ws.send(JSON.stringify({ type: 'status', message: '⚠️ CDP not connected', level: 'warning' }));
                        }
                    }, 500);

                })();
            }
        } catch (err) {
            console.error('❌ WebSocket: Invalid message format:', err.message);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        console.log(`👋 WebSocket: Client disconnected from session ${sessionId}`);
        eventBus.removeClient(sessionId, ws);
    });

    // Handle errors
    ws.on('error', (err) => {
        console.error(`❌ WebSocket error for session ${sessionId}:`, err.message);
    });
});

// Get local IP addresses
function getLocalIPs() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({
                    name: name,
                    address: iface.address
                });
            }
        }
    }
    return ips;
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
    const localIPs = getLocalIPs();
    const primaryIP = localIPs.length > 0 ? localIPs[0].address : 'N/A';

    console.log(`
╔════════════════════════════════════════════════════════════╗
║              AntiBridge v1.2.0 - Web Control               ║
╠════════════════════════════════════════════════════════════╣
║  🖥️  Local:       http://localhost:${PORT}                    ║
║  🌐 Network:     http://${primaryIP}:${PORT}                   ║
║  🔌 WebSocket:   ws://${primaryIP}:${PORT}/ws/{session_id}     ║
╠════════════════════════════════════════════════════════════╣
║  📱 Để truy cập từ thiết bị khác (điện thoại, máy khác):   ║
║     Mở trình duyệt và nhập: http://${primaryIP}:${PORT}        ║
╚════════════════════════════════════════════════════════════╝
    `);

    // Show all available IPs if multiple
    if (localIPs.length > 1) {
        console.log('📡 Tất cả địa chỉ IP khả dụng:');
        localIPs.forEach((ip, index) => {
            console.log(`   ${index + 1}. ${ip.name}: http://${ip.address}:${PORT}`);
        });
        console.log('');
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    sessionStore.close();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, wss };
