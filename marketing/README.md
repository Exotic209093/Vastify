# Vastify Marketing Site

Astro static site. Deployed on Railway via Caddy.

## Local dev

```
bun install
bun run dev
```

Opens on http://localhost:4321.

## Production build

```
bun run build && bun run preview
```

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
