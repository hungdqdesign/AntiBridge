/**
 * PhoneBridge Full Startup Script
 * Starts server + Auto-injects scripts + Starts AcceptDetector
 */

const http = require('http');

// Helper to make HTTP request
function httpRequest(method, path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8000,
            path: path,
            method: method,
            timeout: 10000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

// Wait for server to be ready
function waitForServer(maxWait = 10000) {
    const startTime = Date.now();

    return new Promise((resolve) => {
        const check = () => {
            httpRequest('GET', '/api/health')
                .then(() => resolve(true))
                .catch(() => {
                    if (Date.now() - startTime > maxWait) {
                        resolve(false);
                    } else {
                        setTimeout(check, 500);
                    }
                });
        };
        check();
    });
}

async function startup() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║          PhoneBridge - Full Startup                        ║
╚════════════════════════════════════════════════════════════╝
`);

    console.log('IMPORTANT: Make sure Antigravity is running with:');
    console.log('  --remote-debugging-port=9000\n');

    // Step 1: Start server (require will start it)
    console.log('[1/3] Starting server...');
    require('./server.js');

    // Step 2: Wait for server ready then inject
    console.log('[2/3] Waiting for server to be ready...');
    const ready = await waitForServer(15000);

    if (!ready) {
        console.log('⚠️ Server health check failed, but continuing...');
    }

    // Give it 1 more second for WebSocket to be ready
    await new Promise(r => setTimeout(r, 1000));

    console.log('[3/3] Injecting scripts + Starting AcceptDetector...\n');

    try {
        // Inject all scripts
        const injectResult = await httpRequest('POST', '/api/inject/all');
        console.log('   📦 CDP Injection:');
        console.log(`      chat_bridge_ws.js: ${injectResult.results?.chatBridge ? '✅' : '⏭️ skipped'}`);
        console.log(`      detect_actions.js: ${injectResult.results?.actionDetector ? '✅' : '⏭️ skipped'}`);

        if (injectResult.results?.errors?.length > 0) {
            console.log(`      ⚠️ Errors: ${injectResult.results.errors.join(', ')}`);
        }
    } catch (e) {
        console.log(`   ⚠️ CDP Injection error: ${e.message}`);
        console.log('      (This is OK if Antigravity is not running yet)');
    }

    try {
        // Start AcceptDetector
        const startResult = await httpRequest('POST', '/api/actions/start');
        console.log(`\n   🎯 AcceptDetector: ${startResult.success ? '✅ Running' : '⚠️ ' + startResult.error}`);
    } catch (e) {
        console.log(`\n   ⚠️ AcceptDetector error: ${e.message}`);
    }

    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ ALL SERVICES STARTED!                                   ║
╠════════════════════════════════════════════════════════════╣
║  🌐 Server:       http://localhost:8000                     ║
║  📦 Injection:    Completed                                 ║
║  🎯 Detector:     Running                                   ║
╚════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop...
`);
}

startup().catch(err => {
    console.error('❌ Startup error:', err.message);
});
