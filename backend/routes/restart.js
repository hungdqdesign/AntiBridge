const express = require('express');
const router = express.Router();

/**
 * POST /api/restart
 * Restart the server
 */
router.post('/', async (req, res) => {
    console.log('📢 Restart request received');

    try {
        // Send success response first
        res.json({
            success: true,
            message: 'Server đang khởi động lại...'
        });

        // Wait a bit for response to be sent, then exit
        setTimeout(() => {
            console.log('🔄 Restarting server...');
            process.exit(0); // Exit with code 0, pm2/nodemon/batch will restart
        }, 500);

    } catch (error) {
        console.error('❌ Restart error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
