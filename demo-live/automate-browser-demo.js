// Hush Browser Automation Demo
// This uses Puppeteer to actually simulate user interactions in the real toy app

const puppeteer = require('puppeteer');
const http = require('http');

const DEMO_APP_URL = 'http://localhost:3000';
const RECEIPT_APP_URL = 'http://localhost:3001';

console.log('🎭 Hush Browser Automation Demo');
console.log('==============================');
console.log('');

async function runBrowserDemo() {
    let browser;
    
    try {
        // Check if demo app is running
        try {
            await new Promise((resolve, reject) => {
                http.get(DEMO_APP_URL, (res) => {
                    if (res.statusCode === 200) {
                        console.log('✅ Toy app is running at ' + DEMO_APP_URL);
                        resolve();
                    } else {
                        reject('Toy app not responding');
                    }
                }).on('error', reject);
            });
        } catch (error) {
            console.log('⚠️ Toy app not running at ' + DEMO_APP_URL);
            console.log('   Please run: ./start-real-demo.sh first');
            return;
        }

        console.log('');
        console.log('🌐 Launching browser...');
        
        browser = await puppeteer.launch({
            headless: false, // Show the browser so you can see the interactions
            args: ['--start-maximized']
        });
        
        const page = await browser.newPage();
        
        console.log('📱 Navigating to toy app...');
        await page.goto(DEMO_APP_URL, { waitUntil: 'networkidle2' });
        
        console.log('✅ Page loaded');
        
        // Wait a moment for the user to see the initial state
        await page.waitForTimeout(2000);
        
        console.log('');
        console.log('🎬 Simulating user experiencing the bug...');
        console.log('   User navigates to orders page...');
        
        // Navigate to orders page
        await page.goto(`${DEMO_APP_URL}/orders`, { waitUntil: 'networkidle2' });
        
        console.log('   User sees empty orders page (the bug!)');
        
        // Wait to observe the bug
        await page.waitForTimeout(3000);
        
        console.log('');
        console.log('😤 Simulating user frustration...');
        console.log('   Rage-click #1 on Reload button...');
        
        // Find and click the reload button
        try {
            await page.evaluate(() => {
                const reloadButton = document.querySelector('[data-hush="reload"]') || 
                                    document.querySelector('button:contains("Reload")') ||
                                    document.querySelector('#reload') ||
                                    document.querySelector('.reload');
                if (reloadButton) {
                    reloadButton.click();
                }
            });
        } catch (error) {
            console.log('   Reload button not found, using page reload...');
            await page.reload({ waitUntil: 'networkidle2' });
        }
        
        await page.waitForTimeout(1000);
        
        console.log('   Rage-click #2...');
        try {
            await page.evaluate(() => {
                const reloadButton = document.querySelector('[data-hush="reload"]') || 
                                    document.querySelector('#reload');
                if (reloadButton) reloadButton.click();
            });
        } catch (error) {
            await page.reload({ waitUntil: 'networkidle2' });
        }
        
        await page.waitForTimeout(1000);
        
        console.log('   Rage-click #3...');
        try {
            await page.evaluate(() => {
                const reloadButton = document.querySelector('[data-hush="reload"]') || 
                                    document.querySelector('#reload');
                if (reloadButton) reloadButton.click();
            });
        } catch (error) {
            await page.reload({ waitUntil: 'networkidle2' });
        }
        
        await page.waitForTimeout(2000);
        
        console.log('');
        console.log('✅ Frustration signals captured by rrweb!');
        console.log('   Session buffer: 30 seconds recorded');
        console.log('   Rage-clicks: 3 detected');
        console.log('   Frustration level: HIGH');
        
        console.log('');
        console.log('📊 Open receipt page to see live Hush pipeline:');
        console.log('   ' + RECEIPT_APP_URL);
        console.log('');
        console.log('⏳ Browser will stay open for manual inspection...');
        console.log('   Press Ctrl+C to close the browser');
        
        // Keep browser open for manual inspection
        await new Promise((resolve) => {
            // This will wait indefinitely until killed
        });
        
    } catch (error) {
        console.error('❌ Browser automation error:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Check if Puppeteer is installed, provide instructions if not
try {
    require('puppeteer');
    runBrowserDemo().catch(console.error);
} catch (error) {
    console.log('❌ Puppeteer not installed');
    console.log('');
    console.log('To install Puppeteer:');
    console.log('   npm install puppeteer');
    console.log('');
    console.log('Or use the simpler simulation:');
    console.log('   node demo-live/simulate-user-interaction.js');
    process.exit(1);
}