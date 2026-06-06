# How to win a hackathon — a tight playbook

Synthesized from MLH, Devpost, AngelHack, HackerEarth, and judges-write-ups
linked at the bottom. Tuned for the **Web Data UNLOCKED** SF finale, but the
core advice is universal.

> **The single biggest pattern:** smart builders beat the best coders. Strategy,
> demo polish, and storytelling routinely outweigh raw code quality.

---

## Before the build

- **Read the judging rubric before you write a line of code.** Teams that
  optimize for the rubric win more than teams that build what excites them.
  For Web Data UNLOCKED that's *sponsor-stack coverage + live-web evidence
  story + autonomous action*.
- **Build a painkiller, not a vitamin.** If a non-technical person can't
  feel the pain in one sentence, the idea isn't sharp enough. Name a real
  customer ("the procurement lead at a mid-market manufacturer") — not a
  persona.
- **Reverse-engineer the judges.** Look up every judge before kickoff. VC
  judges want TAM + traction. Engineer judges want the "how." Sponsor judges
  want their API used *non-trivially.* Tune emphasis per panel.
- **Cap scope hard ("illusion of completeness").** Three features that work
  > a platform where nothing does. Skip login, password reset, settings —
  anything that doesn't show the magic. Rule of thumb: *if you can't demo
  it in 3 minutes, it's too complex.*
- **Pick proven tech.** Hackathon ≠ learn-a-framework day. Speed beats
  novelty.
- **Define one "money shot" first.** The single user-flow that lands the
  pitch. Build that end-to-end before anything else. Layer extras only if
  time allows.
- **Staff the four roles deliberately.** *Architect* (core logic), *Builder*
  (fast UI), *Designer* (makes it look shipped in <2 hours), *Storyteller*
  (drafts the pitch from hour 1, not hour 23). Solo? Wear all four hats on
  a schedule — don't let the Storyteller slot die.

## During the build

- **Cache everything live.** Re-runs and demos should never depend on a real
  HTTP call. Cache the BD response, the LinkedIn snapshot, the OFAC CSV.
  Bellwether already does this; resist the urge to live-call on stage.
- **Stop new work ~30 min before submission.** Use that time to remove
  broken things, not add features. Half-finished code in a demo is worse
  than missing features.
- **Submit 2 hours early.** Devpost / judging platforms reliably crawl or
  crash in the final hour. A working-but-incomplete submission beats a
  perfect-but-late one. Iterate after the submit button.
- **Test on the demo machine.** Run the full pipeline on the same laptop,
  same network, same browser you'll pitch from. "Works on my machine"
  kills demos.
- **Record a fallback screencast.** If anything in the demo is live (Comet,
  HubSpot, Bright Data), record a successful run *the day before* and have
  it ready to cut to. Judges accept this if you tell them up front.

## The pitch (typical 3–6 min)

- **Open with the problem, not the tech.** Never start with *"We built a
  prototype with Next.js…"*. Start with *who hurts, how much, and why now*.
- **Demo > slides.** Spend ~60% of your time on a working demo. Slides are
  scaffolding for the demo, not the deliverable.
- **End on the audit moment.** Click through to a real artifact — a cited
  memo, a filed ticket, a logged transaction. The single moment that says
  *"this works."*
- **Leave 15–30s of slack.** Demos slip. Either trim one section or label
  one as droppable. A pitch that hits 5:30 in a 6:00 slot beats one that
  gets cut at 6:00.
- **Practice three full dry-runs, on the clock.** Out loud, on the demo
  machine, with the timer running. Cut anything that doesn't earn its
  seconds.

## The Q&A

- **Pre-empt the obvious questions.** Have your team grill you the night
  before with the questions a procurement / compliance / legal person would
  actually ask ("LinkedIn ToS?", "how do you avoid OFAC false positives?",
  "what's the per-supplier cost?"). Bellwether's risk-section + cost cards
  exist to absorb most of these.
- **Show, don't claim.** When asked "how do you score?" — open the file.
  When asked "what's the audit trail?" — show the cited memo.
- **"We didn't build X, and here's why."** Owning your non-goals (compliance,
  fine-tuning, multi-tenant auth) signals discipline. Judges reward it.
- **Plant the seed.** End the pitch with a hook that invites the obvious
  question you've prepared for ("we have early monetization thoughts but
  skipped them for time" → judge asks → nail the rehearsed answer).
  Controlled Q&A wins.

## Mistakes that lose hackathons

1. **Overscoping.** Cited as the #1 killer across every source.
2. **Talking tech first.** Judges remember clarity, not complexity.
3. **Live calls in the demo.** Network hiccup = dead demo.
4. **No fallback recording.** Live computer-use / agent demos slip 20–30%
   of the time. Recording is insurance.
5. **Building outside the brief.** The shoehorned project ("we had this
   idea anyway, here's how it fits") is the most-flagged warning sign by
   judges.
6. **Over-polishing the UI.** "My columns are misaligned" is a tax. Ship
   "enough design so it doesn't look ugly" and stop.
7. **Forming an unbalanced team.** Five backend devs is a known failure
   mode. (Solo build is fine — wear all the hats deliberately.)
8. **Not reading the sponsor prizes.** Sponsor side-prizes are usually
   easier wins than the grand prize. Bellwether already touches BD, AMD,
   IBM, CrewAI, Perplexity, HubSpot — make sure each shows up in the demo.

## Bellwether-specific cheat sheet

- **Sponsor coverage is your headline.** Six logos in one demo — call them
  out by name in the close. "Bright Data, AMD MI300X, IBM Granite, CrewAI,
  Perplexity Comet, HubSpot — all live, all cited."
- **The audit page IS the proof.** Don't open the terminal as your finale.
  Open the auditor view, click a score, jump to the LinkedIn diff. That's
  the moment.
- **The cut list is your friend.** [research/procurement-counter-intel.html](procurement-counter-intel.html)
  already has a written cut list in Section 4 — *use it* if a piece is red
  on demo morning. Don't improvise the rescue.
- **Run `bellwether ping` 10 min before you pitch.** Green-yellow-red on
  every provider; fix anything red or cut it from the demo.
- **Keep the "Monday test" answer ready.** *"Could I plug my supplier list
  in tomorrow?" — yes, only the CRM creds and the CSV are tenant-specific.*
  That single sentence is the close.

---

## Sources

- [How to win a hackathon — advice from 5 judges (Devpost)](https://info.devpost.com/blog/hackathon-judging-tips)
- [10 Tips to Win a Hackathon: A Developer's Playbook (HackerEarth)](https://www.hackerearth.com/blog/10-tips-win-hackathon)
- [10 Tips To Help You Rock Your Next Hackathon Demo (AngelHack)](https://angelhack.com/blog/10-tips-to-help-you-rock-your-next-hackathon-demo/)
- [6 Tips for making a winning hackathon demo video (Devpost)](https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video)
- [Judging Plan — MLH Hackathon Organizer Guide](https://guide.mlh.io/general-information/judging-and-submissions/judging-plan)
- [Hackathon judging: 6 criteria to pick winning projects (TAIKAI)](https://taikai.network/en/blog/hackathon-judging)
- [Understanding hackathon submission and judging criteria (Devpost)](https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria)
- [How to Win a Hackathon: 2026 step-by-step roadmap (Underrated Coder)](https://www.underratedcoder.com/blog/how-to-win-a-hackathon-complete-step-by-step-roadmap-2026-guide)
- [How to lose a hackathon in 7 steps (dev.to)](https://dev.to/arrrgr/how-to-lose-a-hackathon-in-7-steps-2kf0)
- [Top 5 Mistakes Developers Make at Hackathons (BizThon)](https://medium.com/@BizthonOfficial/top-5-mistakes-developers-make-at-hackathons-and-how-to-avoid-them-d7e870746da1)
- [This is Why You are Losing Hackathons (dev.to)](https://dev.to/code42cate/5-reasons-why-you-are-losing-hackathons-4k70)
- [Win Hackathons: A How-To Guide (Nick Singh)](https://www.nicksingh.com/posts/win-hackathons-a-how-to-guide)
- [How to Create a Winning Hackathon Pitch (TAIKAI)](https://taikai.network/en/blog/how-to-create-a-hackathon-pitch)
- [Pitch your hackathon product in 3 minutes (Next Media Accelerator)](https://medium.com/next-media-accelerator/pitch-your-hackathon-product-in-3-minutes-and-conquer-the-jury-9f86bfbdba6f)
- [How Hackathon Winners Think Differently — 2026 (College Simplified)](https://www.collegesimplified.in/post/how-hackathon-winners-think-differently-winning-strategy-for-2026)
- [How I Win Most Hackathons — Serial Hacker (szeyusim)](https://szeyusim.medium.com/how-i-win-most-hackathons-stories-pro-tips-from-a-serial-hacker-1969c6470f92)
- [Creating a 5-Minute Kickass Hackathon Pitch (Circles.Life)](https://medium.com/circleslife/creating-a-5-minute-kickass-hackathon-pitch-17cdcb42c3bc)
- [Ultimate 8-Step Guide to Winning Hackathons (Gary Yau Chan)](https://medium.com/garyyauchan/ultimate-8-step-guide-to-winning-hackathons-84c9dacbe8e)
