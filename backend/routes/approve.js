/**
 * Approve Routes
 * POST /api/approve - Accept or reject an approval request
 * GET /api/approve/:session_id - Get pending approvals
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/approve
 * Accept or reject an approval request
 * Body: { session_id: "abc123", approval_id: "appr_001", decision: "accept" | "reject" }
 */
router.post('/', async (req, res) => {
    try {
        const { session_id, decision } = req.body;

        if (!session_id || !decision) {
            return res.status(400).json({
                error: 'session_id and decision are required'
            });
        }

        if (!['accept', 'reject'].includes(decision)) {
            return res.status(400).json({
                error: 'decision must be "accept" or "reject"'
            });
        }

        const eventBus = req.app.locals.eventBus;
        const antigravityBridge = req.app.locals.antigravityBridge;

        let success = false;

        // Phương pháp 1: Sử dụng AntigravityBridge (CDP/Puppeteer) - ưu tiên
        if (antigravityBridge) {
            try {
                success = await antigravityBridge.sendApproval(decision);
                if (success) {
                    console.log(`✅ Đã gửi ${decision} qua AntigravityBridge`);
                }
            } catch (bridgeErr) {
                console.log(`⚠️ Bridge error, falling back to SendKeys: ${bridgeErr.message}`);
            }
        }

        // Phương pháp 2: Fallback - dùng PowerShell SendKeys (nếu Bridge thất bại)
        if (!success) {
            const { exec } = require('child_process');
            const key = decision === 'accept' ? 'y' : '{ESC}';

            // Script cải tiến: Escape trước để unfocus chat input, rồi mới gửi key
            const psCommand = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $w = New-Object -ComObject wscript.shell; $activated = $w.AppActivate('- Antigravity'); if(-not $activated) { $w.AppActivate('Antigravity') }; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait('${key}')"`;

            exec(psCommand, (err) => {
                if (err) {
                    console.error('❌ SendKeys error:', err.message);
                } else {
                    console.log(`✅ Sent ${decision} (${key}) to Antigravity via SendKeys fallback`);
                }
            });

            success = true; // Assume success for fallback
        }

        // Thông báo client
        eventBus.emit(session_id, 'status', {
            type: 'approval_decision',
            decision,
            message: decision === 'accept' ? 'Đã Accept!' : 'Đã Reject!'
        });

        console.log(`✅ ${decision.toUpperCase()} sent to Antigravity for session ${session_id}`);

        res.json({ ok: true, decision });
    } catch (err) {
        console.error('❌ Approve error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/approve/:session_id
 * Get pending approvals for a session
 */
router.get('/:session_id', (req, res) => {
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

        const approvals = sessionStore.getPendingApprovals(session_id);

        res.json({
            session_id,
            pending_approvals: approvals
        });
    } catch (err) {
        console.error('❌ Failed to get approvals:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
