/**
 * SessionStore - JSON File-based Session Management
 * Pure CommonJS implementation - no external dependencies for storage
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class SessionStore {
    constructor(dbPath = null) {
        const defaultPath = path.join(__dirname, '..', 'db', 'sessions.json');
        this.dbPath = dbPath || defaultPath;

        // Ensure db directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this._loadData();
        console.log('✅ SessionStore: Database initialized at', this.dbPath);
    }

    _loadData() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const content = fs.readFileSync(this.dbPath, 'utf8');
                this.data = JSON.parse(content);
            } else {
                this.data = { sessions: [], messages: [], approvals: [] };
                this._saveData();
            }
        } catch (err) {
            console.error('❌ SessionStore: Failed to load data:', err.message);
            this.data = { sessions: [], messages: [], approvals: [] };
        }
    }

    _saveData() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            console.error('❌ SessionStore: Failed to save data:', err.message);
        }
    }

    // ==================== SESSION METHODS ====================

    /**
     * Create a new session
     */
    createSession(repoPath) {
        const id = uuidv4().substring(0, 8);
        const branchName = `agent/${id}`;

        const session = {
            id,
            repo_path: repoPath,
            branch_name: branchName,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        this.data.sessions.push(session);
        this._saveData();

        return session;
    }

    /**
     * Get session by ID
     */
    getSession(id) {
        return this.data.sessions.find(s => s.id === id);
    }

    /**
     * Get all sessions
     */
    getAllSessions() {
        return [...this.data.sessions].sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );
    }

    /**
     * Update session status
     */
    updateSessionStatus(id, status) {
        const session = this.data.sessions.find(s => s.id === id);
        if (session) {
            session.status = status;
            session.updated_at = new Date().toISOString();
            this._saveData();
        }
        return session;
    }

    /**
     * Count active sessions
     */
    count() {
        return this.data.sessions.filter(s => s.status === 'active').length;
    }

    // ==================== MESSAGE METHODS ====================

    /**
     * Add a message to session history
     */
    addMessage(sessionId, role, content) {
        const message = {
            id: this.data.messages.length + 1,
            session_id: sessionId,
            role,
            content,
            created_at: new Date().toISOString()
        };

        this.data.messages.push(message);
        this._saveData();

        return message;
    }

    /**
     * Get messages for a session
     */
    getMessages(sessionId, limit = 100) {
        return this.data.messages
            .filter(m => m.session_id === sessionId)
            .slice(-limit);
    }

    // ==================== APPROVAL METHODS ====================

    /**
     * Create a new approval request
     */
    createApproval(sessionId, { title, details, command, risk }) {
        const id = `appr_${uuidv4().substring(0, 8)}`;

        const approval = {
            id,
            session_id: sessionId,
            title,
            details,
            command,
            risk,
            status: 'pending',
            decided_at: null,
            created_at: new Date().toISOString()
        };

        this.data.approvals.push(approval);
        this._saveData();

        return approval;
    }

    /**
     * Get approval by ID
     */
    getApproval(id) {
        return this.data.approvals.find(a => a.id === id);
    }

    /**
     * Get pending approvals for a session
     */
    getPendingApprovals(sessionId) {
        return this.data.approvals.filter(
            a => a.session_id === sessionId && a.status === 'pending'
        );
    }

    /**
     * Decide on an approval (accept/reject)
     */
    decideApproval(id, decision) {
        const approval = this.data.approvals.find(a => a.id === id);
        if (approval) {
            approval.status = decision;
            approval.decided_at = new Date().toISOString();
            this._saveData();
        }
        return approval;
    }

    // ==================== CLEANUP ====================

    /**
     * Close database connection (no-op for file-based)
     */
    close() {
        console.log('✅ SessionStore: Database closed');
    }
}

module.exports = SessionStore;
