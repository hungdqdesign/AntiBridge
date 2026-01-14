/**
 * File Watcher - Theo dõi file .pb để detect message mới
 * Khi AI trả lời, file sẽ được update
 * Gửi notification về PWA khi detect thay đổi
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class ConversationWatcher extends EventEmitter {
    constructor(eventBus) {
        super();
        this.eventBus = eventBus;
        const homeDir = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH;
        this.conversationsPath = path.join(homeDir, '.gemini', 'antigravity', 'conversations');
        this.watching = false;
        this.lastFileState = new Map(); // filename -> {size, mtime}
        this.pollInterval = null;
    }

    /**
     * Bắt đầu theo dõi conversations
     */
    start(sessionId, pollMs = 1000) {
        if (this.watching) return;

        console.log('👀 ConversationWatcher: Bắt đầu theo dõi...');
        this.watching = true;
        this.sessionId = sessionId;

        // Lấy state ban đầu
        this._updateFileStates();

        // Poll định kỳ
        this.pollInterval = setInterval(() => {
            this._checkForChanges();
        }, pollMs);
    }

    /**
     * Dừng theo dõi
     */
    stop() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.watching = false;
        console.log('🛑 ConversationWatcher: Đã dừng');
    }

    /**
     * Cập nhật state của các file
     */
    _updateFileStates() {
        try {
            const files = fs.readdirSync(this.conversationsPath)
                .filter(f => f.endsWith('.pb'));

            for (const filename of files) {
                const filepath = path.join(this.conversationsPath, filename);
                const stats = fs.statSync(filepath);
                this.lastFileState.set(filename, {
                    size: stats.size,
                    mtime: stats.mtime.getTime()
                });
            }
        } catch (err) {
            console.error('❌ ConversationWatcher error:', err.message);
        }
    }

    /**
     * Kiểm tra thay đổi
     */
    _checkForChanges() {
        try {
            const files = fs.readdirSync(this.conversationsPath)
                .filter(f => f.endsWith('.pb'));

            for (const filename of files) {
                const filepath = path.join(this.conversationsPath, filename);
                const stats = fs.statSync(filepath);
                const lastState = this.lastFileState.get(filename);

                if (lastState) {
                    // Check if file changed
                    if (stats.size !== lastState.size || stats.mtime.getTime() !== lastState.mtime) {
                        const sizeDiff = stats.size - lastState.size;

                        console.log(`📝 File changed: ${filename}`);
                        console.log(`   Size: ${lastState.size} → ${stats.size} (${sizeDiff > 0 ? '+' : ''}${sizeDiff} bytes)`);

                        // Emit event
                        this.emit('conversation_update', {
                            filename,
                            oldSize: lastState.size,
                            newSize: stats.size,
                            sizeDiff,
                            mtime: stats.mtime.toISOString()
                        });

                        // Gửi notification qua WebSocket
                        if (this.eventBus && this.sessionId) {
                            this.eventBus.emit(this.sessionId, 'response_update', {
                                type: 'new_content',
                                message: sizeDiff > 1000
                                    ? '🤖 AI đang trả lời... (có thể nhiều nội dung mới)'
                                    : '💬 Có cập nhật mới trong conversation',
                                sizeDiff,
                                timestamp: new Date().toISOString()
                            });
                        }

                        // Update state
                        this.lastFileState.set(filename, {
                            size: stats.size,
                            mtime: stats.mtime.getTime()
                        });
                    }
                } else {
                    // New file
                    this.lastFileState.set(filename, {
                        size: stats.size,
                        mtime: stats.mtime.getTime()
                    });
                }
            }
        } catch (err) {
            console.error('❌ ConversationWatcher check error:', err.message);
        }
    }

    /**
     * Lấy file conversation mới nhất
     */
    getLatestConversation() {
        try {
            const files = fs.readdirSync(this.conversationsPath)
                .filter(f => f.endsWith('.pb'))
                .map(f => ({
                    name: f,
                    path: path.join(this.conversationsPath, f),
                    mtime: fs.statSync(path.join(this.conversationsPath, f)).mtime
                }))
                .sort((a, b) => b.mtime - a.mtime);

            return files[0] || null;
        } catch (err) {
            console.error('❌ getLatestConversation error:', err.message);
            return null;
        }
    }
}

module.exports = ConversationWatcher;
