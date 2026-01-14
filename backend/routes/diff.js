/**
 * Diff Routes
 * GET /api/diff/:session_id - Get git diff for session
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/diff/:session_id
 * Get git diff/patch for files changed in session
 */
router.get('/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;

        const sessionStore = req.app.locals.sessionStore;

        // Verify session exists
        const session = sessionStore.getSession(session_id);
        if (!session) {
            return res.status(404).json({
                error: 'Session not found'
            });
        }

        // TODO: In Sprint 3, integrate with GitManager service
        // For now, return a simulated response

        const simulatedDiff = {
            session_id,
            branch: session.branch_name,
            files: [
                {
                    path: 'src/index.js',
                    status: 'modified',
                    patch: `@@ -1,5 +1,8 @@
-const oldCode = true;
+const newCode = true;
+const addedLine = 'hello';
 
 function main() {
-    console.log('old');
+    console.log('new');
+    console.log('additional');
 }`,
                    stats: { additions: 4, deletions: 2 }
                },
                {
                    path: 'src/utils.js',
                    status: 'added',
                    patch: `@@ -0,0 +1,10 @@
+// New utility file
+export function helper() {
+    return 'helper function';
+}
+
+export function format(str) {
+    return str.trim().toLowerCase();
+}`,
                    stats: { additions: 10, deletions: 0 }
                }
            ],
            summary: {
                files_changed: 2,
                insertions: 14,
                deletions: 2
            }
        };

        res.json(simulatedDiff);
    } catch (err) {
        console.error('❌ Diff error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
