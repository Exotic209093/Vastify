# Vastify — Demo Recording Shot List

**Purpose:** A click-by-click guide for recording the 3-minute submission video. Designed so the actual screen recording takes ≤30 minutes including retakes.

**Companion files:**
- [video-script.md](video-script.md) — locked voiceover, beat-by-beat
- [storyboard/index.html](storyboard/index.html) — visual reference for tone & framing

---

## Pre-recording checklist

Run these once, in order, before opening OBS:

```bash
# 1. Start MinIO + app via docker (or skip if running API natively)
docker compose up -d minio minio-init

# 2. Seed the demo tenant + rich demo data
cd api
bun run seed
bun run seed:demo

# 3. Start the API (if not in docker)
bun run dev

# 4. In a second terminal — start the dashboard dev server
cd dashboard
bun run dev
```

Verify before hitting record:
- [ ] http://localhost:3099/health returns `{ ok: true }`
- [ ] http://localhost:5173/login loads — click **Continue with demo account** to bypass OAuth
- [ ] Overview page shows the cost ticker around **$10k–$15k/month**
- [ ] Files page shows ~80 files across multiple backends
- [ ] Records page shows ~500 archived + ~150 live records
- [ ] Backups page shows at least 1 connected org and 5+ snapshots
- [ ] `ANTHROPIC_API_KEY` is set in `api/.env` — test by visiting `/dashboard/setup` and clicking the button. The first run is the rehearsal; the second run is the take.

---

## OBS / Screen recording settings

| Setting | Value |
|---|---|
| Resolution | 1920 × 1080 |
| Frame rate | 60 fps |
| Encoder | H.264 (NVENC if available) |
| Bitrate | 8000–12000 kbps |
| Audio | OFF (voiceover added in post via ElevenLabs) |
| Cursor highlighter | ON, subtle yellow ring |
| Scene | Single full-screen browser, no taskbar |

**Browser setup:**
- Chrome / Edge in **Guest** profile (no extensions, no bookmarks bar)
- F11 fullscreen, then DevTools closed
- Zoom level 110% so text reads on a 1080p projector
- Pin only one tab — the dashboard

---

## Shot list — 8 takes total

Each take is ≤30 seconds of screen action. Re-record any take individually; the editor will splice them in CapCut/Descript. **Aim for clean cursor movement** — no bouncing, no idle wandering. Move with intent.

### Take 1 — Opening flash (0:00 – 0:18)

**Goal:** Establish the villain (Salesforce storage cost).

You don't actually need to film Salesforce here. The opener is screenshots + transitions assembled in post:

1. **Screenshot A** — A real Salesforce "Storage Limit Reached" banner. Use a stock screenshot or recreate a fake one in Figma. Save as `assets/sf-storage-limit.png`.
2. **Screenshot B** — Side-by-side cards: `Salesforce $250/GB·mo` vs `AWS S3 $0.023/GB·mo`. Use the storyboard frame I as a reference, or screenshot the storyboard directly: open `docs/submission/storyboard/index.html`, scroll to frame I, fullscreen, screenshot.
3. **Screenshot C** — A big `10,000×` ratio number. Same — screenshot from the storyboard's hook frame.

Recording action: none for this take. Editor pans/zooms over the three screenshots.

### Take 2 — Dashboard tour (0:18 – 0:40)

**Goal:** Show Vastify is real, working software.

1. Browser is on **Overview** page. Pause for 1s on the cost ticker.
2. Cursor smoothly moves to the **Files** nav link, click. Land on Files. Pause 1.5s.
3. Cursor moves to **Records** nav, click. Pause 1s. Click the **Archived** toggle, pause 1s.
4. Cursor moves to **Rules** nav, click. Pause 1s.
5. End on Rules page (don't move further).

**Tip:** Move cursor in straight lines, not arcs. Pause briefly after every click so the editor has freeze-frame options.

### Take 3 — Setup Agent: empty state (0:40 – 0:50)

**Goal:** Show the "before" — fresh tenant, blank.

1. Click **Setup Agent** in left nav. Land on the page.
2. Pause 2s on the empty state with the big **"Set Vastify up for me"** button visible. The "Setup time 00:00" should also be visible.
3. End the take here. (Do **not** click the button yet.)

### Take 4 — Setup Agent: live run (0:50 – 1:55) — THE HEADLINE TAKE

**Goal:** The 60-second wow moment. This is the take judges will remember.

1. **Click the "Set Vastify up for me" button.**
2. Do not move the cursor. Let it sit. The terminal panel on the right starts streaming tool calls live. The timer ticks.
3. Tool calls land in this order with these labels:
   - `inspect_org` — "47 custom objects · 12 GB"
   - `pick_backend` — "GCS · us-central1 · STANDARD"
   - `write_storage_config` — "encrypted · OK"
   - `generate_starter_rules` — "4 rules — PDFs >10MB to cold tier"
   - `deploy_sf_package` — "External Data Source — live"
   - `validate_connection` — "OData endpoint responding 200"
4. When the green "Ready" badge appears (~58s), **wait one full second**, then end the take.

**If the agent's tool order or timing differs from above:** that's a backend bug. Stop, fix it, re-record. The voiceover script depends on this exact sequence.

**Backup plan if Anthropic API is rate-limited or down at recording time:** Add a temporary `?mock=true` query param to the SetupAgent page that replays a recorded JSON of a previous successful run — implement only if needed.

### Take 5 — Cut to Backups → SnapshotDetail (1:55 – 2:05)

**Goal:** Land us on the page where the Diff Explainer lives.

1. Click **Backups** in left nav.
2. Click the most recent snapshot row. Land on SnapshotDetail.
3. Scroll down so the **diff plan** is visible — should show 47 changes total.
4. End the take here.

### Take 6 — Diff Explainer: live run (2:05 – 2:30)

**Goal:** Demonstrate Claude's analytical reasoning.

1. Click the **"Explain this diff"** button.
2. Don't move the cursor. The Claude response streams in below — color-coded:
   - ✅ Safe: 12 contacts deleted in error — restore as-is
   - ⚠️ Review: 3 accounts edited since snapshot — manual merge
   - ❌ Skip: 1 closed opportunity — restoring would re-open the wrong record
3. Wait until the full response is visible. Pause 1s.
4. Click **"Restore safe items"**. Brief toast appears: "12 contacts restored."
5. End the take.

### Take 7 — Close: cost ticker (2:30 – 2:50)

**Goal:** Land on the impact number.

1. Click **Overview** in left nav. Land on the cost ticker.
2. The ticker should still be on the seeded number (~$11,840/month). Pause 3s, no cursor movement.
3. End the take.

### Take 8 — Logo card (2:50 – 3:00)

**Goal:** Final brand frame.

This is **not** a screen recording — it's a static graphic assembled in CapCut. Build it from the storyboard's frame V:

1. Open `docs/submission/storyboard/index.html`, scroll to frame V (the "10,000× cheaper" close).
2. Fullscreen, screenshot.
3. Save as `assets/close-frame.png`. The editor holds this frame for 8-10s under the closing voiceover.

---

## Editing notes (for CapCut / Descript)

- **Voiceover** generated separately via ElevenLabs from `video-script.md`. Drop into the timeline first; cut visuals to fit.
- **Music:** Optional. If used, instrumental, sub-25 dB under the voice. Suggested: subtle electronic, no vocals. Avoid copyrighted tracks (use Epidemic Sound or YouTube Audio Library).
- **Transitions:** Hard cuts only. No fades, no wipes. Hackathon judges read fancy transitions as "padding."
- **Subtitles:** Add baked-in subtitles. Many judges watch with sound off the first time.
- **Title card:** First half-second can be the storyboard frame I or a single "VASTIFY" wordmark on cream. Don't waste the 3:00 cap on a long intro.
- **End card:** Frame V (Take 8) holds for the final 8s. Optional GitHub URL overlay.

---

## Post-recording verification

Before uploading to YouTube:

- [ ] Total runtime ≤ 3:00 (hard cap)
- [ ] Voiceover synced to visuals (test with sound on)
- [ ] Subtitles match voiceover (test with sound off)
- [ ] Setup Agent take shows tool calls landing IN ORDER
- [ ] Diff Explainer take shows the 12 / 3 / 1 split
- [ ] Cost ticker visible at open and close
- [ ] No personal info (Salesforce username, email) visible in any take
- [ ] No timestamps showing dates outside the hackathon window

Upload as **Unlisted** on YouTube. Submit the link via the hackathon form by **2026-04-27 01:00 BST** (8:00 PM EST April 26).

---

## If something goes wrong

| Problem | Workaround |
|---|---|
| Setup agent tool ordering wrong | Backend bug — fix in `api/src/agents/setup/runner.ts`, re-record Take 4 only |
| Anthropic API rate-limited at recording time | Wait 60s, retry. If persistent, swap to `claude-haiku-4-5` temporarily (still a real Claude model — adjust voiceover to "Built with Claude" rather than "Opus 4.7") |
| Cost ticker shows $0 | `seed-demo-data` didn't run — re-run it, refresh the dashboard |
| Diff Explainer returns nothing | Likely no `ANTHROPIC_API_KEY` in `api/.env` — set it, restart API |
| Dashboard SSE stream hangs | Check API console for errors; restart `bun run dev` |
| Recording cursor jitters | OBS → Settings → Video → Common FPS Values: 60 |
