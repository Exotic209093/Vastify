# Vastify — Hackathon Demo Video Script

**Submission:** Anthropic Virtual Hackathon — Built with Opus 4.7
**Deadline:** 2026-04-26 20:00 EST (2026-04-27 01:00 BST)
**Length:** 3:00 hard cap
**Voice:** ElevenLabs voice clone of James. Conversational, quietly confident. No hype-bro energy.
**Spoken word count:** ~390 (≈2.2 wps + breath room for screen action)
**Hosting:** YouTube unlisted (or Loom backup)

---

## Beat Map

| Time | Beat | Purpose |
|---|---|---|
| 0:00 – 0:20 | **Hook** | Anchor the painful number, name the villain |
| 0:20 – 0:40 | **Tour** | Show what Vastify is in 20 seconds |
| 0:40 – 1:55 | **Setup Agent** (headline) | Demonstrate Opus 4.7 tool use live |
| 1:55 – 2:35 | **Diff Explainer** | Demonstrate Opus 4.7 analytical reasoning |
| 2:35 – 3:00 | **Close** | Numbers + Opus 4.7 callout + repo |

---

## Full Script

### 0:00 – 0:20 — Hook

**[VISUAL** — Black → Salesforce storage usage bar climbing red → "STORAGE LIMIT REACHED" modal]

> "Salesforce charges $250 per gigabyte per month to store your customer data."

**[VISUAL** — Side-by-side cards: Salesforce $250/GB · AWS S3 $0.023/GB · ratio counter spins up to **10,000×**]

> "AWS charges two point three cents. That's ten thousand times cheaper. And almost nobody does anything about it."

---

### 0:20 – 0:40 — Tour

**[VISUAL** — Vastify dashboard loads. Cost-saved ticker climbing in real time. Tier/backend pie charts populated.]

> "Vastify offloads your Salesforce files and records onto cloud storage you already own — S3, GCS, Azure — and Salesforce never knows the difference."

**[VISUAL** — Quick cuts: Files page (rows of offloaded PDFs), Records page (live/archived toggle), Rules page]

> "Files. Records. Routing rules per tenant. All transparent to your users."

---

### 0:40 – 1:55 — Setup Agent (the headline)

**[VISUAL** — Cursor hovers over an empty new-tenant page. Fresh, blank.]

> "Getting set up used to take forty-five minutes. Salesforce config, storage credentials, routing rules, deployment. Today it takes one click."

**[VISUAL** — Click "**Set Vastify up for me**" button. Live tool-call panel slides in.]

> "This is Claude Opus 4.7, with tools."

**[VISUAL** — Tool calls appear in real time, each with a brief readable label:
1. `inspect_org` — "Reading Salesforce schema… 47 custom objects, 12 GB storage"
2. `pick_backend` — "GCS chosen — closest region, lowest tier cost"
3. `write_storage_config` — "Encrypted credentials written"
4. `generate_starter_rules` — "Created 4 routing rules from your data shape"
5. `deploy_sf_package` — "External Data Source created"
6. `validate_connection` — "OData endpoint live"

Timer in corner ticks: 00:58.]

> "It's not narrating a script. It's actually inspecting the org, picking a backend, writing credentials, generating rules from what it sees in your data, and deploying. Six tool calls. Fifty-eight seconds."

**[VISUAL** — "Ready" badge fades in. Dashboard refreshes — first offloaded file appears within 2 seconds.]

> "Done. The first file just landed in your bucket."

---

### 1:55 – 2:35 — Diff Explainer

**[VISUAL** — Cut to Backups → SnapshotDetail page. Wall of 47 line-item diffs scrolls past.]

> "And when something goes wrong in Salesforce — somebody runs a bad import, deletes the wrong contacts — Vastify already has a snapshot. The problem isn't the snapshot. It's understanding what to restore."

**[VISUAL** — Click "**Explain this diff**" button. Claude response streams in, plain English. Headline counters resolve to **44 safe / 3 review / 0 skip**, with per-entity cards:
- ✅ **Safe:** 12 Contact inserts (deleted in error, restore as-is) · 1 Opportunity skip-delete (live org has newer copy, leave alone) · 31 Case skip-deletes (preserve live records)
- ⚠️ **Review:** 3 Accounts (snapshot would overwrite Name/Phone/AnnualRevenue — verify the snapshot values are wanted)
- *Plus a yellow warning explaining exactly which Account fields would be overwritten.*]

> "Claude reads every change in the diff and tells you what's safe, what needs review, and why — in plain English. Forty-four changes safe to apply, three accounts that need a human eye, zero that should be skipped entirely."

**[VISUAL** — Click "**Restore the 44 safe items**" button on the DiffExplainer card. Inline status appears: "Dry run complete — 13 records would be restored, 31 preserved untouched." (Or live result if the seed has a real run.)]

> "One click commits the safe ones. The reviews get flagged. Nothing destructive happens without you signing off."

---

### 2:35 – 3:00 — Close

**[VISUAL** — Dashboard with cost ticker holding a real number, **$11,957 / month saved** from the seeded demo data]

> "Vastify. Up to ten thousand times cheaper Salesforce storage. Sixty-second setup. AI that actually understands your data."

**[VISUAL** — Logo + GitHub URL + "Built with Claude Opus 4.7"]

> "Built with Opus 4.7. Code's on GitHub. Thanks for watching."

**[END — 3:00 hard]**

---

## Production Notes

### What must exist before recording
- Setup Agent tool names match the script exactly: `inspect_org`, `pick_backend`, `write_storage_config`, `generate_starter_rules`, `deploy_sf_package`, `validate_connection`
- Demo tenant seeded with rich data (47 custom objects, ≥12GB visible storage, mix of file types)
- "Set Vastify up for me" button visible on a fresh-tenant landing
- "Explain this diff" button on SnapshotDetail
- Cost-saved ticker shows a believable real number, not lorem-data

### Numbers to verify before final cut
- $250/GB/month Salesforce data storage — sourced from DataArchiva, Flosum (verified 2026-04)
- $0.023/GB/month AWS S3 standard — verifiable on AWS pricing page
- "47 custom objects, 12 GB storage" in `inspect_org` output — hard-coded in `api/src/agents/setup/tools.ts`
- **"$11,957 / month saved" in close** — produced by `bun run seed:demo`. If you re-seed with different numbers, update the closing voiceover or just say "approximately twelve thousand"

### ElevenLabs voice direction
- Pace: deliberate, ~2.2 words/sec
- Emotion: matter-of-fact for the numbers, slight emphasis on "ten thousand times cheaper", "fifty-eight seconds", "one click"
- Pauses: full second after "two point three cents", "fifty-eight seconds", "Done."

### Recording tools
- **Screen capture:** OBS Studio (free) — 1920×1080, 60fps
- **Cursor highlighting:** Cursor Highlighter or built-in OBS plugin
- **Editing:** CapCut (free) or Descript (script-driven, recommended)
- **Hosting:** YouTube unlisted as primary; Loom as backup
