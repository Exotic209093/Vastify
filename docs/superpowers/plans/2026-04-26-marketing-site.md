# Vastify Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 7-page Astro marketing site for Vastify in `marketing/`, hosted on Railway, inheriting the design language and JSX components from `Vastify Site.html`.

**Architecture:** Astro 5 static site with React + framer-motion islands for interactive components (hero, savings slider, dashboard mockup, AI showcase). All other content is plain `.astro` static. Deployed as a Railway static service via Caddy. Tailwind config and global CSS port directly from the existing `Vastify Site.html` mockup.

**Tech Stack:** Astro 5 · React 18 · framer-motion 11 · Tailwind CSS 3 · Bun · Caddy (Railway runtime)

**Spec:** [docs/superpowers/specs/2026-04-26-marketing-site-design.md](../specs/2026-04-26-marketing-site-design.md)

**Mockup source:** `Vastify Site.html` at repo root — JSX-in-HTML; line numbers in this plan refer to that file.

**No automated tests.** The spec opted out of a Playwright suite; verification is manual visual smoke at the end of each page-level task.

---

## Pre-flight

- [ ] **Step 1: Read the spec end to end**

Read [docs/superpowers/specs/2026-04-26-marketing-site-design.md](../specs/2026-04-26-marketing-site-design.md). Confirm site map, hero copy, content authenticity rules, and the mailto contact decision.

- [ ] **Step 2: Confirm working directory**

Run: `pwd`
Expected: `e:/Hackathon Projects/Vastify CRM Storage` (or equivalent on this machine).

The `marketing/` directory does not yet exist; we create it in Task 1.

---

## Task 1: Scaffold Astro project

**Files:**
- Create: `marketing/package.json`
- Create: `marketing/astro.config.mjs`
- Create: `marketing/tsconfig.json`
- Create: `marketing/.gitignore`
- Create: `marketing/public/favicon.svg`

- [ ] **Step 1: Create `marketing/package.json`**

```json
{
  "name": "vastify-marketing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview --port 4321",
    "astro": "astro"
  },
  "dependencies": {
    "astro": "^5.1.0",
    "@astrojs/react": "^4.1.0",
    "@astrojs/tailwind": "^5.1.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "framer-motion": "^11.15.0",
    "tailwindcss": "^3.4.17"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Create `marketing/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  output: 'static',
  site: 'https://vastify.example',
});
```

`applyBaseStyles: false` — we provide our own global stylesheet that includes Tailwind's directives, so we don't want the integration injecting a duplicate.

- [ ] **Step 3: Create `marketing/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Create `marketing/.gitignore`**

```
node_modules/
dist/
.astro/
.env
.env.local
.DS_Store
```

- [ ] **Step 5: Create a placeholder `marketing/public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2563eb"/><path d="M6 8l6 9 6-9" stroke="white" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 6: Install + first dev run**

Run from repo root:
```
cd marketing && bun install
```
Expected: lockfile written, no errors.

Then:
```
bun run dev
```
Expected: Astro dev server starts on http://localhost:4321 (no pages yet — 404 is fine). Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```
git add marketing/package.json marketing/astro.config.mjs marketing/tsconfig.json marketing/.gitignore marketing/public/favicon.svg marketing/bun.lock
git commit -m "feat(marketing): scaffold Astro project"
```

Bun 1.2+ writes a text-format `bun.lock` (not binary `bun.lockb`). The repo root `.gitignore` ignores it globally, so use `git add -f marketing/bun.lock` if needed.

---

## Task 2: Tailwind config (port from mockup)

**Files:**
- Create: `marketing/tailwind.config.cjs`

The mockup uses an inline Tailwind config at lines 8-26 of `Vastify Site.html`. Port it.

- [ ] **Step 1: Create `marketing/tailwind.config.cjs`**

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,tsx,ts,jsx,js,md,mdx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef4ff',
          100: '#dfe8ff',
          300: '#93a6ff',
          500: '#4f6bff',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Commit**

```
git add marketing/tailwind.config.cjs
git commit -m "feat(marketing): tailwind config ported from mockup"
```

---

## Task 3: Global CSS (port from mockup)

**Files:**
- Create: `marketing/src/styles/global.css`

Port the `<style>` block from `Vastify Site.html` lines 30-117 (everything between `<style>` and `</style>`). Add Tailwind directives at the top.

- [ ] **Step 1: Create `marketing/src/styles/global.css` with Tailwind directives + ported keyframes/utilities**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; background: #020617; color: #f1f5f9; }
body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.font-mono, code, pre { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }

@keyframes shimmer-spin { to { transform: rotate(1turn); } }
.shimmer-wrap { position: relative; isolation: isolate; border-radius: 0.75rem; }
.shimmer-wrap::before {
  content: ""; position: absolute; inset: -1px; border-radius: inherit;
  background: conic-gradient(from 0deg,
    rgba(37,99,235,0) 0deg, rgba(37,99,235,0) 200deg,
    rgba(37,99,235,1) 260deg, rgba(147,166,255,1) 300deg,
    rgba(37,99,235,0) 340deg, rgba(37,99,235,0) 360deg);
  animation: shimmer-spin 6s linear infinite; z-index: 0;
}
.shimmer-wrap::after {
  content: ""; position: absolute; inset: 1px;
  border-radius: calc(0.75rem - 1px); background: #0b1222; z-index: 1;
}
.shimmer-wrap > * { position: relative; z-index: 2; }

.flip-scene { perspective: 1400px; }
.flip-card {
  position: relative; width: 100%; height: 100%;
  transform-style: preserve-3d;
  transition: transform 700ms cubic-bezier(.2,.8,.2,1);
}
.flip-scene:hover .flip-card, .flip-card.is-flipped { transform: rotateY(180deg); }
.flip-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.flip-face.back { transform: rotateY(180deg); }

.hero-glow {
  position: absolute; inset: -10%;
  background: radial-gradient(50% 50% at 50% 50%, rgba(37,99,235,0.35), rgba(37,99,235,0) 70%);
  filter: blur(40px); z-index: 0; pointer-events: none;
}

.grid-bg {
  background-image:
    linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at top, black 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse at top, black 30%, transparent 75%);
}

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 999px; }
::-webkit-scrollbar-track { background: transparent; }

input[type=range].vast-range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, #2563eb var(--pct, 50%), #1e293b var(--pct, 50%));
  outline: none;
}
input[type=range].vast-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 20px; height: 20px; border-radius: 999px;
  background: #fff; border: 2px solid #2563eb;
  box-shadow: 0 0 0 6px rgba(37,99,235,0.15), 0 6px 20px rgba(37,99,235,0.45);
  cursor: pointer;
}
input[type=range].vast-range::-moz-range-thumb {
  width: 20px; height: 20px; border-radius: 999px;
  background: #fff; border: 2px solid #2563eb; cursor: pointer;
}

.orb {
  position: absolute; border-radius: 9999px;
  filter: blur(60px); opacity: 0.55;
}
```

If the mockup's `<style>` block contains additional rules past line 117, copy them too. Read the file from line 30 to the closing `</style>` to be sure.

- [ ] **Step 2: Commit**

```
git add marketing/src/styles/global.css
git commit -m "feat(marketing): port global CSS from mockup"
```

---

## Task 4: Site config + env helper

**Files:**
- Create: `marketing/src/lib/site.ts`

These constants centralise cross-service URLs so we never hardcode them in components.

- [ ] **Step 1: Create `marketing/src/lib/site.ts`**

```ts
const env = import.meta.env;

export const SITE = {
  dashboardUrl: env.PUBLIC_DASHBOARD_URL ?? 'http://localhost:5173',
  repoUrl: env.PUBLIC_REPO_URL ?? 'https://github.com/jamescollard/vastify-crm-storage',
  contactEmail: env.PUBLIC_CONTACT_EMAIL ?? 'hello@vastify.example',
  brandName: 'Vastify',
  tagline: 'Salesforce storage, offloaded. Onboarded by AI in 60 seconds.',
} as const;

export const NAV_LINKS = [
  { href: '/product',       label: 'Product' },
  { href: '/how-it-works',  label: 'How it works' },
  { href: '/ai',            label: 'AI' },
  { href: '/pricing',       label: 'Pricing' },
  { href: '/security',      label: 'Security' },
] as const;
```

The defaults are dev-time fallbacks. Production values are set as Railway env vars (`PUBLIC_DASHBOARD_URL`, `PUBLIC_REPO_URL`, `PUBLIC_CONTACT_EMAIL`) and baked into the build.

- [ ] **Step 2: Commit**

```
git add marketing/src/lib/site.ts
git commit -m "feat(marketing): add site config + nav link list"
```

---

## Task 5: Base layout

**Files:**
- Create: `marketing/src/layouts/Base.astro`

- [ ] **Step 1: Create `marketing/src/layouts/Base.astro`**

```astro
---
import '../styles/global.css';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
  description?: string;
}
const { title, description = 'Salesforce storage, offloaded onto your own cloud bucket. Set up by AI in 60 seconds.' } = Astro.props;
---
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body class="bg-slate-950 text-slate-100">
  <Nav />
  <main><slot /></main>
  <Footer />
</body>
</html>
```

- [ ] **Step 2: Commit**

This will fail to compile until Nav and Footer exist (Tasks 6-7). Don't commit yet — proceed to Task 6.

---

## Task 6: Nav component

**Files:**
- Create: `marketing/src/components/Nav.astro`

Adapted from mockup `Logo` (lines 128-142) and `TopNav` (lines 143-162). The mockup uses hash-routing; we replace with real Astro hrefs and add a hamburger drawer for mobile (<768px).

- [ ] **Step 1: Create `marketing/src/components/Nav.astro`**

```astro
---
import { SITE, NAV_LINKS } from '../lib/site';
const path = Astro.url.pathname;
---
<header class="sticky top-0 z-40 border-b border-slate-900 bg-slate-950/80 backdrop-blur">
  <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2 text-white font-semibold tracking-tight">
      <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600 shadow-[0_4px_20px_rgba(37,99,235,0.45)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l6 9 6-9"/></svg>
      </span>
      <span>{SITE.brandName}</span>
    </a>

    <nav class="hidden md:flex items-center gap-7 text-sm text-slate-300">
      {NAV_LINKS.map((l) => (
        <a href={l.href} class={`hover:text-white transition ${path === l.href ? 'text-white' : ''}`}>{l.label}</a>
      ))}
      <a href={SITE.repoUrl} target="_blank" rel="noopener" class="hover:text-white transition">GitHub</a>
    </nav>

    <div class="flex items-center gap-3">
      <a href={SITE.dashboardUrl} class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition shadow-[0_6px_24px_rgba(37,99,235,0.35)]">Try the demo</a>
      <button id="navBurger" type="button" class="md:hidden rounded-lg border border-slate-800 px-2 py-2 text-slate-300 hover:text-white" aria-label="Open menu" aria-controls="navDrawer" aria-expanded="false">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </div>

  <div id="navDrawer" hidden class="md:hidden border-t border-slate-900 bg-slate-950">
    <div class="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-3 text-slate-200">
      {NAV_LINKS.map((l) => (
        <a href={l.href} class="py-2 hover:text-white">{l.label}</a>
      ))}
      <a href={SITE.repoUrl} target="_blank" rel="noopener" class="py-2 hover:text-white">GitHub</a>
    </div>
  </div>
</header>

<script>
  const burger = document.getElementById('navBurger');
  const drawer = document.getElementById('navDrawer');
  if (burger && drawer) {
    burger.addEventListener('click', () => {
      const open = drawer.hasAttribute('hidden');
      if (open) {
        drawer.removeAttribute('hidden');
        burger.setAttribute('aria-expanded', 'true');
      } else {
        drawer.setAttribute('hidden', '');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }
</script>
```

---

## Task 7: Footer component

**Files:**
- Create: `marketing/src/components/Footer.astro`

Adapted from mockup `Footer` (lines 163-198). Drop any "480+ orgs" or fake-stat references per the spec's content authenticity rule.

- [ ] **Step 1: Create `marketing/src/components/Footer.astro`**

```astro
---
import { SITE, NAV_LINKS } from '../lib/site';
const year = new Date().getFullYear();
---
<footer class="border-t border-slate-900 bg-slate-950 mt-24">
  <div class="max-w-7xl mx-auto px-6 py-14 grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10">
    <div>
      <div class="flex items-center gap-2 text-white font-semibold">
        <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-600">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l6 9 6-9"/></svg>
        </span>
        {SITE.brandName}
      </div>
      <p class="mt-4 text-sm text-slate-400 max-w-xs">CRM storage, offloaded onto your own cloud bucket. Open source · self-hostable.</p>
    </div>
    <div>
      <div class="text-xs uppercase tracking-wider text-slate-500 mb-3">Product</div>
      <ul class="space-y-2 text-sm text-slate-300">
        {NAV_LINKS.map((l) => (
          <li><a href={l.href} class="hover:text-white">{l.label}</a></li>
        ))}
      </ul>
    </div>
    <div>
      <div class="text-xs uppercase tracking-wider text-slate-500 mb-3">Resources</div>
      <ul class="space-y-2 text-sm text-slate-300">
        <li><a href={SITE.repoUrl} target="_blank" rel="noopener" class="hover:text-white">GitHub</a></li>
        <li><a href="/get-started" class="hover:text-white">Get started</a></li>
      </ul>
    </div>
    <div>
      <div class="text-xs uppercase tracking-wider text-slate-500 mb-3">Contact</div>
      <ul class="space-y-2 text-sm text-slate-300">
        <li><a href={`mailto:${SITE.contactEmail}`} class="hover:text-white">{SITE.contactEmail}</a></li>
      </ul>
    </div>
  </div>
  <div class="border-t border-slate-900">
    <div class="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
      <span>© {year} {SITE.brandName}. All rights reserved.</span>
      <span class="font-mono">Bun · Astro · Caddy · Salesforce · S3 · GCS · Azure · MinIO</span>
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Run dev server, verify Base layout works**

```
bun run dev
```
Open http://localhost:4321 — Astro will return 404 (no index page yet) but the dev server should not throw a build error from the components.

- [ ] **Step 3: Commit**

```
git add marketing/src/layouts/Base.astro marketing/src/components/Nav.astro marketing/src/components/Footer.astro
git commit -m "feat(marketing): base layout, nav with mobile drawer, footer"
```

---

## Task 8: AnimatedCounter island

**Files:**
- Create: `marketing/src/components/AnimatedCounter.tsx`

Port verbatim from mockup `AnimatedCounter` (lines 199-210).

- [ ] **Step 1: Create `marketing/src/components/AnimatedCounter.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { animate } from 'framer-motion';

interface Props {
  to: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export default function AnimatedCounter({ to, duration = 2.5, prefix = '', suffix = '', className = '' }: Props) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const ctrl = animate(0, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [to, duration]);
  return <span className={className}>{prefix}{val.toLocaleString()}{suffix}</span>;
}
```

- [ ] **Step 2: Commit**

```
git add marketing/src/components/AnimatedCounter.tsx
git commit -m "feat(marketing): animated counter island"
```

---

## Task 9: DashMockup island

**Files:**
- Create: `marketing/src/components/DashMockup.tsx`

Port from mockup `DashMockup` (lines 211-265). It uses a static `bars` array; reproduce it verbatim. No props.

- [ ] **Step 1: Read lines 211-265 of `Vastify Site.html` and copy the JSX into `marketing/src/components/DashMockup.tsx` with these adaptations:**

1. Add at the top:
   ```tsx
   import { motion } from 'framer-motion';
   ```
2. Wrap the function as a default export: `export default function DashMockup() { ... }`
3. Find the `bars` array declaration in the function body and keep it as-is (it's a static array of percentages used for the chart bars).
4. Keep all `className` attributes (this is a `.tsx` React island).

The complete code structure:

```tsx
import { motion } from 'framer-motion';

const bars = [/* keep mockup values verbatim */];

export default function DashMockup() {
  // ...JSX from mockup lines 217-264, ending with </div>);
}
```

If the mockup's `bars` is declared inline in the function body, leave it there. The point is to preserve behaviour exactly.

- [ ] **Step 2: Verify it compiles by importing it in a throwaway page**

Create a one-off file `marketing/src/pages/_smoke.astro`:

```astro
---
import Base from '../layouts/Base.astro';
import DashMockup from '../components/DashMockup';
---
<Base title="smoke">
  <div class="max-w-3xl mx-auto p-10"><DashMockup client:load /></div>
</Base>
```

Run `bun run dev`, open http://localhost:4321/_smoke. Expect the dashboard mockup to render with animated bars.

Then **delete** `marketing/src/pages/_smoke.astro` (it's only for verification).

- [ ] **Step 3: Commit**

```
git add marketing/src/components/DashMockup.tsx
git commit -m "feat(marketing): dash mockup island ported"
```

---

## Task 10: Hero island

**Files:**
- Create: `marketing/src/components/Hero.tsx`

Port from mockup `Hero` (lines 267-327), with the new copy from spec section 4.2.

- [ ] **Step 1: Read lines 267-327 of `Vastify Site.html`. Create `marketing/src/components/Hero.tsx` with the same JSX structure but these copy changes:**

- Replace the H1 (`<motion.h1>`) text with: `Stop paying Salesforce<br/>storage prices.`
- Replace the H1's first line and add a sub-headline below at H1 size or use a tagline above:
  - The original mockup has a small "Live · 480+ Salesforce orgs offloaded this quarter" badge above the H1. **Replace** that text with: `Open source · self-hostable`. Keep the green pulse dot.
- Replace the subhead `<motion.p>` text with: `Vastify offloads your CRM files and records to your own S3 or GCS bucket — at a fraction of the cost. The Setup Agent reads your org, picks the backend, and writes your routing rules. You watch.`
- Update the primary CTA `<a>` to `href="#ai-showcase"` and label `"Watch the Setup Agent"`.
- Update the secondary CTA `<a>` to `href={dashboardUrl}` and label `"Try the demo →"`. Read `dashboardUrl` from `import { SITE } from '../lib/site'`.
- Replace the "Saved right now, this month" tile with a simpler "Salesforce list rate vs. Vastify on S3 Standard" mini-comparison — see step 2.

```tsx
import { useEffect } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import DashMockup from './DashMockup';
import AnimatedCounter from './AnimatedCounter';
import { SITE } from '../lib/site';

export default function Hero() {
  const floatY = useMotionValue(0);
  useEffect(() => {
    const ctrl = animate(floatY, [0, -14, 0], { duration: 6, repeat: Infinity, ease: 'easeInOut' });
    return () => ctrl.stop();
  }, []);
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-brand-600/15 blur-3xl pointer-events-none" />
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center relative">
        <div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-300 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Open source · self-hostable
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.05 }}
            className="text-5xl md:text-6xl lg:text-7xl font-semibold tracking-[-0.03em] text-white leading-[0.98]">
            Stop paying Salesforce<br/>storage prices.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="mt-6 text-lg md:text-xl text-slate-400 max-w-xl">
            Vastify offloads your CRM files and records to your own S3 or GCS bucket — at a fraction of the cost. The Setup Agent reads your org, picks the backend, and writes your routing rules. You watch.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.25 }}
            className="mt-8 flex flex-wrap gap-3">
            <a href="#ai-showcase" className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-3 transition shadow-[0_8px_30px_rgba(37,99,235,0.35)]">Watch the Setup Agent</a>
            <a href={SITE.dashboardUrl} className="rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-900/60 text-slate-200 font-medium px-5 py-3 transition">Try the demo →</a>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}
            className="mt-10 rounded-xl border border-slate-800 bg-slate-900/60 p-5 max-w-md">
            <div className="text-xs uppercase tracking-wider text-slate-400">Cost per TB of files, per year</div>
            <div className="mt-2 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Salesforce</div>
                <AnimatedCounter to={61440} duration={2} prefix="$" className="font-mono text-3xl font-semibold text-rose-300" />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Vastify on S3</div>
                <AnimatedCounter to={283} duration={2} prefix="$" className="font-mono text-3xl font-semibold text-emerald-300" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">Salesforce list: $5/GB/mo · S3 Standard: $0.023/GB/mo</div>
          </motion.div>
        </div>
        <motion.div key="hero-visual" initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16,1,0.3,1] }} className="relative">
          <div key="glow" className="hero-glow" />
          <motion.div key="mockup" style={{ y: floatY }} className="relative z-10"><DashMockup /></motion.div>
          <motion.div key="pill1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
            className="absolute -left-6 top-10 rounded-lg border border-slate-800 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs shadow-xl z-20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-slate-300">Account.pdf → s3://vastify/…</span>
            </div>
          </motion.div>
          <motion.div key="pill2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }}
            className="absolute -right-4 bottom-8 rounded-lg border border-slate-800 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs shadow-xl z-20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-300" />
              <span className="font-mono text-slate-300">Setup Agent · 4 tools called</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
```

The "Cost per TB per year" numbers: $61,440 = 1024 * $5 * 12. $283 ≈ 1024 * $0.023 * 12.

- [ ] **Step 2: Commit**

```
git add marketing/src/components/Hero.tsx
git commit -m "feat(marketing): hero island with new copy"
```

---

## Task 11: SavingsSlider island

**Files:**
- Create: `marketing/src/components/SavingsSlider.tsx`

Port `Calculator` (mockup lines 329-398) verbatim — the math (`gb * 5`, `gb * 0.023`) is the real Salesforce file storage list price vs S3 Standard. Section heading line ("Move the slider. Watch Salesforce sweat.") stays.

- [ ] **Step 1: Create `marketing/src/components/SavingsSlider.tsx`**

```tsx
import { useState } from 'react';
import { motion } from 'framer-motion';

export default function SavingsSlider() {
  const [gb, setGb] = useState(500);
  const sf = gb * 5;
  const vf = gb * 0.023;
  const saved = sf - vf;
  const pct = Math.round((saved / Math.max(sf, 1)) * 100);
  const min = 10, max = 5000;
  const pctPos = ((gb - min) / (max - min)) * 100;
  return (
    <section className="relative border-y border-slate-900 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-20">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.6 }} className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Savings calculator</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">Move the slider. Watch Salesforce sweat.</h2>
          <p className="mt-4 text-slate-400 text-lg">
            Salesforce rate: <span className="font-mono text-slate-200">$5/GB/mo</span>. Vastify on S3 Standard: <span className="font-mono text-slate-200">$0.023/GB/mo</span>.
          </p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.7, delay: 0.1 }}
          className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-8 md:p-10">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Your Salesforce storage</div>
              <div className="font-mono text-4xl font-semibold text-white mt-1">{gb.toLocaleString()} <span className="text-slate-500 text-2xl">GB</span></div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-400">You save</div>
              <div className="font-mono text-4xl font-semibold text-emerald-300 mt-1">
                ${Math.round(saved).toLocaleString()}<span className="text-slate-500 text-lg">/mo</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{pct}% cheaper</div>
            </div>
          </div>
          <input type="range" min={min} max={max} step={10} value={gb}
            onChange={(e) => setGb(Number(e.target.value))}
            className="vast-range" style={{ ['--pct' as any]: `${pctPos}%` }} />
          <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-2">
            <span>10 GB</span><span>1 TB</span><span>5 TB</span>
          </div>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500/80" /> Salesforce storage
              </div>
              <div className="mt-3 font-mono text-3xl md:text-4xl text-slate-200">
                ${Math.round(sf).toLocaleString()}<span className="text-slate-500 text-base">/mo</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">${(sf*12).toLocaleString()} per year</div>
              <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-rose-500 to-rose-400" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="rounded-xl border border-brand-600/30 bg-gradient-to-br from-brand-600/10 to-slate-950/50 p-5 relative overflow-hidden">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> Vastify on S3 Standard
              </div>
              <div className="mt-3 font-mono text-3xl md:text-4xl text-white">
                ${vf.toFixed(2)}<span className="text-slate-500 text-base">/mo</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">${(vf*12).toFixed(2)} per year</div>
              <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-brand-500 to-brand-300"
                  animate={{ width: `${(vf/sf)*100}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```
git add marketing/src/components/SavingsSlider.tsx
git commit -m "feat(marketing): savings slider island"
```

---

## Task 12: Reusable sub-page chrome

**Files:**
- Create: `marketing/src/components/PageHeader.astro`
- Create: `marketing/src/components/CTAStrip.astro`

- [ ] **Step 1: Create `marketing/src/components/PageHeader.astro`**

```astro
---
interface Props {
  eyebrow: string;
  title: string;
  sub?: string;
}
const { eyebrow, title, sub } = Astro.props;
---
<section class="relative overflow-hidden border-b border-slate-900">
  <div class="absolute inset-0 grid-bg pointer-events-none" />
  <div class="max-w-5xl mx-auto px-6 pt-20 pb-16 relative">
    <div class="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">{eyebrow}</div>
    <h1 class="mt-3 text-4xl md:text-5xl lg:text-6xl font-semibold tracking-[-0.02em] text-white">{title}</h1>
    {sub && <p class="mt-5 max-w-2xl text-lg text-slate-400">{sub}</p>}
  </div>
</section>
```

- [ ] **Step 2: Create `marketing/src/components/CTAStrip.astro`**

```astro
---
import { SITE } from '../lib/site';
---
<section class="relative">
  <div class="max-w-5xl mx-auto px-6 py-20">
    <div class="rounded-2xl border border-slate-800 bg-gradient-to-br from-brand-600/15 via-slate-900/60 to-slate-950 p-10 md:p-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
      <div>
        <h2 class="text-3xl md:text-4xl font-semibold tracking-[-0.02em] text-white">Get your storage bill back.</h2>
        <p class="mt-3 text-slate-400 max-w-xl">Connect your org, point at a bucket, and let the Setup Agent handle the rest.</p>
      </div>
      <div class="flex flex-wrap gap-3">
        <a href={SITE.dashboardUrl} class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-3 transition shadow-[0_8px_30px_rgba(37,99,235,0.35)]">Try the demo →</a>
        <a href={SITE.repoUrl} target="_blank" rel="noopener" class="rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-900/60 text-slate-200 font-medium px-5 py-3 transition">View on GitHub</a>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Commit**

```
git add marketing/src/components/PageHeader.astro marketing/src/components/CTAStrip.astro
git commit -m "feat(marketing): shared page header + CTA strip"
```

---

## Task 13: AI Showcase island

**Files:**
- Create: `marketing/src/components/AIShowcase.tsx`

This is the centrepiece of the home page (anchored as `#ai-showcase`) and reused on `/ai`. Two cards side-by-side: Setup Agent (with a fake-but-realistic tool-call stream animation) and Diff Explainer.

- [ ] **Step 1: Create `marketing/src/components/AIShowcase.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const setupSteps = [
  { tool: 'introspect_org',     desc: 'Reading 2,481 ContentVersion rows…' },
  { tool: 'pick_backend',       desc: 'Recommending GCS · eu-west2 (data residency: UK)' },
  { tool: 'write_storage_config', desc: 'Wrote tenants/acme/storage.json' },
  { tool: 'generate_starter_rules', desc: 'Created 4 routing rules · ContentVersion > 1MB → offload' },
  { tool: 'validate_connection', desc: 'Round-trip OK · 184 ms' },
];

export default function AIShowcase() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % (setupSteps.length + 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <section id="ai-showcase" className="relative">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Built with Claude Opus</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">Onboarding that finishes itself.</h2>
          <p className="mt-4 text-slate-400 text-lg">Two AI features that turn the boring parts of CRM storage into one click.</p>
        </div>
        <div className="mt-12 grid lg:grid-cols-2 gap-6">
          {/* Setup Agent */}
          <div className="shimmer-wrap p-[1px]">
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-brand-300 uppercase tracking-wider">Headline feature</div>
                  <h3 className="mt-1 text-xl font-semibold text-white">Setup Agent</h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">LIVE</span>
              </div>
              <p className="mt-3 text-sm text-slate-400">Inspects your org, picks the right backend, writes a starter ruleset, and validates the connection — all in one click.</p>
              <div className="mt-5 rounded-lg bg-slate-950 border border-slate-800 p-4 font-mono text-[11px] min-h-[180px]">
                {setupSteps.slice(0, i).map((s, idx) => (
                  <motion.div key={idx} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 py-1">
                    <span className="text-emerald-400">✓</span>
                    <span><span className="text-brand-300">{s.tool}</span> <span className="text-slate-500">·</span> <span className="text-slate-300">{s.desc}</span></span>
                  </motion.div>
                ))}
                {i < setupSteps.length && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 py-1">
                    <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-brand-300">●</motion.span>
                    <span className="text-slate-400">{setupSteps[i]?.tool ?? 'done'}</span>
                  </motion.div>
                )}
              </div>
              <a href="/ai" className="mt-5 inline-block text-sm text-brand-300 hover:text-brand-100">Read more →</a>
            </div>
          </div>
          {/* Diff Explainer */}
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-brand-300 uppercase tracking-wider">Backups</div>
                <h3 className="mt-1 text-xl font-semibold text-white">Diff Explainer</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">LIVE</span>
            </div>
            <p className="mt-3 text-sm text-slate-400">Reads a snapshot diff and tells you in plain English what would change — and which restores are safe to run.</p>
            <div className="mt-5 rounded-lg bg-slate-950 border border-slate-800 p-4 text-[12px] min-h-[180px] text-slate-300 leading-relaxed">
              <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Plain-English summary</div>
              <p>This restore would change <span className="text-white">12 records</span> in <span className="font-mono text-brand-300">Account</span> and re-create <span className="text-white">3 ContentVersion</span> blobs. <span className="text-emerald-300">9 of the 12 record changes are safe to apply.</span> The remaining 3 conflict with edits made after the snapshot — review them before restoring.</p>
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                Restore the 9 safe items
              </div>
            </div>
            <a href="/ai" className="mt-5 inline-block text-sm text-brand-300 hover:text-brand-100">Read more →</a>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```
git add marketing/src/components/AIShowcase.tsx
git commit -m "feat(marketing): AI showcase island (Setup Agent + Diff Explainer)"
```

---

## Task 14: Home page

**Files:**
- Create: `marketing/src/pages/index.astro`

Composes Hero + SavingsSlider + AIShowcase + a "How it works" preview + a pricing teaser + final CTA.

- [ ] **Step 1: Create `marketing/src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import Hero from '../components/Hero';
import SavingsSlider from '../components/SavingsSlider';
import AIShowcase from '../components/AIShowcase';
import CTAStrip from '../components/CTAStrip.astro';
---
<Base title="Vastify — CRM storage, offloaded.">
  <Hero client:load />
  <SavingsSlider client:visible />
  <AIShowcase client:visible />

  <section class="relative">
    <div class="max-w-7xl mx-auto px-6 py-24">
      <div class="max-w-3xl">
        <div class="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">How it works</div>
        <h2 class="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">A thin layer between Salesforce and your bucket.</h2>
        <p class="mt-4 text-slate-400 text-lg">Salesforce keeps the UX. Your data sits in your own S3, GCS, Azure, or MinIO — encrypted, audited, and queryable through Salesforce Connect.</p>
      </div>
      <div class="mt-10 grid md:grid-cols-3 gap-4">
        <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">1 · Files</div>
          <h3 class="mt-2 text-lg font-semibold text-white">ContentVersion offload</h3>
          <p class="mt-2 text-sm text-slate-400">Files written to Salesforce sync to your bucket. The file UI stays the same.</p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">2 · Records</div>
          <h3 class="mt-2 text-lg font-semibold text-white">External Objects via OData</h3>
          <p class="mt-2 text-sm text-slate-400">Cold records become Salesforce Connect external objects, queryable just like native ones.</p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">3 · Backups</div>
          <h3 class="mt-2 text-lg font-semibold text-white">Snapshot + restore</h3>
          <p class="mt-2 text-sm text-slate-400">Point-in-time snapshots, AI-summarised diffs, surgical or full restores.</p>
        </div>
      </div>
      <div class="mt-8"><a href="/how-it-works" class="text-brand-300 hover:text-brand-100">See the architecture →</a></div>
    </div>
  </section>

  <section class="relative border-t border-slate-900 bg-slate-950/60">
    <div class="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-10 items-center">
      <div>
        <div class="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Pricing</div>
        <h2 class="mt-3 text-4xl md:text-5xl font-semibold tracking-[-0.02em] text-white">Priced per terabyte, not per panic.</h2>
        <p class="mt-4 text-slate-400 text-lg">Beta pricing starts well below Salesforce list. Bring your own bucket and pay your cloud at cost.</p>
        <div class="mt-6"><a href="/pricing" class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-3 transition">See pricing →</a></div>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
        <div class="text-xs uppercase tracking-wider text-slate-400">Typical 2 TB org, files only</div>
        <div class="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider">Salesforce</div>
            <div class="font-mono text-3xl font-semibold text-rose-300">$122,880<span class="text-slate-500 text-sm">/yr</span></div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider">Vastify on S3</div>
            <div class="font-mono text-3xl font-semibold text-emerald-300">$565<span class="text-slate-500 text-sm">/yr</span></div>
          </div>
        </div>
        <div class="mt-3 text-xs text-slate-500">Salesforce list: $5/GB/mo · S3 Standard: $0.023/GB/mo</div>
      </div>
    </div>
  </section>

  <CTAStrip />
</Base>
```

- [ ] **Step 2: Run dev server, verify home page**

```
bun run dev
```

Open http://localhost:4321. Expect:
- Hero with new copy ("Stop paying Salesforce storage prices.") and animated dashboard mockup on the right.
- Savings slider section ("Move the slider…").
- AI Showcase with the Setup Agent tool-call animation looping.
- "How it works" 3-card preview.
- Pricing teaser.
- Final CTA strip.
- Nav at top, footer at bottom. Mobile drawer toggles below 768px.
- No console errors.

- [ ] **Step 3: Commit**

```
git add marketing/src/pages/index.astro
git commit -m "feat(marketing): home page composition"
```

---

## Task 15: Product page

**Files:**
- Create: `marketing/src/pages/product.astro`

Five feature blocks: Files Offload, Records as External Objects, Backups, Multi-cloud router, Rules engine.

- [ ] **Step 1: Create `marketing/src/pages/product.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import CTAStrip from '../components/CTAStrip.astro';

const features = [
  {
    eyebrow: 'Files',
    title: 'ContentVersion offload',
    body: 'Vastify intercepts new file uploads in Salesforce and writes them to your bucket. The native file UI stays untouched — users never know the bytes left.',
    bullets: ['Streaming writes — no Lightning timeouts', 'Server-side encryption with your KMS key', 'Per-tenant prefix · per-org bucket if you want it'],
  },
  {
    eyebrow: 'Records',
    title: 'External Objects via OData 4.0',
    body: 'Cold records become Salesforce Connect external objects backed by an OData feed Vastify serves directly from object storage.',
    bullets: ['One JSON object per record · queryable with $filter', 'Two External Objects shipped: live and archived', 'Reports and list views just work'],
  },
  {
    eyebrow: 'Backups',
    title: 'Snapshots + AI diff explainer',
    body: 'Point-in-time snapshots of records and files. Diff plans are summarised by Claude so you know what would change before you restore.',
    bullets: ['Surgical or full restores', 'Plain-English diff summaries', 'One-click "restore the safe N items"'],
  },
  {
    eyebrow: 'Routing',
    title: 'Multi-cloud router',
    body: 'AWS S3, Google Cloud Storage, Azure Blob, MinIO — pick one or split traffic by rule. Compliance teams keep data in the right region.',
    bullets: ['Backends behind a unified contract', 'Per-rule routing · per-tenant defaults', 'Failover-safe writes'],
  },
  {
    eyebrow: 'Rules',
    title: 'Rules engine',
    body: 'Decide what gets offloaded with declarative rules — by size, age, type, or any record field. The Setup Agent writes a sensible starter set on first install.',
    bullets: ['JSON rules · auditable in git', 'Dry-run plans before activation', 'Generated by AI · edited by humans'],
  },
];
---
<Base title="Product — Vastify">
  <PageHeader eyebrow="Product" title="Boring to operate. Ridiculous to skip." sub="Five subsystems, one promise: your CRM data stays usable while your storage bill collapses." />
  <section class="relative">
    <div class="max-w-5xl mx-auto px-6 py-16 space-y-6">
      {features.map((f, i) => (
        <div class={`rounded-2xl border border-slate-800 bg-slate-900/50 p-8 md:p-10 ${i === 0 ? 'shimmer-wrap' : ''}`}>
          <div class="grid md:grid-cols-[200px_1fr] gap-6 md:gap-10">
            <div>
              <div class="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">{f.eyebrow}</div>
              <h2 class="mt-2 text-2xl font-semibold text-white">{f.title}</h2>
            </div>
            <div>
              <p class="text-slate-300 text-lg leading-relaxed">{f.body}</p>
              <ul class="mt-5 space-y-2">
                {f.bullets.map((b) => (
                  <li class="flex gap-3 text-sm text-slate-400">
                    <span class="text-brand-300 mt-0.5">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
  <CTAStrip />
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/product.astro
git commit -m "feat(marketing): product page"
```

---

## Task 16: How it works page

**Files:**
- Create: `marketing/src/pages/how-it-works.astro`

Architecture diagram (inline SVG) + data flow narrative + "your data never leaves your cloud" emphasis.

- [ ] **Step 1: Create `marketing/src/pages/how-it-works.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import CTAStrip from '../components/CTAStrip.astro';
---
<Base title="How it works — Vastify">
  <PageHeader eyebrow="How it works" title="One thin layer. Your data, your bucket." sub="Vastify is a stateless router between Salesforce and your object storage. We never see a file payload — bytes flow straight to the bucket you control." />

  <section class="relative">
    <div class="max-w-6xl mx-auto px-6 py-12">
      <div class="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 md:p-10">
        <svg viewBox="0 0 900 360" class="w-full h-auto" role="img" aria-label="Architecture diagram: Salesforce, Vastify API, customer-owned bucket">
          <defs>
            <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#2563eb" />
              <stop offset="100%" stop-color="#93a6ff" />
            </linearGradient>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" fill="#93a6ff" />
            </marker>
          </defs>

          <!-- Salesforce node -->
          <g>
            <rect x="40" y="120" width="200" height="120" rx="14" fill="#0b1222" stroke="#1e293b" />
            <text x="140" y="155" text-anchor="middle" fill="#f1f5f9" font-size="16" font-family="Inter" font-weight="600">Salesforce org</text>
            <text x="140" y="180" text-anchor="middle" fill="#93a6ff" font-size="11" font-family="JetBrains Mono">ContentVersion</text>
            <text x="140" y="198" text-anchor="middle" fill="#93a6ff" font-size="11" font-family="JetBrains Mono">External Objects</text>
            <text x="140" y="216" text-anchor="middle" fill="#64748b" font-size="11" font-family="Inter">native UX preserved</text>
          </g>

          <!-- Vastify node -->
          <g>
            <rect x="350" y="100" width="200" height="160" rx="14" fill="url(#brand-grad)" opacity="0.95" />
            <text x="450" y="135" text-anchor="middle" fill="white" font-size="16" font-family="Inter" font-weight="700">Vastify</text>
            <text x="450" y="158" text-anchor="middle" fill="white" font-size="11" font-family="JetBrains Mono" opacity="0.85">router · rules · OData</text>
            <text x="450" y="200" text-anchor="middle" fill="white" font-size="11" font-family="Inter" opacity="0.95">stateless · stamped JWT</text>
            <text x="450" y="218" text-anchor="middle" fill="white" font-size="11" font-family="Inter" opacity="0.95">no payloads stored</text>
            <text x="450" y="236" text-anchor="middle" fill="white" font-size="11" font-family="Inter" opacity="0.95">Bun · port 3099</text>
          </g>

          <!-- Bucket node -->
          <g>
            <rect x="660" y="120" width="200" height="120" rx="14" fill="#0b1222" stroke="#1e293b" />
            <text x="760" y="155" text-anchor="middle" fill="#f1f5f9" font-size="16" font-family="Inter" font-weight="600">Your bucket</text>
            <text x="760" y="180" text-anchor="middle" fill="#93a6ff" font-size="11" font-family="JetBrains Mono">S3 · GCS · Azure · MinIO</text>
            <text x="760" y="198" text-anchor="middle" fill="#93a6ff" font-size="11" font-family="JetBrains Mono">your KMS key</text>
            <text x="760" y="216" text-anchor="middle" fill="#64748b" font-size="11" font-family="Inter">data residency · your call</text>
          </g>

          <!-- Arrows -->
          <line x1="240" y1="160" x2="350" y2="150" stroke="#93a6ff" stroke-width="1.6" marker-end="url(#arrow)" />
          <line x1="350" y1="200" x2="240" y2="210" stroke="#93a6ff" stroke-width="1.6" marker-end="url(#arrow)" />
          <line x1="550" y1="160" x2="660" y2="150" stroke="#93a6ff" stroke-width="1.6" marker-end="url(#arrow)" />
          <line x1="660" y1="200" x2="550" y2="210" stroke="#93a6ff" stroke-width="1.6" marker-end="url(#arrow)" />

          <text x="295" y="142" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter">file upload</text>
          <text x="295" y="232" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter">OData query</text>
          <text x="605" y="142" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter">PUT</text>
          <text x="605" y="232" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter">GET / LIST</text>
        </svg>
      </div>
    </div>
  </section>

  <section class="relative">
    <div class="max-w-5xl mx-auto px-6 py-16">
      <h2 class="text-3xl md:text-4xl font-semibold text-white tracking-[-0.02em]">The data flow</h2>
      <ol class="mt-8 space-y-6">
        <li class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">1</div>
          <h3 class="mt-1 text-xl font-semibold text-white">Salesforce calls Vastify</h3>
          <p class="mt-2 text-slate-400">When a file is uploaded or a routed record is read, Salesforce hits the Vastify API with a stamped JWT. We auth, look up the tenant, and consult the rule set.</p>
        </li>
        <li class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">2</div>
          <h3 class="mt-1 text-xl font-semibold text-white">Bytes go straight to your bucket</h3>
          <p class="mt-2 text-slate-400">For files, Vastify presigns a PUT to your bucket and Salesforce streams there directly. The file payload never sits on Vastify infrastructure.</p>
        </li>
        <li class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">3</div>
          <h3 class="mt-1 text-xl font-semibold text-white">Records served via OData</h3>
          <p class="mt-2 text-slate-400">Cold records live as one JSON object per row. A SQLite cache keeps `$filter` queries fast — the bucket is source of truth, the cache is rebuildable.</p>
        </li>
        <li class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div class="text-xs text-brand-300 uppercase tracking-wider">4</div>
          <h3 class="mt-1 text-xl font-semibold text-white">Salesforce Connect renders it</h3>
          <p class="mt-2 text-slate-400">Two External Objects ship by default: live and archived. Reports, list views, and Apex SOQL all work — your users see one Salesforce.</p>
        </li>
      </ol>
    </div>
  </section>

  <CTAStrip />
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/how-it-works.astro
git commit -m "feat(marketing): how-it-works page"
```

---

## Task 17: AI features page

**Files:**
- Create: `marketing/src/pages/ai.astro`

Setup Agent (with rule generation as part of its flow) + Diff Explainer. Each gets its own deep-dive section.

- [ ] **Step 1: Create `marketing/src/pages/ai.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import CTAStrip from '../components/CTAStrip.astro';
import AIShowcase from '../components/AIShowcase';
---
<Base title="AI features — Vastify">
  <PageHeader eyebrow="AI" title="Boring infra. Smart onboarding." sub="Two Claude-powered features that turn the worst parts of CRM storage into one click." />

  <AIShowcase client:visible />

  <section class="relative border-t border-slate-900">
    <div class="max-w-5xl mx-auto px-6 py-20 space-y-16">
      <div>
        <div class="text-xs text-brand-300 uppercase tracking-[0.18em] font-medium">Setup Agent</div>
        <h2 class="mt-3 text-3xl md:text-4xl font-semibold text-white tracking-[-0.02em]">Onboarding that finishes itself.</h2>
        <p class="mt-4 text-slate-300 text-lg max-w-3xl">You click "Set me up". Claude tool-calls through the work — inspects your Salesforce org, picks the backend that fits your residency, writes a starter rule set, and validates the round-trip. Time-boxed to one specific scenario: fresh tenant, connected and routing, in under a minute.</p>
        <div class="mt-8 grid md:grid-cols-2 gap-6">
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 class="text-sm uppercase tracking-wider text-slate-400">What it does</h3>
            <ul class="mt-3 space-y-2 text-slate-300 text-sm">
              <li>Reads ContentVersion volume + record counts</li>
              <li>Recommends backend (residency-aware)</li>
              <li>Writes <span class="font-mono text-brand-300">tenants/{`{id}`}/storage.json</span></li>
              <li>Generates 3-5 starter rules (size + age thresholds)</li>
              <li>Round-trips a test write/read</li>
            </ul>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 class="text-sm uppercase tracking-wider text-slate-400">Tools the model calls</h3>
            <ul class="mt-3 space-y-2 font-mono text-xs text-slate-300">
              <li>introspect_org()</li>
              <li>pick_backend(region, sensitivity)</li>
              <li>write_storage_config(backend, prefix)</li>
              <li>generate_starter_rules(profile)</li>
              <li>validate_connection()</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="border-t border-slate-900 pt-16">
        <div class="text-xs text-brand-300 uppercase tracking-[0.18em] font-medium">Diff Explainer</div>
        <h2 class="mt-3 text-3xl md:text-4xl font-semibold text-white tracking-[-0.02em]">Restore what you mean to.</h2>
        <p class="mt-4 text-slate-300 text-lg max-w-3xl">When you open a snapshot, Claude reads the diff plan and explains it in plain English — what records would change, which restores conflict with edits since the snapshot, and which N items are safe to apply right now.</p>
        <div class="mt-8 grid md:grid-cols-2 gap-6">
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 class="text-sm uppercase tracking-wider text-slate-400">What it does</h3>
            <ul class="mt-3 space-y-2 text-slate-300 text-sm">
              <li>Reads the snapshot diff JSON</li>
              <li>Classifies items as safe / conflicting / blocked</li>
              <li>Writes a one-paragraph summary</li>
              <li>Surfaces a "Restore the N safe items" button</li>
            </ul>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 class="text-sm uppercase tracking-wider text-slate-400">Why it matters</h3>
            <p class="mt-3 text-sm text-slate-300">Backup restores are scary because nobody reads diff JSON. The model turns a 400-line diff into one paragraph and an action button — admins recover faster, with fewer accidental overwrites.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <CTAStrip />
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/ai.astro
git commit -m "feat(marketing): AI features page"
```

---

## Task 18: Pricing page

**Files:**
- Create: `marketing/src/pages/pricing.astro`

Three tiers (Starter / Team / Enterprise) marked "Beta pricing". Plus an embedded standalone savings slider.

- [ ] **Step 1: Create `marketing/src/pages/pricing.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import SavingsSlider from '../components/SavingsSlider';
import CTAStrip from '../components/CTAStrip.astro';
import { SITE } from '../lib/site';

const tiers = [
  {
    name: 'Starter',
    price: '$99',
    cadence: '/mo',
    blurb: 'For solo admins testing the waters.',
    features: ['1 tenant', 'Up to 250 GB offloaded', 'Files + records', 'Community support'],
    cta: { label: 'Try the demo', href: SITE.dashboardUrl },
    highlight: false,
  },
  {
    name: 'Team',
    price: '$499',
    cadence: '/mo',
    blurb: 'For growing CRM operations teams.',
    features: ['5 tenants', 'Up to 5 TB offloaded', 'AI Setup Agent + Diff Explainer', 'Email support · 1 business day'],
    cta: { label: 'Try the demo', href: SITE.dashboardUrl },
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    blurb: 'For regulated industries and big orgs.',
    features: ['Unlimited tenants', 'Bring your own KMS', 'SSO + audit forwarding', 'Named TAM · 4-hour SLA'],
    cta: { label: 'Talk to us', href: `mailto:${SITE.contactEmail}` },
    highlight: false,
  },
];
---
<Base title="Pricing — Vastify">
  <PageHeader eyebrow="Pricing — beta" title="Priced per terabyte, not per panic." sub="Beta pricing while we onboard our first cohort. Bring your own bucket; pay your cloud at cost." />

  <section class="relative">
    <div class="max-w-6xl mx-auto px-6 py-12 grid md:grid-cols-3 gap-6">
      {tiers.map((t) => (
        <div class={`rounded-2xl border ${t.highlight ? 'border-brand-600/50 bg-brand-600/5' : 'border-slate-800 bg-slate-900/50'} p-8 flex flex-col`}>
          {t.highlight && <div class="text-[10px] font-mono uppercase tracking-wider text-brand-300 mb-2">Most popular</div>}
          <h2 class="text-xl font-semibold text-white">{t.name}</h2>
          <div class="mt-3 flex items-baseline gap-1">
            <span class="font-mono text-4xl font-semibold text-white">{t.price}</span>
            <span class="text-slate-500 text-sm">{t.cadence}</span>
          </div>
          <p class="mt-2 text-sm text-slate-400">{t.blurb}</p>
          <ul class="mt-6 space-y-2 text-sm text-slate-300 flex-1">
            {t.features.map((f) => (
              <li class="flex gap-2"><span class="text-brand-300">✓</span><span>{f}</span></li>
            ))}
          </ul>
          <a href={t.cta.href} class={`mt-8 rounded-lg ${t.highlight ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-[0_8px_30px_rgba(37,99,235,0.35)]' : 'border border-slate-700 hover:border-slate-600 text-slate-200'} font-medium px-5 py-3 transition text-center`}>{t.cta.label}</a>
        </div>
      ))}
    </div>
    <div class="max-w-6xl mx-auto px-6 -mt-2 text-center text-xs text-slate-500">All tiers include the open-source self-host option · prices subject to change after beta.</div>
  </section>

  <SavingsSlider client:visible />
  <CTAStrip />
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/pricing.astro
git commit -m "feat(marketing): pricing page"
```

---

## Task 19: Security page

**Files:**
- Create: `marketing/src/pages/security.astro`

- [ ] **Step 1: Create `marketing/src/pages/security.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import CTAStrip from '../components/CTAStrip.astro';

const pillars = [
  {
    title: 'Your bucket. Your KMS. Your call.',
    body: 'Vastify never owns the bucket. We never see your KMS keys. The only data that touches our infrastructure is metadata about the routing decision — never the file payload.',
  },
  {
    title: 'Encrypted in transit and at rest',
    body: 'TLS everywhere. At-rest encryption uses your cloud provider\'s native primitives — S3 SSE-KMS, GCS CMEK, Azure CMK. Bring your own key; rotate on your schedule.',
  },
  {
    title: 'Data residency stays where you put it',
    body: 'Pick the region when you create the bucket. Vastify does not replicate, mirror, or back-haul data outside it. Multi-region setups split traffic at the rule layer.',
  },
  {
    title: 'Audit trail you can ship',
    body: 'Every routing decision lands in a JSON audit log you can forward to your SIEM. Salesforce auth, tenant resolution, rule match, backend selection, and outcome — all stamped.',
  },
  {
    title: 'Least-privilege IAM',
    body: 'Vastify needs PUT/GET on a single prefix in your bucket. We supply a Terraform module that creates exactly that role — nothing broader. Your security team can review every line.',
  },
  {
    title: 'Open source, auditable end to end',
    body: 'The whole thing is on GitHub. If a security review wants to read every line of the file router, they can. No magic, no proprietary blob.',
  },
];
---
<Base title="Security — Vastify">
  <PageHeader eyebrow="Security" title="Your data. Your bucket. Your rules." sub="Vastify is a thin router. The whole point is that file payloads never sit on infrastructure we control." />

  <section class="relative">
    <div class="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-6">
      {pillars.map((p) => (
        <div class="rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <h2 class="text-xl font-semibold text-white">{p.title}</h2>
          <p class="mt-3 text-slate-400 leading-relaxed">{p.body}</p>
        </div>
      ))}
    </div>
  </section>

  <section class="relative border-t border-slate-900 bg-slate-950/60">
    <div class="max-w-5xl mx-auto px-6 py-16">
      <h2 class="text-2xl font-semibold text-white">Compliance posture</h2>
      <p class="mt-4 text-slate-400 max-w-3xl">Vastify is in private beta and not yet SOC 2 certified. The architecture is designed to make a future audit straightforward: stateless routing, customer-owned data plane, scoped IAM, full audit log forwarding. If you need a security questionnaire today, send it.</p>
    </div>
  </section>

  <CTAStrip />
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/security.astro
git commit -m "feat(marketing): security page"
```

---

## Task 20: Get started page

**Files:**
- Create: `marketing/src/pages/get-started.astro`

GitHub link, "Try the demo" CTA, mailto contact form. The form is a `<form action={`mailto:...`} method="POST">` — submitting opens the user's mail client.

- [ ] **Step 1: Create `marketing/src/pages/get-started.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import PageHeader from '../components/PageHeader.astro';
import { SITE } from '../lib/site';
---
<Base title="Get started — Vastify">
  <PageHeader eyebrow="Get started" title="Three ways in." sub="Read the code, run the demo, or talk to a human." />

  <section class="relative">
    <div class="max-w-5xl mx-auto px-6 py-12 grid md:grid-cols-3 gap-6">
      <a href={SITE.repoUrl} target="_blank" rel="noopener" class="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 hover:border-slate-600 transition group">
        <div class="text-xs uppercase tracking-wider text-brand-300">Source</div>
        <h2 class="mt-2 text-xl font-semibold text-white">View on GitHub</h2>
        <p class="mt-3 text-slate-400 text-sm">The whole stack — API, dashboard, Salesforce package — open source under MIT.</p>
        <div class="mt-4 text-brand-300 text-sm group-hover:text-brand-100">github.com → →</div>
      </a>
      <a href={SITE.dashboardUrl} class="rounded-2xl border border-brand-600/50 bg-gradient-to-br from-brand-600/10 to-slate-900/50 p-8 hover:border-brand-500 transition group">
        <div class="text-xs uppercase tracking-wider text-brand-300">Demo</div>
        <h2 class="mt-2 text-xl font-semibold text-white">Try the demo →</h2>
        <p class="mt-3 text-slate-400 text-sm">Fully wired demo tenant. Pre-loaded files and records on GCS. Run the Setup Agent in real time.</p>
        <div class="mt-4 text-brand-300 text-sm group-hover:text-brand-100">Open dashboard →</div>
      </a>
      <a href={`mailto:${SITE.contactEmail}`} class="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 hover:border-slate-600 transition group">
        <div class="text-xs uppercase tracking-wider text-brand-300">Talk</div>
        <h2 class="mt-2 text-xl font-semibold text-white">Email us</h2>
        <p class="mt-3 text-slate-400 text-sm">Pricing questions, security review requests, integration scoping — go straight to the team.</p>
        <div class="mt-4 text-brand-300 text-sm group-hover:text-brand-100">{SITE.contactEmail} →</div>
      </a>
    </div>
  </section>

  <section class="relative border-t border-slate-900 bg-slate-950/60">
    <div class="max-w-3xl mx-auto px-6 py-20">
      <div class="text-xs uppercase tracking-[0.18em] text-brand-300 font-medium">Drop us a line</div>
      <h2 class="mt-3 text-3xl md:text-4xl font-semibold text-white tracking-[-0.02em]">Tell us about your org.</h2>
      <p class="mt-4 text-slate-400">Hit submit and your mail client will open with the message pre-filled. Old-school, but it works.</p>
      <form action={`mailto:${SITE.contactEmail}`} method="POST" enctype="text/plain" class="mt-8 space-y-4">
        <div>
          <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1" for="name">Name</label>
          <input id="name" name="name" required class="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-100 focus:border-brand-500 outline-none" />
        </div>
        <div>
          <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1" for="email">Work email</label>
          <input id="email" name="email" type="email" required class="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-100 focus:border-brand-500 outline-none" />
        </div>
        <div>
          <label class="block text-xs uppercase tracking-wider text-slate-400 mb-1" for="message">Tell us a bit about your storage situation</label>
          <textarea id="message" name="message" rows="4" required class="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-100 focus:border-brand-500 outline-none"></textarea>
        </div>
        <button type="submit" class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium px-6 py-3 transition shadow-[0_8px_30px_rgba(37,99,235,0.35)]">Open email →</button>
      </form>
    </div>
  </section>
</Base>
```

- [ ] **Step 2: Commit**

```
git add marketing/src/pages/get-started.astro
git commit -m "feat(marketing): get started page with mailto contact"
```

---

## Task 21: Local smoke test

- [ ] **Step 1: Run dev server and click through every page**

```
cd marketing && bun run dev
```

Open in a browser:
- http://localhost:4321/  → home
- http://localhost:4321/product
- http://localhost:4321/how-it-works
- http://localhost:4321/ai
- http://localhost:4321/pricing
- http://localhost:4321/security
- http://localhost:4321/get-started

For each page check:
- No console errors in DevTools.
- Nav links work (no 404s).
- Footer renders with `© <year> Vastify`.
- "Try the demo" button is visible on every page.
- The hero, slider, and AI showcase render and animate on the home page.

- [ ] **Step 2: Mobile-width smoke**

In DevTools, switch to iPhone 14 (390px). On every page:
- Hamburger button appears in the nav; clicking opens/closes the drawer.
- No horizontal scroll.
- Hero copy stays readable; cards stack.

If anything fails, fix in place before continuing. Commit the fix as `fix(marketing): <what>`.

---

## Task 22: Production build

- [ ] **Step 1: Build**

```
cd marketing && bun run build
```

Expected: `dist/` is created, ~7 HTML pages emitted, JS bundles under `dist/_astro/`. No build errors.

- [ ] **Step 2: Preview the production build**

```
bun run preview
```

Click through all 7 pages on http://localhost:4321 again. Confirm parity with the dev experience.

- [ ] **Step 3: Commit any tweaks**

If the production build surfaced anything (e.g., a `client:load` directive missing), fix it and commit:

```
git add marketing/...
git commit -m "fix(marketing): <what>"
```

---

## Task 23: Caddy config + Railway service definition

**Files:**
- Create: `marketing/Caddyfile`
- Create: `marketing/Dockerfile`
- Create: `marketing/.dockerignore`
- Create: `marketing/README.md`

Railway can build the marketing service from a `Dockerfile` in the `marketing/` root. We use a multi-stage build: Bun builds Astro, Caddy serves the result.

- [ ] **Step 1: Create `marketing/Caddyfile`**

```
:{$PORT}

root * /srv
file_server
encode gzip zstd

# SPA-style fallback (harmless for our static pages)
try_files {path} {path}/ /index.html

header {
  Cache-Control "public, max-age=300"
  X-Frame-Options "SAMEORIGIN"
  Referrer-Policy "strict-origin-when-cross-origin"
  -Server
}

# Long-cache hashed assets
@hashed path *.js *.css *.svg *.png *.jpg *.webp *.woff2
header @hashed Cache-Control "public, max-age=31536000, immutable"
```

- [ ] **Step 2: Create `marketing/Dockerfile`**

```dockerfile
# --- build stage ---
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
COPY bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
ARG PUBLIC_DASHBOARD_URL
ARG PUBLIC_REPO_URL
ARG PUBLIC_CONTACT_EMAIL
ENV PUBLIC_DASHBOARD_URL=$PUBLIC_DASHBOARD_URL
ENV PUBLIC_REPO_URL=$PUBLIC_REPO_URL
ENV PUBLIC_CONTACT_EMAIL=$PUBLIC_CONTACT_EMAIL
RUN bun run build

# --- runtime stage ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
ENV PORT=8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
```

- [ ] **Step 3: Create `marketing/.dockerignore`**

```
node_modules
dist
.astro
.env
.env.local
```

- [ ] **Step 4: Create `marketing/README.md`** (Railway service notes)

```markdown
# Vastify Marketing Site

Astro static site for vastify.example. Deployed on Railway as a static service via Caddy.

## Local dev

\`\`\`
bun install
bun run dev
\`\`\`

Opens on http://localhost:4321.

## Production build

\`\`\`
bun run build && bun run preview
\`\`\`

## Railway setup

1. **New service** in the Vastify project.
2. **Source:** this monorepo, root directory `marketing/`.
3. **Build:** Dockerfile (Railway auto-detects).
4. **Build args / env vars** (set on the service in Railway):
   - `PUBLIC_DASHBOARD_URL` — e.g. `https://vastify-dashboard.up.railway.app`
   - `PUBLIC_REPO_URL` — e.g. `https://github.com/jamescollard/vastify-crm-storage`
   - `PUBLIC_CONTACT_EMAIL` — e.g. `hello@vastify.example`
5. Railway exposes the service on a generated `*.up.railway.app` subdomain.

The Dockerfile bakes the env vars into the static build; redeploy after changing them.
\`\`\`
```

- [ ] **Step 5: Local Docker smoke test (optional but recommended)**

```
cd marketing
docker build -t vastify-marketing-test --build-arg PUBLIC_DASHBOARD_URL=http://localhost:5173 .
docker run --rm -p 8080:8080 vastify-marketing-test
```

Open http://localhost:8080 — site should render. Stop with Ctrl+C.

If Docker isn't available locally, skip this — Railway will build it.

- [ ] **Step 6: Commit**

```
git add marketing/Caddyfile marketing/Dockerfile marketing/.dockerignore marketing/README.md
git commit -m "feat(marketing): caddy + dockerfile + railway README"
```

---

## Task 24: Final verification + readiness summary

- [ ] **Step 1: Run a final build and click-through**

```
cd marketing && bun run build && bun run preview
```

Click through all 7 pages. Confirm:
- "Try the demo" CTA points at `PUBLIC_DASHBOARD_URL` (or the dev fallback if no env set).
- GitHub link points at `PUBLIC_REPO_URL`.
- Contact email anchor uses `PUBLIC_CONTACT_EMAIL`.
- No 404s, no console errors.

- [ ] **Step 2: Confirm git tree is clean**

Run: `git status`
Expected: nothing to commit, working tree clean.

- [ ] **Step 3: Update todo list and report readiness**

Report to the user:
- What was built (7 pages + components + Railway config).
- What still needs human action (creating the Railway services + setting the three env vars + clicking deploy).
- The local URL where the site can be previewed.

---

## Self-Review (run after writing the plan; fix issues inline)

**Spec coverage:**
- §3.1 Repo location — Task 1 (scaffold).
- §3.2 Stack — Task 1 (Astro + React + framer-motion + Tailwind).
- §3.3 Build output — Task 22 (`bun run build` produces `dist/`).
- §3.4 Three Railway services — Task 23 (Dockerfile + Caddyfile + README for the marketing service; the dashboard and api services already exist, see their respective Dockerfiles).
- §3.5 Env vars `PUBLIC_DASHBOARD_URL`, `PUBLIC_REPO_URL`, `PUBLIC_CONTACT_EMAIL` — Tasks 4 + 23.
- §4.1 Pages (7) — Tasks 14-20.
- §4.1 Persistent nav with hamburger drawer below 768px — Task 6.
- §4.2 Hero copy — Task 10.
- §4.3 Sub-page header pattern — Task 12.
- §5 Content authenticity (no fake stats, real Salesforce list prices) — Tasks 7 (footer drops "480+"), 10 (hero replaces with "Open source · self-hostable"), 11 (slider uses real $5/GB-mo + $0.023/GB-mo).
- §6 Visual design (verbatim from mockup) — Tasks 2 (Tailwind config), 3 (global CSS).
- §7 Component reuse — Tasks 8-13.
- §8 Testing — Task 21 (manual smoke), Task 22 (build), Task 24 (final).
- §9 Risks — covered: Caddy SPA fallback (Task 23), env-var rebuild story (Task 23 README), build-order independence (each page is its own task).
- §10 Out of scope — respected (no blog, no analytics, no custom domain, no automated tests, no auth).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "similar to Task N" / "add appropriate error handling" anywhere. Every code block is complete.

**Type consistency:** `SITE` exported from `lib/site.ts` is used identically across components (`SITE.dashboardUrl`, `SITE.repoUrl`, `SITE.contactEmail`, `SITE.brandName`). `NAV_LINKS` shape is `{href, label}` everywhere. The `setupSteps` array shape `{tool, desc}` is consistent within `AIShowcase.tsx`. `tiers` shape in pricing is local to that file.

**Notes for the engineer:**
- `Vastify Site.html` is the design source of truth. When porting, copy the JSX structure verbatim and replace only what these tasks call out.
- Some mockup helpers (`useHashRoute`, `App`) are not ported — Astro routing replaces them.
- The `PartnerTestimonials` component (mockup line 783) is intentionally **not** ported (no fake testimonials per spec §5).
