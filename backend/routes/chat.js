/**
 * Chat Routes
 * POST /api/chat - Send a chat message with configurable send mode
 * GET /api/chat/:session_id - Get chat history
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/chat
 * Send a chat message to Antigravity
 * Body: { session_id: "abc123", message: "Create a TODO app...", send_mode?: "clipboard"|"cdp" }
 * 
 * send_mode options:
 * - "clipboard" (default): Stable PowerShell clipboard method
 * - "cdp": Experimental CDP/Bridge method with clipboard fallback
 */
router.post('/', async (req, res) => {
    try {
        const { session_id, message, send_mode = 'clipboard' } = req.body;

        if (!session_id || !message) {
            return res.status(400).json({
                error: 'session_id and message are required'
            });
        }

        const sessionStore = req.app.locals.sessionStore;
        const eventBus = req.app.locals.eventBus;

        // Verify session exists
        const session = sessionStore.getSession(session_id);
        if (!session) {
            return res.status(404).json({
                error: 'Session not found'
            });
        }

        // Store user message
        sessionStore.addMessage(session_id, 'user', message);

        // Emit user message event
        eventBus.emit(session_id, 'chat_token', {
            role: 'user',
            token: message,
            complete: true
        });

        console.log(`💬 Chat: User message in session ${session_id} [mode=${send_mode}]: "${message.substring(0, 50)}..."`);

        // Helper function for clipboard method (PowerShell for Win, AppleScript for Mac)
        const sendViaClipboard = () => {
            const isWin = process.platform === 'win32';
            console.log(`📋 Sending via ${isWin ? 'PowerShell' : 'AppleScript'} clipboard...`);

            const { exec } = require('child_process');
            const fs = require('fs');
            const path = require('path');

            // 1. Copy to clipboard
            const copyCmd = isWin ? 'clip' : 'pbcopy';
            const copyProcess = exec(copyCmd, (err) => {
                if (err) console.error('Clipboard error:', err.message);
            });
            copyProcess.stdin.write(message);
            copyProcess.stdin.end();

            if (isWin) {
                // Windows: PowerShell script
                const psScriptPath = path.join(__dirname, '..', 'temp_paste.ps1');
                const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*Antigravity*' -and $_.MainWindowTitle -notlike '*Manager*' } | Select-Object -First 1

if ($proc) {
    [Win32]::ShowWindow($proc.MainWindowHandle, 9)
    [Win32]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Host "OK"
} else {
    Write-Host "Antigravity not found"
}
`;
                fs.writeFileSync(psScriptPath, psScript, 'utf8');
                exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err, stdout, stderr) => {
                    if (err) console.error('❌ SendKeys error:', err.message);
                    else console.log('✅ Đã gửi message qua PowerShell!', stdout.trim());
                    try { fs.unlinkSync(psScriptPath); } catch (e) { }
                });
            } else {
                // Mac: AppleScript
                const appleScript = `
                    tell application "System Events"
                        try
                            set frontmost of process "Antigravity" to true
                            delay 0.5
                            keystroke "v" using {command down}
                            delay 0.3
                            key code 36
                            return "OK"
                        on error err
                            return "Error: " & err
                        end try
                    end tell
                `;
                exec(`osascript -e '${appleScript}'`, (err, stdout, stderr) => {
                    if (err) console.error('❌ AppleScript error:', err.message);
                    else console.log('✅ Đã gửi message qua AppleScript!', stdout.trim());
                });
            }

            return { ok: true, method: 'clipboard' };
        };

        // ========== MODE: CLIPBOARD (ổn định - default) ==========
        if (send_mode === 'clipboard') {
            const result = sendViaClipboard();
            return res.json(result);
        }

        // ========== MODE: CDP (background - dùng CDP Frames API) ==========
        if (send_mode === 'cdp') {
            const antigravityBridge = req.app.locals.antigravityBridge;

            // Thử CDP Frame method (BACKGROUND - không cần focus window!)
            if (antigravityBridge) {
                try {
                    // Đảm bảo connected trước
                    if (!antigravityBridge.isConnected) {
                        console.log('🔄 CDP chưa connect, đang kết nối...');
                        await antigravityBridge.connect();
                    }

                    const sent = await antigravityBridge.sendMessage(session_id, message);
                    if (sent) {
                        console.log('✅ Đã gửi message qua CDP Frame (background)!');
                        return res.json({ ok: true, method: 'cdp_frame' });
                    }
                } catch (cdpErr) {
                    console.log('⚠️ CDP Frame failed:', cdpErr.message);
                }
            } else {
                console.log('⚠️ antigravityBridge không khả dụng');
            }

            // Fallback về clipboard nếu CDP fail
            console.log('⚠️ CDP không khả dụng, fallback về clipboard...');
            const result = sendViaClipboard();
            return res.json({ ...result, fallback: true });
        }

        // Mode không hợp lệ - dùng clipboard
        console.log(`⚠️ Unknown send_mode: ${send_mode}, using clipboard...`);
        const result = sendViaClipboard();
        return res.json(result);
    } catch (err) {
        console.error('❌ Chat error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/chat/:session_id
 * Get chat history for a session
 */
router.get('/:session_id', (req, res) => {
    try {
        const { session_id } = req.params;
        const { limit = 100 } = req.query;

        const sessionStore = req.app.locals.sessionStore;

        // Verify session exists
        const session = sessionStore.getSession(session_id);
        if (!session) {
            return res.status(404).json({
                error: 'Session not found'
            });
        }

        const messages = sessionStore.getMessages(session_id, parseInt(limit));

        res.json({
            session_id,
            messages
        });
    } catch (err) {
        console.error('❌ Failed to get chat history:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
