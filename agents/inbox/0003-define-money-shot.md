---
id: 0003
title: Define the demo's "money shot" and write it into architecture.md
role: architect
priority: P0
owner:
started:
status: inbox
depends_on: [0001]
demo_path: yes — the single moment the pitch lands on
---

## Goal

Pick the one user flow that lands the pitch — the artifact the judge clicks
on at the end. Document it in `docs/architecture.md` under the system
diagram, and make sure the components diagram supports it end-to-end.

## Why it matters for the demo

Every other component should be in service of this moment. If a component
doesn't touch the money-shot flow, it's a candidate to cut.

## Acceptance criteria

- [ ] One sentence describing the money shot ("Judge clicks X, sees Y,
      realizes Z")
- [ ] End-to-end data flow drawn from user input → money shot artifact
- [ ] Components list filled in (`docs/architecture.md`)
- [ ] External APIs / sponsors mapped to where they appear in the flow

## Likely files / surfaces touched

- `docs/architecture.md`

## Notes

Resist building the money shot first by feel. Write it down, get one other
agent to agree, then build.
