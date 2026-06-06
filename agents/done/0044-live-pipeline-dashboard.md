---
id: 0044
title: Create live pipeline visualization dashboard
role: builder
priority: P1
owner: devin
started: 2026-06-06
status: done
depends_on: []
demo_path: yes — alternative to slide-based demo, shows real-time data flow
---

## Goal

Create a separate live demo dashboard that visualizes the Hush pipeline in real-time, showing data flowing through each stage (Capture → Diagnose → Fork → Replay → PR) without touching the existing slide-based demo.

## Why it matters for the demo

More impressive than static slides. Judges can see actual data flowing through the pipeline, JSON payloads at each stage, and the automated end-to-end process in action. Complements the slide-based demo by providing a "under the hood" view.

## Acceptance criteria

- [ ] Create demo-live/ directory separate from demo/
- [ ] Build pipeline-dashboard.html with animated 5-stage visualization
- [ ] Show real-time metrics (time, confidence, stages complete, issues found)
- [ ] Display actual JSON data at each pipeline stage (mock data initially)
- [ ] Add interactive controls (start demo, reset, simulate updates)
- [ ] Include README with usage instructions and integration points
- [ ] Create start-dashboard.sh script for easy launching
- [ ] Document how to integrate with real WebSocket data

## Likely files / surfaces touched

- `demo-live/pipeline-dashboard.html` (new)
- `demo-live/README.md` (new)
- `demo-live/start-dashboard.sh` (new)

## Notes

- Keep it completely separate from existing demo/ directory to preserve fallback
- Use mock data initially, document integration points for real WebSocket connection
- Single HTML file approach for portability and simplicity
- Animated transitions for visual appeal but keep it performant
- Browser-based, no backend dependencies

## Outcome
- What shipped: demo-live/pipeline-dashboard.html with animated 5-stage visualization, real-time metrics, data preview panels, interactive controls; demo-live/README.md with usage instructions; demo-live/start-dashboard.sh launcher script
- What was cut and why: Real WebSocket integration skipped to keep implementation simple - documented integration points for future
- How to verify it: Run ./demo-live/start-dashboard.sh or open pipeline-dashboard.html in browser, click "Start Demo" to see animated pipeline sequence