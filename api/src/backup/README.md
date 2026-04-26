# `api/src/backup/`

Snapshot, diff, and restore of an entire CRM org. Built around an adapter interface so the same engine works against Salesforce or HubSpot.

```mermaid
flowchart LR
    UI[Dashboard] --> R[/v1/backup routes/]
    R --> ENG[BackupEngine]
    R --> DE[DiffEngine]
    R --> RX[RestoreExecutor]

    ENG --> SW[schema-walker]
    ENG --> SC[snapshot-capture]
    SW --> A[CRMAdapter<br/>Salesforce or HubSpot]
    SC --> A
    SC --> OB[(ObjectBackend<br/>zip archive)]
    SC --> GS[GitSync<br/>schema-graph commits]

    DE --> OB
    DE --> A
    DE --> DPS[DiffPlanStore]

    RX --> DPS
    RX --> A
```

## Subsystems

### Snapshot capture (`backup-engine.ts` + `snapshot-capture.ts` + `schema-walker.ts`)

```mermaid
sequenceDiagram
    participant API as POST /v1/backup/snapshots
    participant ENG as BackupEngine
    participant V as CredentialVault
    participant SW as schema-walker
    participant A as CRMAdapter
    participant SC as snapshot-capture
    participant OB as ObjectBackend
    participant GS as GitSync

    API->>ENG: run(snapshotId)
    ENG->>V: getAccessToken(tenant, org)
    V-->>ENG: OAuth token (decrypted)
    ENG->>A: new SalesforceAdapter or HubSpotAdapter
    ENG->>SW: walkSchema(adapter, root, maxDepth)
    SW-->>ENG: schema graph (nodes + edges, cycle-broken)
    ENG->>SC: captureSnapshot(adapter, scope, graph, ...)
    SC->>A: list/query each object in topo order
    SC->>OB: PUT zip archive (NDJSON per object + schema-graph.json)
    SC-->>ENG: { archiveKey, recordCount, fileCount, sizeBytes }
    ENG->>GS: commitSnapshot(...) — non-fatal
    ENG->>API: snapshot row updated to 'complete'
```

### Diff + restore (`diff-engine.ts` + `restore-executor.ts`)

```mermaid
sequenceDiagram
    participant UI as SnapshotDetail.tsx
    participant API as /v1/backup/diff-plans
    participant DE as DiffEngine
    participant OB as ObjectBackend
    participant A as targetAdapter
    participant DPS as DiffPlanStore
    participant CL as Diff Explainer agent
    participant RX as RestoreExecutor

    UI->>API: build diff(snapshotId, targetOrgId)
    API->>DE: buildDiff(...)
    DE->>OB: get(snapshot zip)
    DE->>A: query live records by ID batches
    DE-->>API: DiffPlanDocument { changes: [insert, update, skip-delete] }
    API->>DPS: persist
    UI->>API: explain(planId)
    API->>CL: explainDiff(plan, snapshot, orgInfo)
    CL-->>UI: per-entity verdicts (safe/review/skip)
    UI->>API: execute(planId, mode=safe-only)
    API->>RX: run filtered changes
    RX->>A: insert/update batches
    RX-->>UI: progress + result
```

### Credential vault

`credential-vault.ts` encrypts OAuth tokens at rest with a per-tenant master key. The vault is the only thing in the API that ever sees a plaintext access token; backend adapters get them through a `getAccessToken()` callback so tokens never live on instance fields.

### Git sync

`git-sync.ts` writes a human-readable `schema-graph.json` to a per-tenant git repo on every snapshot. This isn't the data backup — that's the zip in object storage — it's a diffable history of *schema shape* over time, useful for "what changed in our CRM model this quarter?"

## File map

| File | Purpose |
|---|---|
| `backup-engine.ts` | Orchestrates snapshot run end-to-end |
| `snapshot-capture.ts` | Streams CRM records into a zip archive (NDJSON per object) |
| `schema-walker.ts` | BFS the CRM schema from a root object, breaking cycles |
| `diff-engine.ts` | Compares snapshot vs live org → `DiffPlanDocument` |
| `diff-plan-store.ts` | Persists diff plans (object storage + SQLite metadata) |
| `restore-executor.ts` | Applies a diff plan with mode filter (`all` / `safe-only` / `dry-run`) |
| `credential-vault.ts` | AES-GCM seal/open of OAuth tokens |
| `git-sync.ts` | Per-tenant `simple-git` repo for schema history |
| `crm/types.ts` | `CRMAdapter` interface — list, query, insert, update batches |
| `crm/salesforce-adapter.ts` | jsforce-backed implementation |
| `crm/hubspot-adapter.ts` | HubSpot REST implementation |
| `repo.ts` | SQLite repos: `connectedOrgs`, `backupScopes`, `snapshots`, `restoreJobs`, `diffPlans` |
| `routes.ts` | All `/v1/backup/*` REST endpoints |
| `errors.ts` | Typed error classes |
| `types.ts`, `diff-types.ts` | Shared types |

## Tests

10 test files under [`test/`](test/) cover engine, vault, diff engine, plan store, git sync, both adapters, repo, restore executor, schema walker, and snapshot capture.
