# Vastify — Hackathon Submission Summary

**Pick the variant that matches the submission form's word limit. Both are within 100–200 words.**

---

## Variant A — 145 words (recommended)

Salesforce charges $250 per gigabyte per month to store customer data — over 10,000× what AWS S3 charges for the same byte. Vastify is middleware that transparently offloads Salesforce files (ContentVersion) and records (External Objects via OData 4.0) onto the cloud storage you already own — S3, GCS, Azure, or MinIO — with a per-tenant routing engine for hot/warm/cold tiers.

The Opus 4.7 layer is the part that turns this from a tool into a product. **One agent** autonomously sets up a fresh tenant in 60 seconds via six visible tool calls — inspecting the Salesforce schema, picking a backend, generating routing rules from the data shape, deploying, and validating. **A second** reads any backup snapshot's diff plan and tells you in plain English which restores are safe, which need review, and which would re-open closed deals.

Real software. Real cost savings. Real Claude tool use.

---

## Variant B — 198 words (more detail)

Salesforce charges customers $250 per gigabyte per month to store records and $5 per gigabyte for files — over 10,000× what AWS S3 charges for the same byte. **Vastify** is middleware that transparently offloads both onto cloud storage the customer already owns: S3, GCS, Azure, or MinIO, with a per-tenant routing engine that decides hot/warm/cold tier per file by size, age, or MIME.

Built with Claude Opus 4.7 in two distinct ways — neither a chat wrapper.

**The Setup Agent** ends a 45-minute manual onboarding. Click one button: Claude tool-calls through inspecting your Salesforce schema, picking the cheapest backend for your data shape, writing encrypted storage credentials, generating starter routing rules, deploying the SF package, and validating the OData endpoint. Six tool calls. Sixty seconds. Visible live.

**The Diff Explainer** reads a backup snapshot's diff plan and categorizes every change with reasoning: 12 contacts deleted in error → safe; 3 accounts edited since snapshot → review; 1 closed-won opportunity → skip. One click later, the safe restores apply.

The middleware works without the AI. The AI is what makes it shippable.

Built end-to-end during the hackathon. Code: <github-url-here>.

---

## Notes when filling out the submission form

- **Title:** "Vastify — Salesforce Storage Offload, Configured by Claude"
- **One-line tagline:** "Cut Salesforce storage costs 10,000×. Set up by an autonomous agent in 60 seconds."
- **Categories / problem statement:** match whichever the form lists; the SaaS / B2B / dev-tool angle fits.
- **Tech stack to declare:** TypeScript · Bun · Hono · React · Claude Opus 4.7 (Anthropic Agent SDK)
- **GitHub repo:** make sure it's public before submitting; double-check `.env` is not committed.
- **Demo video URL:** YouTube unlisted is fine; the form usually accepts unlisted.
