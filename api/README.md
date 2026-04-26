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
├── events.ts          # In-memory pub/sub for SSE fanout
├── util/logger.ts     # JSON-line logger
│
├── agents/            # 🤖 Three Claude-powered agents — README + Mermaid
├── auth/              # API-key + JWT middleware — README + Mermaid
├── backup/            # CRM snapshot/diff/restore engine — README + Mermaid
├── db/                # bun:sqlite client + schema.sql — README
├── files/             # File upload/list/refresh — README + Mermaid
├── object/            # ObjectBackend interface + 4 impls — README + Mermaid
├── odata/             # OData 4.0 parser + SQL translator + handler — README + Mermaid
├── records/           # OData-backed record CRUD — README + Mermaid
├── routing/           # Rule engine + rules CRUD — README + Mermaid
├── rules/             # Rules REST routes
├── settings/          # Tenant settings REST routes
├── stats/             # Cost math + SSE — README + Mermaid
└── team/              # User/tenant member admin
```

Each subdirectory with a Mermaid badge has a `README.md` explaining its sequence and data flow:

| Module | Diagram |
|---|---|
| [`agents/`](src/agents/) | Setup-Agent autonomous tool loop + Diff-Explainer structured-output flow |
| [`auth/`](src/auth/) | API-key vs JWT layers |
| [`backup/`](src/backup/) | Snapshot capture, diff build, restore execution sequences |
| [`files/`](src/files/) | Upload sequence with routing decision |
| [`object/`](src/object/) | Backend class hierarchy + key layout |
| [`odata/`](src/odata/) | Read sequence + parser → SQL pipeline |
| [`records/`](src/records/) | Write/read flows with bucket vs index split |
| [`routing/`](src/routing/) | Decision algorithm flow |
| [`stats/`](src/stats/) | Cost math pipeline |

For the cross-module design (data flows between Salesforce → middleware → buckets, AI agent wiring, ER diagram), see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
