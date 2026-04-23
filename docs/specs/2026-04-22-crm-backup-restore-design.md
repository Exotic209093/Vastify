# Infinity Docs — CRM Backup & Restore (Design Spec)

**Status:** Approved design, ready for implementation plan
**Date:** 2026-04-22
**Scope:** Vertical slice of a multi-tenant CRM backup/restore product, plumbed into the existing Infinity Docs service. Hackathon deliverable (live end-to-end demo on real Salesforce orgs).

---

## 1. Context & goals

Infinity Docs today is a Salesforce-native document generation platform. The hackathon pitch reframes the product as a **multi-tenant CRM backup and restore system** built on the same service infrastructure. Six pitch differentiators drive the design:

1. Metadata and data backed up as a single **linked snapshot** (schema + records + files captured at the same point in time).
2. **Relationship-aware restore with dry-run diff** (users see exactly what will change record by record, including cascades through lookups, master-detail, and junction objects).
3. **Multi-org by design** with per-tenant isolation and a single console.
4. **Git-backed metadata history** per org (every metadata snapshot committed to a Git repo).
5. **Sandbox-first restore** as the default (user-selectable source/target).
6. **Storage-agnostic multi-tenant storage** (not tied to S3 or GCS).

The existing Infinity Docs service already provides ~60% of the hard infrastructure: multi-tenant JWT auth, pluggable storage adapters (S3/GCS/Files), a relationship-aware data model primitive (`TemplateDataModel__c`), an admin portal shell, and tenant-scoped SQLite persistence. This spec defines what to add.

### 1.1 In scope (hackathon slice)

- Live demo on real Salesforce orgs (source + user-selectable target).
- HubSpot read-only integration (snapshot + diff; no restore).
- Dynamic schema discovery for snapshot scope (cycle-aware DAG walk).
- Capture of **records + metadata + file blobs** for Salesforce; **records + metadata + file URLs** for HubSpot.
- Relationship-aware diff with cascade analysis.
- Restore with drift detection, topological ordering, ID remapping, and explicit cascade-delete confirmation.
- Git commit of metadata JSON per snapshot (one repo per tenant, one branch per connected org).
- Admin portal pages for connected orgs, scopes, snapshots, diff preview, and restore history.

### 1.2 Out of scope (explicit roadmap items)

- HubSpot **restore** (read-only for demo).
- Sandbox auto-provisioning (user must supply a target sandbox / scratch org).
- Non-Git metadata version control (SVN, Azure DevOps, etc.).
- KMS-backed vault rotation (demo uses env-var master key; flagged to rotate pre-prod).
- Scheduled snapshots (demo is manual-trigger only).
- Compliance/retention policies (immutable backups, legal hold). Deferred to v2.

---

## 2. Architecture (Approach 1 — service-heavy)

All backup/restore logic lives in the existing Node service. The Salesforce managed package is unchanged except for one deep-link tile. The service talks directly to each connected CRM over OAuth; Apex is not on the hot path.

```
┌──────────────────────────┐         ┌──────────────────────────────────────┐
│  Salesforce Org(s)       │         │  Node Service (existing, extended)   │
│  (source + target)       │         │                                      │
│                          │         │  ┌──────────────┐ ┌───────────────┐  │
│  Managed package         │◀──OAuth─┤  │ Render API   │ │ Backup API    │  │
│  (unchanged)             │         │  │ (existing)   │ │ (NEW)         │  │
│                          │         │  └──────────────┘ └──────┬────────┘  │
└──────────────────────────┘         │                          │           │
                                     │       ┌──────────────────▼─────────┐ │
┌──────────────────────────┐         │       │ BackupEngine (NEW)         │ │
│  HubSpot Portal(s)       │◀──OAuth─┤       │  ├─ CRMAdapter (SF, HS)    │ │
│  (read-only for demo)    │         │       │  ├─ SchemaWalker           │ │
└──────────────────────────┘         │       │  ├─ SnapshotCapture        │ │
                                     │       │  ├─ DiffEngine             │ │
                                     │       │  ├─ RestoreExecutor        │ │
                                     │       │  └─ GitSync                │ │
                                     │       └───┬────────────┬───────────┘ │
                                     │           │            │             │
                                     │  ┌────────▼───┐ ┌──────▼──────────┐  │
                                     │  │ Storage    │ │ Credential      │  │
                                     │  │ Adapters   │ │ Vault (NEW)     │  │
                                     │  │ (existing) │ │                 │  │
                                     │  └─────┬──────┘ └─────────────────┘  │
                                     │        │                             │
                                     │        │    ┌─────────────────────┐  │
                                     │        │    │ Admin Portal (ext.) │  │
                                     │        │    │ + new Backups UI    │  │
                                     │        │    └─────────────────────┘  │
                                     └────────┼─────────────────────────────┘
                                              ▼
                                       S3 / GCS / Files      Git repo
                                       (snapshot archives)   (metadata history)
```

### 2.1 Key architectural decisions

- **Service-heavy.** Multi-org must live outside any one Salesforce org. HubSpot can only live in the service. Git libraries (`simple-git`) are Node-native. Governor limits don't apply.
- **Admin UI in the Node service's existing admin portal**, not in a new Salesforce LWC. The product manages *many* orgs; it can't structurally live inside one of them. A small deep-link tile on the existing SF admin tab opens the portal for discoverability.
- **Credential vault is new service code.** Stores OAuth refresh tokens for N Salesforce orgs + N HubSpot portals per tenant, encrypted at rest with a per-tenant key derived from an env-var master key.
- **Snapshot archives reuse existing storage adapters.** No new storage code. Different path prefix (`/snapshots/...`) from document outputs.
- **Git is a new module in the service**, running locally on disk and pushing to a configurable remote. One repo per tenant, one branch per connected org.
- **Zero new Apex, zero new Salesforce custom objects.** One new `CustomMetadataType` (`idoc_BackupPortal__mdt`) for the deep-link URL.

---

## 3. Components

Eight new units in the service. Each has one clear purpose and communicates through a narrow interface.

### 3.1 `CRMAdapter` (interface) + `SalesforceAdapter`, `HubSpotAdapter`

Abstracts per-CRM operations. Everything above this layer is CRM-agnostic.

```typescript
interface CRMAdapter {
  listObjects(): Promise<ObjectDescriptor[]>;
  describe(objectName: string): Promise<ObjectSchema>;
  queryRecords(objectName: string, fields: string[], where?: string): AsyncIterable<Record>;
  downloadFile(fileRef: FileRef): Promise<Readable>;
  // Write path — Salesforce only for demo
  upsertRecord(objectName: string, record: Record, idRemap: IdRemap): Promise<string>;
  deployMetadata(metadata: MetadataItem[]): Promise<DeployResult>;
  uploadFile(file: FileBlob, linkTo: RecordRef): Promise<string>;
}
```

`SalesforceAdapter` wraps Metadata API + REST + Bulk API. `HubSpotAdapter` implements read-only methods and throws on write methods (for demo). Adding a third CRM later = one new adapter file.

### 3.2 `CredentialVault`

Per-tenant encrypted OAuth token store. Encrypts with AES-256-GCM using `HKDF(master, tenantId)` as key. Auto-refreshes expired access tokens using the stored refresh token.

```typescript
vault.getCredentials(tenantId, connectedOrgId): Promise<Credentials>
vault.connect(tenantId, crmType, oauthCode): Promise<ConnectedOrg>
vault.disconnect(tenantId, connectedOrgId): Promise<void>
```

### 3.3 `SchemaWalker`

Given a root object and max depth, dynamically discovers all reachable relationships via `describe()`. Returns a DAG (nodes = objects, edges = relationships with type: lookup/master-detail/junction). Handles cycles by marking revisited nodes and breaking the back-edge.

Depends only on `CRMAdapter.describe()` — works against any CRM.

### 3.4 `SnapshotCapture`

Orchestrates a snapshot. Streams records (NDJSON), metadata (JSON), and file blobs into an archive assembled with Node's `archiver` library. Uploads to storage via the existing storage adapter interface.

Parallelism is tunable per adapter (default 4 concurrent object-type fetches).

### 3.5 `DiffEngine`

Pure function: `(snapshot, targetOrgState) → DiffPlan`. Classifies each record as insert / update / delete / unchanged; for updates, computes field-level changes; for deletes, analyzes cascades through the DAG. No writes.

Easy to unit test with fixtures.

### 3.6 `RestoreExecutor`

Only unit that writes. Applies a DiffPlan in topological order:

1. Metadata deploys
2. Inserts (parents → children)
3. Updates
4. Deletes (children → parents)
5. Junction operations

Maintains an ID-remap table to rewrite FK fields when inserting children. Supports `mode: 'dry-run'` that walks the plan without calling any write method. Requires `{ confirm: true }` for execute mode. Re-verifies drift hash before starting.

### 3.7 `GitSync`

One bare working clone per tenant at `/var/lib/idoc/git/{tenantId}/`. One branch per connected org: `{crmType}-{externalOrgId}-{slug}`. One commit per completed snapshot with message `"snapshot {id} — {scope.name} — {count} metadata items"`. Pushes to configured remote (`gitRemoteUrl` + PAT from the vault).

Runs async off the snapshot hot path. Push failures are logged and surfaced as retryable warnings in the UI; they never fail the snapshot.

### 3.8 `BackupAPI` (HTTP layer)

Express routes added alongside the existing Render API, same JWT auth + tenant isolation middleware:

- `POST /backups` — start a snapshot given a scope ID
- `GET /backups` — list snapshots for the tenant
- `GET /backups/:id` — snapshot detail
- `POST /backups/:id/diff` — build a DiffPlan for a chosen target org
- `POST /backups/:id/restore` — execute restore (requires `confirm: true`)
- `GET /connected-orgs` / `POST /connected-orgs/connect` / `DELETE /connected-orgs/:id` — vault operations
- `GET /scopes` / `POST /scopes` — backup scope CRUD

---

## 4. Data model

Three storage surfaces: service SQLite (operational state), blob storage (archives), Git (metadata history).

### 4.1 SQLite — 4 new tables

```sql
CREATE TABLE ConnectedOrg (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  crmType TEXT NOT NULL CHECK (crmType IN ('salesforce','hubspot')),
  displayName TEXT NOT NULL,
  instanceUrl TEXT NOT NULL,
  externalOrgId TEXT NOT NULL,
  isSandbox INTEGER NOT NULL DEFAULT 0,
  oauthRefreshTokenEncrypted BLOB NOT NULL,
  oauthAccessTokenCache TEXT,
  accessTokenExpiresAt INTEGER,
  gitRemoteUrl TEXT,
  connectedAt INTEGER NOT NULL,
  lastUsedAt INTEGER,
  UNIQUE(tenantId, externalOrgId)
);

CREATE TABLE BackupScope (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  connectedOrgId TEXT NOT NULL REFERENCES ConnectedOrg(id),
  name TEXT NOT NULL,
  rootObject TEXT NOT NULL,
  maxDepth INTEGER NOT NULL DEFAULT 3,
  includeFiles INTEGER NOT NULL DEFAULT 1,
  includeMetadata INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
);

CREATE TABLE Snapshot (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  connectedOrgId TEXT NOT NULL REFERENCES ConnectedOrg(id),
  backupScopeId TEXT NOT NULL REFERENCES BackupScope(id),
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed')),
  archiveStorageKey TEXT,
  archiveStorageAdapter TEXT,
  gitCommitSha TEXT,
  recordCount INTEGER,
  fileCount INTEGER,
  metadataItemCount INTEGER,
  sizeBytes INTEGER,
  startedAt INTEGER NOT NULL,
  completedAt INTEGER,
  error TEXT
);

CREATE TABLE RestoreJob (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  snapshotId TEXT NOT NULL REFERENCES Snapshot(id),
  targetOrgId TEXT NOT NULL REFERENCES ConnectedOrg(id),
  mode TEXT NOT NULL CHECK (mode IN ('dry-run','execute')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','partial','failed')),
  diffPlanStorageKey TEXT,       -- points to the DiffPlan this restore was built from
  appliedChangesSummary TEXT,    -- JSON: {inserted, updated, deleted, failed}
  startedAt INTEGER NOT NULL,
  completedAt INTEGER,
  error TEXT
);

CREATE TABLE DiffPlan (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  snapshotId TEXT NOT NULL REFERENCES Snapshot(id),
  targetOrgId TEXT NOT NULL REFERENCES ConnectedOrg(id),
  storageKey TEXT NOT NULL,       -- blob location of full plan JSON
  targetStateHash TEXT NOT NULL,  -- used for drift detection at execute time
  summaryCounts TEXT NOT NULL,    -- JSON: {insert, update, delete, unchanged}
  builtAt INTEGER NOT NULL,
  expiresAt INTEGER               -- plans auto-expire to force re-diff after drift window
);

CREATE INDEX idx_snapshot_tenant ON Snapshot(tenantId, startedAt DESC);
CREATE INDEX idx_restore_tenant ON RestoreJob(tenantId, startedAt DESC);
CREATE INDEX idx_connectedorg_tenant ON ConnectedOrg(tenantId);
CREATE INDEX idx_diffplan_tenant ON DiffPlan(tenantId, builtAt DESC);
CREATE INDEX idx_diffplan_lookup ON DiffPlan(snapshotId, targetOrgId, builtAt DESC);
```

All tables scoped by `tenantId` and filtered in every query via the existing tenant-scoped repo pattern.

### 4.2 Archive layout (zip per snapshot)

Written via existing storage adapters to `/snapshots/{tenantId}/{connectedOrgId}/{snapshotId}.zip`:

```
manifest.json              — scope, counts, timestamps, schemaVersion, gitCommitSha
schema-graph.json          — DAG from SchemaWalker (nodes, edges, cycle breaks)
metadata/
  objects/{ObjName}.json
  fields/{ObjName}.{FieldName}.json
  flows/{FlowName}.json
  validationRules/...json
records/
  {ObjName}.ndjson         — one record per line (streamable)
files/                     — Salesforce only
  {ContentVersionId}.bin
  {ContentVersionId}.meta.json
```

NDJSON is chosen so diff/restore can stream-read records without loading whole tables into memory.

### 4.3 Git repo layout

One repo per tenant, one branch per connected org. **Only metadata** — no records, no blobs.

```
metadata/
  objects/Account.json
  fields/Account.Industry.json
  flows/LeadScoring.json
  validationRules/...
manifest.json              — snapshotId, timestamp, scope
```

Each snapshot = one commit. `git log`, `git blame`, and proper diffs are available for free on metadata history.

**Demo repo host:** local disk pushed to a single throwaway GitHub repo. Post-demo, configurable per tenant.

### 4.4 Salesforce-side changes

- **Zero** new Apex.
- **Zero** new custom objects.
- **One** new `CustomMetadataType`: `idoc_BackupPortal__mdt` with field `PortalUrl__c`. Used by the existing admin LWC tab to render a "Backups →" deep link. Total SF-side addition: ~10 lines of LWC markup.

---

## 5. Data flows

### 5.1 Snapshot flow

```
User clicks "Snapshot now" on a BackupScope
  │
  ▼
POST /backups { scopeId }  ──▶  BackupAPI creates Snapshot(status=pending)
  │
  ▼
BackupEngine.run(snapshotId) — background worker:
  1. CredentialVault.getCredentials(tenant, sourceOrg)   → OAuth access token
  2. SchemaWalker.walk(scope.rootObject, scope.maxDepth) → DAG (objects + edges, cycles broken)
  3. Parallel fan-out:
       ├─ SnapshotCapture.fetchRecords(DAG)        → stream to records/{Obj}.ndjson
       ├─ SnapshotCapture.fetchMetadata(DAG)       → stream to metadata/*.json
       └─ SnapshotCapture.fetchFiles(record refs)  → stream to files/*.bin
  4. Assemble manifest.json + schema-graph.json
  5. Zip archive → StorageAdapter.put(tenantId, key)
  6. GitSync.commit(metadata/, "snapshot {id}…")   → gitCommitSha
  7. Update Snapshot(status=complete, counts, sha)
```

Failure anywhere = Snapshot marked `failed` with error detail. Archive uploaded atomically via temp key + rename. Git commit is async and best-effort; failure surfaces as a retryable warning but does not fail the snapshot.

### 5.2 Diff flow (dry-run)

```
User picks Snapshot S and Target Org T → clicks "Preview restore"
  │
  ▼
POST /backups/:snapshotId/diff { targetOrgId }
  │
  ▼
RestoreExecutor.buildDiffPlan(S, T):
  1. Load archive (streaming)
  2. For each object in schema-graph:
       a. Read snapshot records (ndjson)
       b. Query live records in T matching the same external keys
       c. Row-level classify: insert / update / delete / unchanged
       d. Field-level changes for updates
       e. Cascade analysis: deleted parents → child FK implications
  3. Topological sort from schema-graph (parents before children, junctions last)
  4. Assemble DiffPlan { operations, warnings, counts, targetStateHash }
  5. Persist DiffPlan row (SQLite) + full plan JSON at /diff-plans/{tenantId}/{diffPlanId}.json
  6. Return summary + first N operations to the UI
```

DiffEngine is pure. Deterministic given (snapshot archive, target org snapshot-at-query-time). Unit-testable with fixtures.

**Record matching across orgs.** Target records are matched to snapshot records using, in preference order:

1. An external-ID field on the object type if one exists (`idoc_SnapshotSourceId__c` convention — written during restore for future re-matching).
2. A composite natural key derived from user-configurable key fields per object type (defined on `BackupScope`).
3. Fallback: treat all records as inserts, relying on ID remap for FK linkage. Acceptable for a "data loss recovery" scenario (the demo case) where the target is mostly empty.

For the hackathon demo the fallback is fine; option 1 is implemented if time permits for cleaner re-restores.

### 5.3 Restore flow (execute)

```
User reviews DiffPlan → ticks cascade-delete checkboxes → clicks "Execute restore"
  │
  ▼
POST /backups/:snapshotId/restore { targetOrgId, diffPlanId, confirm: true }
  │
  ▼
RestoreExecutor.execute(DiffPlan, T):
  1. Re-verify target-state hash unchanged since diff built
     - Drift → return 409, UI prompts rebuild diff
  2. For each operation in topological order:
       - Metadata deploys first
       - Inserts (parents → children)
       - Updates
       - Deletes (children → parents)
       - Junction operations last
  3. Maintain ID-remap table: { snapshotRecordId → newTargetId }
  4. Files: upload blob via CRMAdapter.uploadFile, link to record
  5. Each op logged to appliedChangesSummary; per-op failures captured
  6. Final status: complete | partial | failed
```

Guarantees:
- **Never partial-destructive without explicit confirmation.** `{ confirm: true }` required on every execute call.
- **Drift-safe.** Target hash re-checked before any write.
- **Continues past partial failures.** Partial results are visible in the UI; a "retry failed ops only" button is available.
- **Per-row cascade-delete confirmation.** UI disables Execute until every cascade-delete checkbox is ticked.

---

## 6. UI surface

Six new pages added under `/admin/backups/*` in the existing admin portal.

| Page | Path | Purpose |
|---|---|---|
| **Connected Orgs** | `/admin/backups/orgs` | Manage credential vault. OAuth Connect/Disconnect for SF + HubSpot. |
| **Scopes** | `/admin/backups/scopes` | Define what to snapshot. Root object, maxDepth, toggle files/metadata. Preview shows schema DAG. |
| **Snapshots** | `/admin/backups/snapshots` | History table. Filterable by org/scope/date. Columns: timestamp, scope, records, files, size, status, git commit link. |
| **Snapshot detail** | `/admin/backups/snapshots/:id` | Manifest summary, per-object counts, archive + git links, list of restores run against this snapshot. |
| **Diff preview** | `/admin/backups/restores/:id/diff` | Source snapshot + target picker. Table grouped by object type with `+INSERT / ~UPDATE / -DELETE / =UNCHANGED` chips. Field-level expand for updates. Red banner + per-row checkboxes for cascade deletes. Dry-run button + Execute button (disabled until all checkboxes ticked). |
| **Restore history** | `/admin/backups/restores` | Audit log of RestoreJobs with drill-in for appliedChangesSummary. |

**Visual style:** matches existing admin portal (reuse CSS, components). No new design system.

**Salesforce deep-link tile:** ~10 lines of LWC markup on existing admin tab. Click → opens `/admin/backups/snapshots` in a new tab. No business logic on SF side.

---

## 7. Cross-cutting concerns

### 7.1 Git integration

- **Library:** `simple-git` (wraps the git binary).
- **Location:** `/var/lib/idoc/git/{tenantId}/`.
- **Remote:** configured per tenant in `ConnectedOrg.gitRemoteUrl` + PAT in vault. Demo uses one throwaway GitHub repo.
- **Branches:** `{crmType}-{externalOrgId}-{slug}`, e.g. `salesforce-00Dxx000001gP1iEAE-acme-prod`.
- **Commits:** one per completed snapshot. Author = tenant owner email; committer = `infinity-docs-bot`. Message body includes snapshot ID, scope, counts, archive storage key.
- **Failure:** async off the hot path; logged; surfaced as retryable warning in UI; never blocks snapshot.

### 7.2 Error handling & retries

- **OAuth refresh:** auto on 401. One retry per call.
- **Rate limits:** honor `Retry-After` / CRM rate-limit headers with exponential backoff. Default parallelism = 4 concurrent object-type fetches; tunable per adapter.
- **Transient snapshot errors:** 3 retries per call. Any ultimately-failed object-type fetch fails the whole snapshot (no partial snapshots — they'd be landmines at restore time).
- **Transient restore errors:** 3 retries per op. After that, mark op failed in `appliedChangesSummary`, continue restore (never abort halfway), final status = `partial`. UI supports "retry failed ops only".
- **Drift:** target-state hash computed at diff time, re-checked at restore time. Mismatch → 409.

### 7.3 Security & secrets

- **Vault encryption:** AES-256-GCM. Per-tenant key = `HKDF(master, tenantId)`. Master key from `IDOC_VAULT_MASTER_KEY` env var.
- **Demo-only:** static env-var master key. **Flagged to rotate to KMS before production.**
- **Transport:** TLS for all CRM calls and GitHub push.
- **Blast-radius controls:** `{ confirm: true }` required on every execute. Rate-limited to 1 concurrent restore per tenant.
- **Audit:** every snapshot + restore append-only logged with actor, tenant, timestamps, counts.

### 7.4 Testing strategy

- **Unit:** `SchemaWalker`, `DiffEngine`, `RestoreExecutor` ordering/remap logic — all pure, fixture-driven. Target 90%+ coverage.
- **Integration:** `SalesforceAdapter` against a CI scratch org; `HubSpotAdapter` against a sandbox developer account. Snapshot a tiny known-object tree, assert archive shape.
- **Round-trip:** snapshot → restore into clean scratch org → re-snapshot → assert archives equivalent modulo IDs. Core correctness test.
- **Chaos:** inject 429s, 500s, connection drops during snapshot + restore. Assert retries + partial-restore behaviour.

### 7.5 Demo plan (5–7 minutes, live)

1. **Setup (off-camera):** SF1 (source) + SF2 (target sandbox) connected; HubSpot portal connected; scope on SF1 (Account, depth 3, files + metadata).
2. **Snapshot SF1.** Show archive size, counts, git commit link → GitHub diff.
3. **Simulate data loss on SF2** (delete Account + cascade pre-demo).
4. **Preview restore** from snapshot → SF2. Show diff table, field-level changes, cascade-delete warning with checkbox.
5. **Dry-run restore.** Show "what would happen" output.
6. **Execute restore.** Progress bar, final counts, refresh SF2 to show recovered data + files.
7. **Cross-org view:** HubSpot vs SF1 snapshot for a matching Contact (sells multi-CRM).
8. **Git history:** `git log` on tenant repo, click a commit to show metadata diff when a field was added.

---

## 8. Work estimate

| Area | Hours |
|---|---|
| CredentialVault + OAuth flows (SF + HubSpot) | 6 |
| SalesforceAdapter (describe, SOQL, Metadata API, files, write paths) | 10 |
| HubSpotAdapter (read-only) | 4 |
| SchemaWalker (DAG + cycle handling) | 4 |
| SnapshotCapture + archive assembly | 5 |
| DiffEngine + topological sort | 5 |
| RestoreExecutor (inc. ID remap, cascades, drift check) | 6 |
| GitSync + GitHub push | 3 |
| Admin portal UI (6 pages) | 8 |
| Testing (unit + one round-trip integration) | 5 |
| Demo prep + fixture orgs + rehearsal | 4 |
| **Total** | **60** |

Budget is ~50 hours. Overshoot is ~20%. Scope knobs if tightening is required:

- **Drop HubSpot entirely** (−4 hrs): cleaner story, Salesforce-only.
- **Drop file/blob capture** (−4 hrs from adapter + restore): pulls one pitch strength.

Recommendation: leave scope at ~60 and cut live if budget tightens.

---

## 9. Open questions

None blocking. All major decisions are locked:

- Approach 1 (service-heavy) ✓
- SF-first + HubSpot read-only ✓
- User-selectable source/target orgs ✓
- Dynamic schema discovery ✓
- Records + metadata + file blobs (SF); metadata-only (HubSpot) ✓
- Per-row cascade-delete checkbox + drift detection ✓
- Admin UI in Node service portal, not SF LWC ✓
- Git repo per tenant, branch per org, metadata-only ✓
