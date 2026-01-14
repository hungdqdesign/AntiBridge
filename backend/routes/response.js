const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Store last known response
let lastResponse = '';
let lastClipboard = '';
let conversationWatcher = null;
let lastParsedResponse = '';

// Path to Antigravity conversations
const homeDir = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH;
const CONVERSATIONS_PATH = path.join(homeDir, '.gemini', 'antigravity', 'conversations');

/**
 * Parse the clipboard text to extract the last AI response
 * Antigravity chat format: alternating User/AI messages
 * @param {string} text - Full text from clipboard
 * @returns {string} - Last AI response only
 */
function parseLastAIResponse(text) {
    if (!text || text.length === 0) return '';

    // Split by common AI assistant indicators
    // Look for patterns like "Assistant:", "AI:", or message boundaries
    const lines = text.split('\n');

    // Strategy: Find the last substantial block of text that looks like an AI response
    // AI responses typically don't start with "You:", "User:", or question marks at the beginning

    let lastResponse = '';
    let currentBlock = [];
    let isAIBlock = false;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();

        // Skip empty lines at the end
        if (currentBlock.length === 0 && line === '') continue;

        // Check if this line indicates start of user message (going backwards)
        // User messages often start with specific patterns
        if (line.match(/^(You|User|Bạn|Người dùng)[\s:]*/i) ||
            line.match(/^Step Id:/i) ||
            line.match(/^<USER_REQUEST>/i)) {
            // We've reached a user message, stop
            break;
        }

        // Add to current block
        currentBlock.unshift(line);

        // If we've collected enough substantial content, consider it the AI response
        if (currentBlock.join('\n').length > 100) {
            isAIBlock = true;
        }
    }

    if (currentBlock.length > 0) {
        lastResponse = currentBlock.join('\n').trim();
    }

    // If we couldn't parse, return last 2000 chars
    if (!lastResponse && text.length > 0) {
        lastResponse = text.slice(-2000);
    }

    return lastResponse;
}

/**
 * GET /api/response
 * Get the latest AI response from clipboard
 */
router.get('/', async (req, res) => {
    try {
        // Read current clipboard content
        const clipboard = await getClipboard();

        res.json({
            success: true,
            response: clipboard,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Get response error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/response/copy
 * Auto-copy latest response from Antigravity using keyboard automation
 */
router.post('/copy', async (req, res) => {
    try {
        console.log('📋 Getting response...');

        // 1. Try AntigravityBridge (CDP/Puppeteer) first
        try {
            const bridge = req.app.locals.antigravityBridge;
            if (bridge) {
                const text = await bridge.getLastResponse();
                if (text && text.length > 0) {
                    console.log('✅ Got response from AntigravityBridge');
                    return res.json({
                        success: true,
                        response: text,
                        message: 'Đã lấy response từ Antigravity Bridge'
                    });
                } else {
                    console.log('⚠️ AntigravityBridge returned empty, falling back to clipboard...');
                }
            }
        } catch (bridgeErr) {
            console.error('⚠️ Bridge error:', bridgeErr.message);
        }

        console.log('📋 Fallback: Auto-copying from clipboard...');

        // PowerShell script to:
        // 1. Focus Antigravity window
        // 2. Click on chat area
        // 3. Select all text in chat (Ctrl+A)
        // 4. Copy to clipboard (Ctrl+C)
        const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
}

public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
"@

Add-Type -AssemblyName System.Windows.Forms

# Find Antigravity window
$antigravity = Get-Process | Where-Object { 
    $_.MainWindowTitle -like "*Antigravity*" -and 
    $_.MainWindowTitle -notlike "*Manager*" -and
    $_.MainWindowTitle -notlike "*Trình quản lý*"
} | Select-Object -First 1

if ($antigravity -and $antigravity.MainWindowHandle -ne 0) {
    $hwnd = $antigravity.MainWindowHandle
    
    # Get window rectangle
    $rect = New-Object RECT
    [Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    
    # Show and focus Antigravity
    [Win32]::ShowWindow($hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 200
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 300
    
    # Calculate center of chat area (approximately middle-right of window)
    $centerX = [int](($rect.Left + $rect.Right) / 2) + 100
    $centerY = [int](($rect.Top + $rect.Bottom) / 2)
    
    # Click on chat area to focus it
    [Win32]::SetCursorPos($centerX, $centerY) | Out-Null
    Start-Sleep -Milliseconds 100
    
    # Mouse click (left button down then up)
    [Win32]::mouse_event(0x0002, 0, 0, 0, 0) # MOUSEEVENTF_LEFTDOWN
    [Win32]::mouse_event(0x0004, 0, 0, 0, 0) # MOUSEEVENTF_LEFTUP
    Start-Sleep -Milliseconds 200
    
    # Triple-click to select paragraph/block, then Ctrl+C
    [Win32]::mouse_event(0x0002, 0, 0, 0, 0)
    [Win32]::mouse_event(0x0004, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    [Win32]::mouse_event(0x0002, 0, 0, 0, 0)
    [Win32]::mouse_event(0x0004, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    [Win32]::mouse_event(0x0002, 0, 0, 0, 0)
    [Win32]::mouse_event(0x0004, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 200
    
    # Copy
    [System.Windows.Forms.SendKeys]::SendWait("^c")
    Start-Sleep -Milliseconds 200
    
    Write-Host "SUCCESS"
} else {
    Write-Host "ERROR: Antigravity not found"
}
`;

        const psScriptPath = path.join(__dirname, '..', 'temp_copy.ps1');
        fs.writeFileSync(psScriptPath, psScript, 'utf8');

        const result = await new Promise((resolve, reject) => {
            exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`,
                { encoding: 'utf8', timeout: 15000 },
                (error, stdout, stderr) => {
                    // Xóa file tạm dù thành công hay thất bại
                    try { fs.unlinkSync(psScriptPath); } catch (e) { }

                    if (error) reject(error);
                    else resolve(stdout.trim());
                }
            );
        });

        if (result.includes('SUCCESS')) {
            // Wait a bit more for clipboard to update
            await new Promise(r => setTimeout(r, 300));

            // Read clipboard
            const clipboard = await getClipboard();
            lastResponse = clipboard;

            res.json({
                success: true,
                response: clipboard,
                message: 'Đã copy response từ Antigravity'
            });
        } else {
            throw new Error(result || 'Không thể copy response');
        }
    } catch (error) {
        console.error('❌ Copy response error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/response/watch
 * Start watching for new responses
 */
router.get('/watch', async (req, res) => {
    try {
        // Find the most recently modified conversation file
        const files = fs.readdirSync(CONVERSATIONS_PATH)
            .filter(f => f.endsWith('.pb'))
            .map(f => ({
                name: f,
                path: path.join(CONVERSATIONS_PATH, f),
                mtime: fs.statSync(path.join(CONVERSATIONS_PATH, f)).mtime
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
            const latestFile = files[0];
            res.json({
                success: true,
                latestConversation: latestFile.name,
                lastModified: latestFile.mtime.toISOString(),
                conversationsPath: CONVERSATIONS_PATH
            });
        } else {
            res.json({
                success: false,
                message: 'No conversation files found'
            });
        }
    } catch (error) {
        console.error('❌ Watch error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/response/clipboard
 * Get current clipboard content
 */
router.get('/clipboard', async (req, res) => {
    try {
        const clipboard = await getClipboard();
        const isNew = clipboard !== lastClipboard;
        lastClipboard = clipboard;

        res.json({
            success: true,
            content: clipboard,
            isNew: isNew,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to get clipboard content
function getClipboard() {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'powershell -Command "Get-Clipboard"' : 'pbpaste';
        
        exec(cmd,
            { encoding: 'utf8', timeout: 5000 },
            (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout.trim());
            }
        );
    });
}

/**
 * POST /api/response/start-watch
 * Start watching conversations for new responses
 */
router.post('/start-watch', async (req, res) => {
    try {
        const { sessionId } = req.body;
        const watcher = req.app.locals.conversationWatcher;

        if (!watcher) {
            return res.status(500).json({
                success: false,
                error: 'ConversationWatcher not initialized'
            });
        }

        // Start watching
        watcher.start(sessionId, 1000); // Poll every 1 second

        res.json({
            success: true,
            message: 'ConversationWatcher started',
            info: 'Sẽ gửi notification qua WebSocket khi file .pb thay đổi'
        });
    } catch (error) {
        console.error('❌ Start watch error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/response/stop-watch
 * Stop watching conversations
 */
router.post('/stop-watch', async (req, res) => {
    try {
        const watcher = req.app.locals.conversationWatcher;

        if (watcher) {
            watcher.stop();
        }

        res.json({
            success: true,
            message: 'ConversationWatcher stopped'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// NEW: Chat Extraction from Iframe (BREAKTHROUGH!)
// ============================================================

/**
 * GET /api/response/chat
 * Lấy toàn bộ chat hiện tại từ Antigravity iframe
 */
router.get('/chat', async (req, res) => {
    try {
        const bridge = req.app.locals.antigravityBridge;

        if (!bridge) {
            return res.status(500).json({
                success: false,
                error: 'AntigravityBridge not initialized'
            });
        }

        // Ensure connected
        if (!bridge.isConnected) {
            const connected = await bridge.connect();
            if (!connected) {
                return res.status(500).json({
                    success: false,
                    error: 'Cannot connect to Antigravity. Make sure it is running with debug mode.'
                });
            }
        }

        const messages = await bridge.extractChatFromIframe();

        res.json({
            success: true,
            messages: messages,
            count: messages.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Chat extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/response/start-chat-polling
 * Bắt đầu polling chat từ iframe và stream qua WebSocket
 */
router.post('/start-chat-polling', async (req, res) => {
    try {
        const { sessionId, intervalMs = 2000 } = req.body;
        const bridge = req.app.locals.antigravityBridge;

        if (!bridge) {
            return res.status(500).json({
                success: false,
                error: 'AntigravityBridge not initialized'
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId is required'
            });
        }

        // Ensure connected
        if (!bridge.isConnected) {
            const connected = await bridge.connect();
            if (!connected) {
                return res.status(500).json({
                    success: false,
                    error: 'Cannot connect to Antigravity'
                });
            }
        }

        // Start polling
        bridge.startChatPolling(sessionId, intervalMs);

        res.json({
            success: true,
            message: `Chat polling started for session ${sessionId}`,
            intervalMs: intervalMs,
            info: 'New messages will be sent via WebSocket event "chat_update"'
        });
    } catch (error) {
        console.error('❌ Start chat polling error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/response/stop-chat-polling
 * Dừng polling chat
 */
router.post('/stop-chat-polling', async (req, res) => {
    try {
        const bridge = req.app.locals.antigravityBridge;

        if (bridge) {
            bridge.stopChatPolling();
        }

        res.json({
            success: true,
            message: 'Chat polling stopped'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// NEW: Chat Log Viewing API
// ============================================================

const ChatLogger = require('../services/ChatLogger');
const chatLogger = new ChatLogger();

/**
 * GET /api/response/logs
 * Lấy log của ngày hiện tại
 */
router.get('/logs', async (req, res) => {
    try {
        const logs = chatLogger.getLogHistory();
        const files = chatLogger.getLogFiles();

        res.json({
            success: true,
            date: new Date().toISOString().split('T')[0],
            count: logs.length,
            messages: logs,
            availableFiles: files
        });
    } catch (error) {
        console.error('❌ Get logs error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/response/logs/:date
 * Lấy log của ngày cụ thể (format: YYYY-MM-DD)
 */
router.get('/logs/:date', async (req, res) => {
    try {
        const { date } = req.params;

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        const logs = chatLogger.getLogHistory(date);

        res.json({
            success: true,
            date: date,
            count: logs.length,
            messages: logs
        });
    } catch (error) {
        console.error('❌ Get logs error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/response/logs-full/:date?
 * Lấy log đầy đủ dạng JSONL (cho debugging)
 */
router.get('/logs-full/:date?', async (req, res) => {
    try {
        const { date } = req.params;
        const logs = chatLogger.getFullLogHistory(date || null);

        res.json({
            success: true,
            date: date || new Date().toISOString().split('T')[0],
            count: logs.length,
            messages: logs
        });
    } catch (error) {
        console.error('❌ Get full logs error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
