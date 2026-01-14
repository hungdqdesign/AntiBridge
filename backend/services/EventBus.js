/**
 * EventBus - WebSocket Event Broadcasting Service
 * Manages real-time event delivery to connected clients
 */

class EventBus {
    constructor(wss) {
        this.wss = wss;
        // Map: sessionId -> Set<WebSocket>
        this.clients = new Map();
    }

    /**
     * Add a client to a session
     */
    addClient(sessionId, ws) {
        if (!this.clients.has(sessionId)) {
            this.clients.set(sessionId, new Set());
        }
        this.clients.get(sessionId).add(ws);
    }

    /**
     * Remove a client from a session
     */
    removeClient(sessionId, ws) {
        const sessionClients = this.clients.get(sessionId);
        if (sessionClients) {
            sessionClients.delete(ws);
            if (sessionClients.size === 0) {
                this.clients.delete(sessionId);
            }
        }
    }

    /**
     * Emit an event to all clients in a session
     * @param {string} sessionId - Target session
     * @param {string} type - Event type (terminal, log, plan, chat_token, diff_update, approval_request, status, error)
     * @param {object} data - Event data
     */
    emit(sessionId, type, data) {
        const event = {
            type,
            data,
            ts: new Date().toISOString()
        };

        const sessionClients = this.clients.get(sessionId);
        if (!sessionClients || sessionClients.size === 0) {
            console.log(`⚠️ EventBus: No clients for session ${sessionId}`);
            return;
        }

        const message = JSON.stringify(event);
        let sentCount = 0;

        sessionClients.forEach((ws) => {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
                sentCount++;
            }
        });

        console.log(`📤 EventBus: [${type}] sent to ${sentCount} client(s) in session ${sessionId}`);
    }

    /**
     * Broadcast to all sessions
     */
    broadcast(type, data) {
        this.clients.forEach((_, sessionId) => {
            this.emit(sessionId, type, data);
        });
    }

    /**
     * Get connected client count for a session
     */
    getClientCount(sessionId) {
        return this.clients.get(sessionId)?.size || 0;
    }

    /**
     * Get all active session IDs
     */
    getActiveSessions() {
        return Array.from(this.clients.keys());
    }
}

module.exports = EventBus;
