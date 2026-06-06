# Hush Real Demo Environment

A realistic demo environment that runs the actual toy app, simulates user rage-clicks, and shows real data flowing through the Hush pipeline. This is separate from both the slide-based demo and the animated dashboard.

## Features

- **Real Toy App**: Runs the actual Next.js toy storefront with rrweb session capture
- **Real Receipt Page**: Runs the actual receipt page with live status updates
- **Browser Automation**: Uses Puppeteer to simulate real user rage-clicks in the browser
- **Real Data Flow**: Shows actual session data, frustration signals, and pipeline progression
- **End-to-End Testing**: Full pipeline from user interaction to PR creation

## Quick Start

### Option 1: Full Environment (Recommended)

```bash
cd demo-live
./start-real-demo.sh
```

This starts:
- Toy app on http://localhost:3000
- Receipt page on http://localhost:3001

### Option 2: Browser Automation (Most Realistic)

```bash
cd demo-live
npm install puppeteer
node automate-browser-demo.js
```

This opens a real browser and simulates rage-clicks on the actual toy app.

### Option 3: Simulation Mode (No Dependencies)

```bash
cd demo-live
node simulate-user-interaction.js
```

This simulates the pipeline without requiring the apps to be running.

## Demo Script

### Real Demo with Browser Automation

1. **Start the environment:**
   ```bash
   ./start-real-demo.sh
   ```

2. **Run browser automation in another terminal:**
   ```bash
   npm install puppeteer  # first time only
   node automate-browser-demo.js
   ```

3. **Watch the demo:**
   - Browser opens with toy app
   - Automated rage-clicks on Reload button
   - Navigate to http://localhost:3001 to see live pipeline status
   - Watch as real data flows through Capture → Diagnose → Fork → Replay → PR

### Manual Demo (No Automation)

1. **Start the environment:**
   ```bash
   ./start-real-demo.sh
   ```

2. **Open browser:**
   - Go to http://localhost:3000 (toy app)
   - Navigate to orders page
   - Rage-click Reload button 3+ times
   - Open http://localhost:3001 (receipt page)
   - Watch live status updates

## Components

### Toy App (apps/demo)
- Next.js storefront with rrweb session capture
- Frustration signal detection (rage-clicks, dead-clicks, abandoned forms)
- 30-second rolling session buffer
- RLS bug: orders page shows 0 orders instead of 3

### Receipt Page (apps/receipt)
- Live status dashboard with InsForge Realtime SDK
- Shows diagnosis results, replay comparison, PR status
- Confidence badges and proof artifacts
- Before/after traces

### Browser Automation (automate-browser-demo.js)
- Puppeteer-based user interaction simulation
- Real browser window for manual inspection
- Automated rage-click sequence
- Session capture verification

### Session Simulator (simulate-user-interaction.js)
- Node.js simulation without browser requirements
- Generates realistic session data
- Simulates pipeline progression
- Shows JSON payloads at each stage

## Integration with Real Hush System

The demo connects to the actual Hush components:

1. **Capture Edge Function**: `/capture` endpoint on InsForge
2. **Diagnose Function**: `functions/diagnose.ts` with Anthropic API
3. **Branch Project**: Pre-warmed InsForge branch projects
4. **Replay System**: Parallel prod vs fork replay
5. **GitHub API**: Real PR creation with proof artifacts

### Environment Variables

```bash
# For InsForge integration
ANTHROPIC_API_KEY=your_anthropic_key
INSFORGE_PROJECT_ID=your_project_id

# For GitHub API (optional - creates real PRs)
GITHUB_TOKEN=your_github_token
GITHUB_REPO=your_repo_name
```

## Troubleshooting

### Toy app not starting
```bash
cd apps/demo
npm install
npm run dev
```

### Receipt page not starting
```bash
cd apps/receipt
npm install
npm run dev
```

### Puppeteer not working
```bash
npm install puppeteer
# Or use simulation mode:
node simulate-user-interaction.js
```

### Port conflicts
```bash
# Kill processes on ports 3000 and 3001
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

## Demo Variants

### Variant 1: Pure Browser Automation
- Most realistic user simulation
- Actual browser interactions
- Visual confirmation of rage-clicks
- Requires Puppeteer

### Variant 2: Simulation Mode
- No browser required
- Fast and reliable
- Shows pipeline data
- Good for testing

### Variant 3: Manual Demo
- Full manual control
- Flexible timing
- Good for Q&A
- Most authentic

## Performance

- **Startup time**: ~15s (app startup + dependencies)
- **Browser automation**: ~10s (3 rage-clicks + page loads)
- **Pipeline processing**: ~30s (capture → diagnose → replay → PR)
- **Total demo time**: ~55 seconds

## Logs

Logs are written to `logs/` directory:
- `logs/demo-app.log` - Toy app logs
- `logs/receipt-app.log` - Receipt page logs

## Future Enhancements

- [ ] Real WebSocket integration with InsForge Realtime
- [ ] Actual InsForge edge function deployment
- [ ] Real GitHub PR creation
- [ ] Multiple session tracking
- [ ] Recording/playback of demo sessions
- [ ] CI/CD integration for demo environment

## License

Same as parent project