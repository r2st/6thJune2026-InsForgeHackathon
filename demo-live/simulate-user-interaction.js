// Hush User Interaction Simulator
// This script simulates realistic user rage-clicks and frustration signals
// in the running toy app

const http = require('http');

const DEMO_APP_URL = 'http://localhost:3000';
const SESSION_ID = 'demo-session-' + Date.now();

console.log('🎭 Hush User Interaction Simulator');
console.log('================================');
console.log('');
console.log('Simulating realistic user frustration in the toy app...');

// Simulate session capture with rrweb
function simulateSessionCapture() {
    console.log('📡 Simulating session capture...');
    
    // Create realistic session data
    const sessionData = {
        session_id: SESSION_ID,
        timestamp: new Date().toISOString(),
        page: '/orders',
        user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        frustration_signals: {
            rage_clicks: 3,
            dead_clicks: 0,
            abandoned_forms: 0,
            total_interaction_time: 15000
        },
        events: [
            { type: 'navigation', url: '/orders', timestamp: 0 },
            { type: 'click', selector: '#reload-button', timestamp: 2000, frustration: true },
            { type: 'click', selector: '#reload-button', timestamp: 3000, frustration: true },
            { type: 'click', selector: '#reload-button', timestamp: 4000, frustration: true }
        ],
        request_log: {
            method: 'GET',
            path: '/api/orders',
            headers: {
                'cookie': 'session_id=abc-123',
                'user-agent': 'Mozilla/5.0...'
            },
            response: {
                status: 200,
                body: JSON.stringify({ orders: [] }), // Empty orders - the bug!
                expected_rows: 3,
                actual_rows: 0
            }
        }
    };

    console.log('✅ Session data captured:');
    console.log(`   Session ID: ${sessionData.session_id}`);
    console.log(`   Page: ${sessionData.page}`);
    console.log(`   Rage-clicks: ${sessionData.frustration_signals.rage_clicks}`);
    console.log(`   Expected orders: 3, Actual: 0 ⚠️`);
    
    return sessionData;
}

// Simulate sending captured data to Hush capture endpoint
function simulateHushCapture(sessionData) {
    console.log('');
    console.log('🚀 Sending data to Hush capture endpoint...');
    
    // In a real setup, this would POST to the InsForge edge function
    // For demo, we simulate the response
    console.log('POST /capture');
    console.log(JSON.stringify(sessionData, null, 2));
    
    console.log('✅ Capture successful!');
    console.log('   Session stored in InsForge Storage');
    console.log('   Realtime event published: hush:session:' + SESSION_ID);
}

// Simulate the diagnosis process
function simulateDiagnosis(sessionData) {
    console.log('');
    console.log('🤖 Hush AI analyzing session...');
    
    setTimeout(() => {
        console.log('✅ Diagnosis complete:');
        console.log('   Root cause: RLS policy misfire');
        console.log('   Policy: orders_select');
        console.log('   Issue: Hardcoded tenant_id instead of current_user_tenant_id()');
        console.log('   Confidence: 87%');
    }, 2000);
}

// Simulate forking and replay
function simulateForkAndReplay(sessionData) {
    console.log('');
    console.log('🔀 Spinning up branch project...');
    
    setTimeout(() => {
        console.log('✅ Branch project ready: hush-fork-' + SESSION_ID);
        
        setTimeout(() => {
            console.log('');
            console.log('🔁 Parallel replay (prod vs fork)...');
            console.log('   Prod: 0 rows ❌');
            console.log('   Fork: 3 rows ✅');
            console.log('✅ Fix verified!');
        }, 1500);
    }, 1000);
}

// Simulate PR creation
function simulatePRCreation(sessionData) {
    console.log('');
    console.log('📦 Opening GitHub PR...');
    
    setTimeout(() => {
        console.log('✅ PR opened:');
        console.log('   PR #42: Fix RLS misfire on orders');
        console.log('   Diff: 4 lines');
        console.log('   Confidence: 92%');
        console.log('   Artifacts: session clip + RLS trace');
    }, 2000);
}

// Main simulation flow
async function runSimulation() {
    console.log('');
    
    try {
        // Check if demo app is running
        await new Promise((resolve, reject) => {
            http.get(DEMO_APP_URL, (res) => {
                if (res.statusCode === 200) {
                    console.log('✅ Toy app is running at ' + DEMO_APP_URL);
                    resolve();
                } else {
                    reject('Toy app not responding correctly');
                }
            }).on('error', () => {
                console.log('⚠️ Toy app not running, but continuing with simulation...');
                resolve();
            });
        });

        console.log('');
        
        // Run the simulation
        const sessionData = simulateSessionCapture();
        simulateHushCapture(sessionData);
        
        await simulateDiagnosis(sessionData);
        await simulateForkAndReplay(sessionData);
        await simulatePRCreation(sessionData);
        
        console.log('');
        console.log('🎉 Simulation complete!');
        console.log('');
        console.log('📊 To see the real pipeline:');
        console.log('   1. Open http://localhost:3001 (receipt page)');
        console.log('   2. Look for session ID: ' + SESSION_ID);
        console.log('   3. Watch real-time status updates');
        
    } catch (error) {
        console.error('❌ Simulation error:', error);
    }
}

// Run the simulation
runSimulation().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});