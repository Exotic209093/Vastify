# Vastify Dashboard

React + Vite + Tailwind + Recharts single-page app. Polls the Vastify API every 3 seconds for live savings, file/record distributions, and event activity. Includes a rule editor with an evaluation preview playground.

## Run

```bash
bun install
bun run dev        # :5173 — talks to API on :3099 via CORS
```

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Vite dev server with HMR |
| `bun run build` | Typecheck + production build |
| `bun run preview` | Serve the production build |
| `bun run typecheck` | `tsc --noEmit` |

## Configuration

Environment variables (prefix `VITE_`):

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:3099` | API base URL |
| `VITE_VASTIFY_API_KEY` | `vastify_demo_key_change_me` | Sent as `X-Vastify-Api-Key` on every request |

API key can also be set at runtime from the **Tenants** page (persists in `localStorage`).

## Pages

| Route | Purpose |
|---|---|
| `/dashboard` | Overview — hero net-savings ticker, storage-class donut, backend-bytes bar, recent events |
| `/dashboard/files` | Sortable file table; click a row to copy a fresh presigned URL |
| `/dashboard/records` | Live / Archived toggle, per-tier breakdown |
| `/dashboard/rules` | Priority-ordered list, inline enable/disable, routing-decision preview |
| `/dashboard/tenants` | API key management (localStorage-backed) |

## Why fetch directly and not through the Vite proxy?

`http-proxy-middleware` (which Vite uses) gets `AggregateError [ECONNREFUSED]` on Windows + Node 24 even when the target listens on both IPv4 and IPv6 and direct `fetch` / `http.request` reach it cleanly. The API has wide-open CORS so the dashboard just calls `http://localhost:3099` directly. See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the full rationale.
