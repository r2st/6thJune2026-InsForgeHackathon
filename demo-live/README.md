# Hush Live Pipeline Dashboard

A real-time visualization dashboard for the Hush bug-fixing pipeline. This is separate from the main slide-based demo and can be used for live demonstrations.

## Features

- **Animated Pipeline Visualization**: Shows data flowing through 5 stages (Capture → Diagnose → Fork → Replay → PR)
- **Real-time Metrics**: Total time, confidence score, stages complete, issues found
- **Progress Timeline**: Visual progress bar with step indicators
- **Data Preview Panels**: Shows actual JSON payloads at each pipeline stage
- **Interactive Controls**: Start demo, reset, and simulate real-time updates

## Usage

### Quick Start

1. Open `pipeline-dashboard.html` in a web browser:
   ```bash
   open demo-live/pipeline-dashboard.html
   # or double-click the file in your file browser
   ```

2. Click **"▶ Start Demo"** to run the automated demo sequence

3. Watch as data flows through each pipeline stage with animated transitions

### Controls

- **Start Demo**: Runs the full pipeline sequence (~45 seconds)
- **Reset**: Clears all progress and data
- **Simulate Real-time Updates**: Shows WebSocket-style updates

## Pipeline Stages

### 1. 📡 Capture
- Detects user frustration (rage-clicks, dead-clicks, abandoned forms)
- Captures 30-second session buffer using rrweb
- Taps backend logs matching the session ID
- Extracts failing HTTP request from logs

### 2. 🤖 Diagnose
- AI analyzes captured session + backend logs
- Identifies root cause (e.g., RLS policy misfire)
- Generates TOML diff for the fix
- Calculates confidence score

### 3. 🔀 Fork
- Spins up InsForge branch project from pre-warmed pool
- Applies proposed TOML diff to fork config
- Forges JWT for branch auth context
- Configures fork for safe testing

### 4. 🔁 Replay
- Runs parallel replay: prod vs fork
- Compares responses (row counts, error messages)
- Verifies fix effectiveness
- Generates verdict (fix confirmed/rejected)

### 5. 📦 PR
- Opens GitHub PR with TOML diff
- Embeds session clip URL
- Attaches before/after RLS trace
- Shows confidence badge and proof artifacts

## Demo Script

### For Hackathon Pitch

**Use alongside the slide-based demo (demo/slides/index.html):**

1. **0:00 - 0:55**: Use slide-based demo for problem + solution setup
2. **0:55 - 1:20**: Switch to live dashboard → Show Capture + Diagnose stages
3. **1:20 - 1:50**: Show Fork + Replay stages with live data
4. **1:50 - 2:15**: Show PR stage with proof artifacts

**Key Talking Points:**

- "Watch as the session data flows through each stage"
- "Here's the actual JSON payload captured from the user's session"
- "The AI diagnosis shows the exact RLS policy that's failing"
- "We fork the backend and run parallel replay to prove the fix works"
- "The PR includes the session clip and before/after traces for verification"

### For Q&A

**Common Questions & Dashboard Answers:**

- "How does it work in real-time?" → Point to live data flowing through stages
- "What data is captured?" → Expand data preview panels to show JSON payloads
- "How do you know the fix works?" → Show prod vs fork replay results
- "Is it automated?" → Start demo to show end-to-end automation

## Integration with Real System

This dashboard currently uses mock data for demonstration. To integrate with the real Hush system:

1. **WebSocket Connection**: Connect to InsForge Realtime channel
2. **Live Data**: Replace mock JSON with actual session/diagnosis data
3. **Real-time Updates**: Subscribe to pipeline status changes
4. **Session Clips**: Embed actual rrweb session replays

### Integration Points

- **Capture Stage**: Connect to `/capture` edge function output
- **Diagnose Stage**: Connect to `diagnose.ts` results
- **Fork Stage**: Connect to branch project status
- **Replay Stage**: Connect to parallel replay results
- **PR Stage**: Connect to GitHub API for PR creation

## Customization

### Modify Stage Data

Edit the `stageData` object in `pipeline-dashboard.html`:

```javascript
const stageData = {
    capture: {
        status: 'active',
        content: `Session ID: abc-123
Frustration: rage-click
Timestamp: 2026-06-06T13:37:42Z
Page: /orders
Expected rows: 3
Actual rows: 0`
    },
    // ... other stages
};
```

### Adjust Timing

Modify the delays in the `runStage()` function:

```javascript
await runStage(stages[i], 500);  // 500ms delay between stages
// Inside runStage:
setTimeout(() => {
    updateStage(stage, 'success');
}, 1500);  // 1.5s processing time per stage
```

### Change Styling

Edit CSS variables in the `<style>` section:

```css
:root {
    --bg: #0b0c0f;           /* Background color */
    --accent: #ff6b35;       /* Primary accent color */
    --good: #6ee7b7;         /* Success color */
    --bad: #ff6b6b;          /* Error color */
    // ... other colors
}
```

## Performance

- **File Size**: ~15KB (single HTML file)
- **Load Time**: <1s
- **Runtime**: ~45s for full demo sequence
- **Browser Support**: All modern browsers (Chrome, Firefox, Safari, Edge)

## Troubleshooting

### Dashboard not loading
- Ensure JavaScript is enabled
- Try opening in a different browser
- Check browser console for errors

### Demo not starting
- Click "Reset" first, then "Start Demo"
- Refresh the page and try again

### Animation not smooth
- Close other browser tabs
- Check system performance

## Future Enhancements

- [ ] Real WebSocket integration with Hush system
- [ ] Interactive stage exploration (click to expand details)
- [ ] Side-by-side prod vs fork visualization
- [ ] Session clip embedding with rrweb player
- [ ] GitHub PR live preview
- [ ] Multiple session tracking
- [ ] Historical pipeline runs
- [ ] Performance metrics per stage

## License

Same as parent project (MIT/Apache as appropriate)