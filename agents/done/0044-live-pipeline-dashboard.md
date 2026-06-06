---
id: 0044
title: Create realistic demo environment with real apps
role: builder
priority: P1
owner: devin
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — runs actual toy app with user interaction simulation
---

## Goal

Create a realistic demo environment that runs the actual toy app, simulates real user rage-clicks using browser automation, and shows real data flowing through the Hush pipeline.

## Why it matters for the demo

Much more impressive than animations - judges see the actual toy app running, real user rage-clicks being automated, real session data being captured, and real pipeline components in action. Provides "under the hood" visibility that judges trust.

## Acceptance criteria

- [ ] Create demo-live/ directory separate from demo/
- [ ] Build start-real-demo.sh script to run toy app + receipt page
- [ ] Create automate-browser-demo.js using Puppeteer for real rage-click simulation
- [ ] Create simulate-user-interaction.js for simulation mode without dependencies
- [ ] Include README with multiple demo variants (automation, simulation, manual)
- [ ] Document integration with real Hush system components
- [ ] Package demo-live/ with Puppeteer dependency management

## Likely files / surfaces touched

- `demo-live/start-real-demo.sh` (new)
- `demo-live/automate-browser-demo.js` (new)
- `demo-live/simulate-user-interaction.js` (new)
- `demo-live/README.md` (new)
- `demo-live/package.json` (new)
- `apps/demo/` (existing toy app - started by script)
- `apps/receipt/` (existing receipt page - started by script)

## Notes

- Runs the actual Next.js toy app with rrweb capture and frustration detection
- Uses Puppeteer to automate real browser interactions (rage-clicks on Reload button)
- Shows actual session data flowing through the pipeline stages
- Provides fallback simulation mode for environments without Puppeteer
- Separate from demo/ to preserve slide-based fallback
- Creates logs/ directory for app logs

## Outcome
- What shipped: demo-live/start-real-demo.sh to run actual apps; demo-live/automate-browser-demo.js with Puppeteer automation; demo-live/simulate-user-interaction.js for simulation mode; demo-live/README.md with 3 demo variants; demo-live/package.json for dependency management
- What was cut and why: Pipeline animation dashboard (pipeline-dashboard.html) kept as reference - realistic app approach chosen for more authentic demo
- How to verify it: Run ./demo-live/start-real-demo.sh then either npm install puppeteer && node automate-browser-demo.js (most realistic) or node simulate-user-interaction.js (no dependencies)