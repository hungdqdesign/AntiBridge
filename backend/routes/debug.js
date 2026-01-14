/**
 * Debug Routes
 * API để debug Antigravity Bridge
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Đường dẫn lưu debug logs
const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

/**
 * GET /api/debug/dump
 * Dump HTML của page hiện tại
 */
router.get('/dump', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        if (!antigravityBridge) {
            return res.status(500).json({ error: 'Bridge not initialized' });
        }

        const html = await antigravityBridge.dumpPageSource();

        // Save to file
        const timestamp = Date.now();
        const filename = `dump_${timestamp}.html`;
        const filepath = path.join(LOG_DIR, filename);
        fs.writeFileSync(filepath, html, 'utf8');

        res.json({
            ok: true,
            file: filename,
            path: filepath,
            size: html.length
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/debug/chatlog
 * Lấy chat log hiện tại từ DOM
 */
router.get('/chatlog', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        const log = await antigravityBridge.getChatLog();
        res.json({ log });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/debug/extract
 * Test extraction trực tiếp - xem CDP đang extract được gì
 */
router.get('/extract', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        if (!antigravityBridge) {
            return res.status(500).json({ error: 'Bridge not initialized' });
        }

        // Test extraction
        const messages = await antigravityBridge.extractChatFromIframe();

        res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            isConnected: antigravityBridge.isConnected,
            messageCount: messages.length,
            messages: messages.slice(0, 10).map(m => ({
                role: m.role,
                textPreview: m.text?.substring(0, 100) + (m.text?.length > 100 ? '...' : ''),
                textLength: m.text?.length,
                class: m.class,
                method: m.method
            })),
            hashCacheSize: antigravityBridge.lastMessageHashes?.size || 0,
            isStreaming: antigravityBridge.isStreaming,
            stableCount: antigravityBridge.stableCount
        });

    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

/**
 * POST /api/debug/clear-cache
 * Xóa hash cache để re-detect tất cả messages
 */
router.post('/clear-cache', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        if (antigravityBridge && antigravityBridge.lastMessageHashes) {
            antigravityBridge.lastMessageHashes.clear();
            antigravityBridge.streamBuffer = '';
            antigravityBridge.stableCount = 0;
            res.json({ ok: true, message: 'Cache cleared' });
        } else {
            res.status(400).json({ error: 'No cache to clear' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/debug/frames
 * Liệt kê tất cả frames để debug
 */
router.get('/frames', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        if (!antigravityBridge || !antigravityBridge.page) {
            return res.status(500).json({ error: 'Page not connected' });
        }

        const frames = antigravityBridge.page.frames();
        const frameInfo = [];

        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            try {
                const url = frame.url();
                // Try to get some text content from the frame
                let textSample = '';
                try {
                    textSample = await frame.evaluate(() => {
                        // Get first 500 chars of body text
                        return document.body?.innerText?.substring(0, 500) || 'no body';
                    });
                } catch (e) {
                    textSample = `Error: ${e.message}`;
                }

                frameInfo.push({
                    index: i,
                    url: url.substring(0, 100),
                    textSample: textSample.substring(0, 200)
                });
            } catch (e) {
                frameInfo.push({ index: i, error: e.message });
            }
        }

        res.json({
            ok: true,
            frameCount: frames.length,
            frames: frameInfo
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/debug/raw-chat
 * Extract raw text từ frame chat (extension frame)
 */
router.get('/raw-chat', async (req, res) => {
    try {
        const { antigravityBridge } = req.app.locals;
        if (!antigravityBridge || !antigravityBridge.page) {
            return res.status(500).json({ error: 'Page not connected' });
        }

        const frames = antigravityBridge.page.frames();
        const results = [];

        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const url = frame.url();

            // Skip empty frames
            if (!url || url === 'about:blank') continue;

            // Chỉ quan tâm frame extension (chứa chat)
            if (url.includes('extension')) {
                try {
                    const content = await frame.evaluate(() => {
                        // Lấy toàn bộ innerText của body
                        return document.body?.innerText || '';
                    });

                    results.push({
                        frameIndex: i,
                        url: url.substring(0, 100),
                        contentLength: content.length,
                        content: content.substring(0, 2000) + (content.length > 2000 ? '...' : '')
                    });
                } catch (e) {
                    results.push({ frameIndex: i, error: e.message });
                }
            }
        }

        res.json({
            ok: true,
            timestamp: new Date().toISOString(),
            frameCount: frames.length,
            chatFrames: results
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
