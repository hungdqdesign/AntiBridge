/**
 * MessageLogger - Ghi log và Quản lý lịch sử chat
 * Log file structure:
 * - logs/messages_YYYY-MM-DD.log: Log debug chi tiết
 * - data/chat_history.jsonl: Lịch sử chat (JSON Lines) để load lại
 */

const fs = require('fs');
const path = require('path');

class MessageLogger {
    constructor() {
        this.logDir = 'D:\\01_BUILD_APP\\REMOTE_AGENT\\log_debug';
        this.dataDir = 'D:\\01_BUILD_APP\\REMOTE_AGENT\\data';

        this.ensureDir(this.logDir);
        this.ensureDir(this.dataDir);

        this.historyFile = path.join(this.dataDir, 'chat_history.jsonl');
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    getLogFilePath() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `messages_${today}.log`);
    }

    /**
     * Lưu tin nhắn vào lịch sử (JSONL) để load lại
     */
    saveHistory(role, text, html = null) {
        if (!text) return;

        const entry = {
            timestamp: new Date().toISOString(),
            role: role,
            text: text,
            html: html, // Optional: Lưu HTML nếu cần render bảng/markdown gốc
            format: html ? 'html' : 'text'
        };

        const line = JSON.stringify(entry) + '\n';

        try {
            fs.appendFileSync(this.historyFile, line, 'utf8');
        } catch (err) {
            console.error('❌ Failed to save chat history:', err.message);
        }

        // Cũng log vào debug log
        this.logMessage('history_save', entry, 'server');
    }

    /**
     * Lấy lịch sử chat gần nhất
     */
    getRecentHistory(limit = 50) {
        if (!fs.existsSync(this.historyFile)) return [];

        try {
            const data = fs.readFileSync(this.historyFile, 'utf8');
            const lines = data.split('\n').filter(line => line.trim());
            const history = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(item => item !== null);

            return history.slice(-limit);
        } catch (err) {
            console.error('❌ Failed to read chat history:', err.message);
            return [];
        }
    }

    // === DEBUG LOGGING ===

    logMessage(type, data, source = 'unknown') {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${type}] [${source}]\n${JSON.stringify(data, null, 2)}\n${'─'.repeat(60)}\n\n`;

        try {
            fs.appendFileSync(this.getLogFilePath(), logLine, 'utf8');
        } catch (err) { /* ignore */ }
    }

    logStreaming(messages) {
        // Chỉ log debug, không save history (chỉ save complete)
        this.logMessage('chat_update', { count: messages.length }, 'bridge');
    }

    logComplete(message) {
        // Save history khi tin nhắn hoàn tất
        this.saveHistory(message.role, message.text, message.html);
        this.logMessage('chat_complete', message, 'bridge');
    }
}

module.exports = new MessageLogger();
