# Vastify API

Bun + TypeScript middleware. Serves a REST API for the dashboard + Apex callouts, and an OData 4.0 surface for Salesforce Connect.

## Run

```bash
cp ../.env.example .env
bun install
bun run seed       # one-off: create demo tenant + default routing rules
bun run dev        # :3099
```

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Start with hot reload |
| `bun run start` | Start without hot reload (prod-ish) |
| `bun run test` | Run the test suite |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run seed` | Seed the demo tenant + default rules |
| `bun run seed:demo` | Seed 5 files + 40 live + 200 archived records for dashboard warm-up |

## Endpoints

### REST (`/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/files/upload` | API-key | Upload a file. Body: `{ originalName, contentType?, dataBase64, sfContentVersionId? }` |
| `GET` | `/v1/files/:id` | API-key | Get file metadata row |
| `GET` | `/v1/files/:id/refresh` | API-key | Mint a fresh presigned URL |
| `GET` | `/v1/files` | API-key | List files, paged |
| `DELETE` | `/v1/files/:id` | API-key | Delete file + backend object |
| `POST` | `/v1/records/archive` | API-key | Bulk archive. Body: `{ records: Interaction[] }` |
| `GET` | `/v1/records/:entity` | API-key | Dashboard view of the SQLite index |
| `GET` | `/v1/records/stats` | API-key | Live + archived counts |
| `GET` | `/v1/stats` | API-key | Cost math snapshot |
| `GET` | `/v1/stats/events` | API-key | SSE event stream |
| `GET/POST/PUT/DELETE` | `/v1/rules[/:id]` | API-key | CRUD on routing rules |
| `POST` | `/v1/rules/preview` | API-key | Preview a routing decision for a shape |

### OData 4.0 (`/odata/v1`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/odata/v1/` | Service document |
| `GET` | `/odata/v1/$metadata` | EDMX schema |
| `GET` | `/odata/v1/:entity` | List with `$filter`, `$orderby`, `$top`, `$skip`, `$select`, `$count` |
| `GET` | `/odata/v1/:entity(pk)` | Read single |
| `POST` | `/odata/v1/:entity` | Create (Interaction only) |
| `PATCH/PUT` | `/odata/v1/:entity(pk)` | Update (Interaction only) |
| `DELETE` | `/odata/v1/:entity(pk)` | Delete (Interaction only) |

Set `VASTIFY_DEMO_PUBLIC_ODATA=true` to skip API-key enforcement on OData (demo mode only — falls back to the demo tenant).

## Layout

```
src/
├── server.ts          # Bun.serve + Hono wiring
├── config.ts          # env loader + backend configs
├── auth/              # API-key middleware
├── db/                # bun:sqlite client + schema.sql
├── object/            # ObjectBackend interface + S3/GCS/Azure/MinIO impls
├── routing/           # Rule engine + rules CRUD
├── files/             # File upload/list/refresh
├── records/           # OData-backed record CRUD
├── odata/             # Parser + SQL translator + HTTP handler + $metadata
├── stats/             # Cost math + SSE
├── rules/             # Rules REST routes
├── tenants/           # Tenant CRUD (minimal)
├── events.ts          # In-memory pub/sub for SSE fanout
└── util/logger.ts     # JSON-line logger
```

See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the full design.
