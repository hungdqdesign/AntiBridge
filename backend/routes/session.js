/**
 * Session Routes
 * POST /api/session - Create new session
 * GET /api/session/:id - Get session info
 * GET /api/session - List all sessions
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/session
 * Create a new session
 * Body: { repo_path: "/absolute/path/to/repo" }
 */
router.post('/', (req, res) => {
    try {
        const { repo_path } = req.body;

        if (!repo_path) {
            return res.status(400).json({
                error: 'repo_path is required'
            });
        }

        const sessionStore = req.app.locals.sessionStore;
        const session = sessionStore.createSession(repo_path);

        console.log(`✅ Session created: ${session.id} for ${repo_path}`);

        res.json({
            session_id: session.id,
            branch_name: session.branch_name,
            status: session.status,
            created_at: session.created_at
        });
    } catch (err) {
        console.error('❌ Failed to create session:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/session/:id
 * Get session details
 */
router.get('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const sessionStore = req.app.locals.sessionStore;

        const session = sessionStore.getSession(id);

        if (!session) {
            return res.status(404).json({
                error: 'Session not found'
            });
        }

        // Get message count and pending approvals
        const messages = sessionStore.getMessages(id);
        const pendingApprovals = sessionStore.getPendingApprovals(id);

        res.json({
            ...session,
            message_count: messages.length,
            pending_approvals: pendingApprovals.length
        });
    } catch (err) {
        console.error('❌ Failed to get session:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/session
 * List all sessions
 */
router.get('/', (req, res) => {
    try {
        const sessionStore = req.app.locals.sessionStore;
        const sessions = sessionStore.getAllSessions();

        res.json({ sessions });
    } catch (err) {
        console.error('❌ Failed to list sessions:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
