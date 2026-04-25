# Vastify Marketing Site — Design

**Date:** 2026-04-26
**Status:** Approved (brainstorming phase)
**Owner:** James

## 1. Goal

Ship a polished, production-feeling marketing site for Vastify before the hackathon submission deadline (2026-04-27 01:00 BST). Seven pages, dark/blue design language inherited from the existing `Vastify Site.html` mockup, AI-features as the lead pitch, hosted on Railway alongside the API and dashboard. The site presents Vastify as a real product — no hackathon framing visible to visitors.

## 2. Non-Goals

- Custom domain (Railway-generated subdomain is fine for the submission window).
- Blog, customer testimonials, or case-study pages — there are no real customers, and inventing them is a bad look.
- i18n / multi-language.
- Analytics, cookie banners, or tracking pixels (we are not collecting visitor data).
- Auth, gated content, or signed-in marketing experiences.
- A11y audit beyond reasonable defaults (semantic HTML, alt text, keyboard nav on the CTA buttons).
- A future-proof design system. This is a one-shot build optimised for shipping.

## 3. Architecture

### 3.1 Repo location

A new top-level `marketing/` directory in this monorepo, alongside `api/`, `dashboard/`, `salesforce/`. The marketing app does not import from `api/` or `dashboard/` — it is a standalone Astro project.

### 3.2 Stack

- **Astro 5** — static site generator. Pages are `.astro` files; interactive bits are React islands hydrated only where needed.
- **React 18 + framer-motion** — for the animated hero, savings slider, and dashboard mockup, ported directly from `Vastify Site.html` as `.tsx` islands.
- **Tailwind CSS** — same config as the mockup (brand blue `#2563eb`, slate dark base, Inter + JetBrains Mono).
- **`@astrojs/react`** integration to host the islands.

Astro's "ship zero JS by default" model is a fit because most of the 7 pages are static text + images. Only the home hero, the savings slider, and the AI-features showcase need React + motion. Everything else is plain Astro components.

### 3.3 Build output

`marketing/dist/` — static HTML + CSS + hashed JS bundles. Served by Caddy in the Railway service.

### 3.4 Deployment (Railway)

Three services in one Railway project:

| Service | Type | Build | Runtime | Notes |
| --- | --- | --- | --- | --- |
| `vastify-marketing` | Static | `bun install && bun run build` (in `marketing/`) | `caddy file-server` from `marketing/dist/` | Railway-generated subdomain. |
| `vastify-dashboard` | Static | `bun install && bun run build` (in `dashboard/`) | Caddy serving `dashboard/dist/` | Railway-generated subdomain. |
| `vastify-api` | Service | Existing `Dockerfile` at repo root | Bun, port 3099 | Env: GCS creds, `ANTHROPIC_API_KEY`, `VASTIFY_DEMO_PUBLIC_ODATA=true`, `JWT_SECRET`, etc. |

Each Railway service points at the same GitHub repo with a different root directory. Railway's monorepo support handles this natively.

Cross-service URLs are baked at build time via Astro env vars:

- `PUBLIC_DASHBOARD_URL` — used by every "Try the demo" CTA.
- `PUBLIC_CONTACT_EMAIL` — used by the `mailto:` anchor on `/get-started`. The contact form is a `mailto:` link by design — no API endpoint, no CORS configuration, nothing to fail. If we later decide to wire a real POST endpoint, that is a separate change.
- `PUBLIC_REPO_URL` — used by GitHub links in nav/footer.

### 3.5 What we do NOT change

- The API (`api/`) stays exactly as-is. The marketing site does not call it (contact form is `mailto:`), so no CORS or auth changes are needed.
- The dashboard (`dashboard/`) is untouched. Its routes do not move; it continues to live at its own Railway subdomain.
- The Salesforce package is irrelevant to this work.

## 4. Site Structure

### 4.1 Pages

Persistent **nav** (top): Product · How it works · AI · Pricing · Security · GitHub · **Try the demo** (CTA button). Below ~768px the nav links collapse into a hamburger drawer; the "Try the demo" CTA stays visible at all widths.

Persistent **footer** (bottom): same links + small print + repo link.

| # | Path | Title | Lead element |
| --- | --- | --- | --- |
| 1 | `/` | Home | AI hero + savings slider + AI showcase + how-it-works preview + pricing teaser + final CTA |
| 2 | `/product` | Product | Files Offload, Records as External Objects, Backups, Multi-cloud router, Rules engine — feature blocks |
| 3 | `/how-it-works` | How it works | Architecture diagram, data flow, "your data never leaves your cloud" story, sequence walkthrough |
| 4 | `/ai` | AI features | Setup Agent (which generates starter rules as part of its flow) and Diff Explainer — each with screenshot/loop and a "what it does" + "what it calls" pair |
| 5 | `/pricing` | Pricing | Per-TB tiers (mockup adapted, marked "Beta pricing") + cost calculator |
| 6 | `/security` | Security | Encryption (in transit + at rest), customer-owned buckets, residency, audit trail, IAM model |
| 7 | `/get-started` | Get started | GitHub link, "Try the demo" CTA, contact form (or `mailto:` fallback) |

### 4.2 Hero (page 1) — final copy direction

- **H1:** Stop paying Salesforce storage prices. Set up by AI in 60 seconds.
- **Sub:** Vastify offloads your CRM files and records to your own S3 or GCS bucket — at a fraction of the cost. The Setup Agent reads your org, picks the backend, and writes your routing rules. You watch.
- **Primary CTA:** "Watch the Setup Agent" — anchors to the AI showcase block on the same page.
- **Secondary CTA:** "Try the demo →" — links to dashboard URL.
- **Right side visual:** the existing animated dashboard mockup, with a small inset showing the Setup Agent's tool-call stream.

### 4.3 Sub-page header pattern

Pages 2–7 share a smaller, consistent page header (page title + one-sentence sub) so the home hero stays the only "big" hero. Each sub-page ends with the same final-CTA strip (GitHub + Try the demo).

## 5. Content Authenticity

- **Cost numbers:** the savings calculator uses real Salesforce list prices ($250/GB-mo data, $5/GB-mo files). Real math; no inflated multipliers.
- **No fake stats:** drop the existing mockup's "480+ orgs offloaded this quarter" badge. Replace with a truthful badge: "Open source · self-hostable" or similar.
- **No fake testimonials, no fake customer logos.** Where the mockup template might call for "trusted by X", we use technology badges (Salesforce, S3, GCS, Azure, MinIO, Bun) instead.
- **Pricing:** the mockup's tier numbers stay, labelled "Beta pricing" so they read as illustrative.
- **AI feature screenshots:** real screenshots of the actual Setup Agent / Diff Explainer running in the dashboard. No mock-ups of features that do not exist.

## 6. Visual Design

Inherit verbatim from `Vastify Site.html`:

- Background `#020617` (slate-950).
- Brand blue `#2563eb` (brand-600), with `brand-300`/`brand-500`/`brand-700` ramps as in the mockup's tailwind config.
- Inter for body, JetBrains Mono for stats and code.
- Shimmer-spin animation, hero glow, grid background mask, orb blur — all preserved as global CSS in Astro's `src/styles/global.css`.
- Tailwind config copied directly; no design-system rework.

New components (sub-page headers, feature blocks, security icons, etc.) match this language. Nothing diverges.

## 7. Component Reuse

Direct ports from `Vastify Site.html` into `marketing/src/components/`:

| Mockup element | New file | Notes |
| --- | --- | --- |
| Hero | `Hero.tsx` (island) | Animations preserved. |
| `DashMockup` | `DashMockup.tsx` (island) | Used in hero. |
| Savings slider | `SavingsSlider.tsx` (island) | Real Salesforce list prices. |
| Feature flip cards | `FeatureCard.astro` | Static; flip is CSS-only. |
| Pricing tier cards | `PricingTiers.astro` | Static. |
| Apply form | folded into `/get-started` page |  |

Static pages (`.astro` files) compose these components; only the islands ship JS.

## 8. Testing & Verification

- **Local dev:** `bun run dev` in `marketing/` — every page loads without console errors at 1280px and 375px viewports.
- **Visual smoke:** click through all 7 pages in a browser; nav + footer present and working on each.
- **Lighthouse on `/`:** target Performance ≥ 90, SEO ≥ 95, Accessibility ≥ 90 on the deployed Railway URL.
- **Cross-link check:** "Try the demo" CTA on every page resolves to the live dashboard Railway URL; GitHub link resolves to the public repo.
- **Mobile:** home hero, slider, nav drawer all behave at iPhone 14 width (390px).

We do NOT add automated tests for the marketing site — it is a static brochure, and the cost of a Playwright suite outweighs the benefit at this scope.

## 9. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Astro + framer-motion island hydration issues | Keep islands small; if a component misbehaves, fall back to CSS-only animation for that block. |
| Railway static-site config friction | Use Caddy with a `Caddyfile` that serves `dist/` and SPA-falls-back to `index.html` for safety. |
| Setup Agent screenshot not ready in time | Use a still frame of the dashboard mockup with the agent panel open; swap to a real screen recording once available. |
| Time pressure (deadline hours away) | Each page must be shippable independently. Build order: home → AI → pricing → product → how-it-works → security → get-started. If we run out of time, the last pages drop without breaking the site. |
| Dashboard URL not yet known when marketing is built | `PUBLIC_DASHBOARD_URL` is read at build time; we can rebuild the marketing service after the dashboard service deploys. |

## 10. Out of Scope (explicit)

- Custom domain configuration.
- Blog / customers / testimonials / careers pages.
- Cookie banner, analytics, tracking.
- A11y audit beyond defaults.
- Multi-language.
- Auth-gated marketing pages.
- Email-collection pipeline beyond a single contact endpoint or `mailto:` fallback.
- Server-side rendering or dynamic routes.
- Marketing CMS.
- SEO sitemap / robots beyond Astro's defaults.

## 11. Open Questions

None at design time — all decisions made in brainstorming. Implementation plan will surface any ambiguity inside individual pages.
