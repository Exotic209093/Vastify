# `api/src/records/`

CRUD over the SQLite `records_index` + the JSON-per-record blobs in object storage. Used by both:

- The OData adapter (read path — the handler in [`../odata/`](../odata/) calls into here)
- The dashboard's "Records" page (live + archived list views)
- The Apex archiver (`POST /v1/records/archive` bulk path)

```mermaid
flowchart LR
    subgraph WRITE[Write paths]
        OD1[OData POST/PATCH/DELETE] --> S
        AR[POST /v1/records/archive<br/>bulk] --> S
    end
    S[service.ts] --> RE[Routing engine]
    S --> OB[(ObjectBackend<br/>JSON body)]
    S --> DB[(records_index)]
    DB -.read.-> S2[service.ts list/get]
    OB -.read.-> S2
    S2 --> ODR[OData GET]
    S2 --> UI[Dashboard]
```

## Storage shape

Each record is **one JSON object per record** at:

```
tenants/{tenantId}/records/{entity}/{pk}.json
```

The SQLite `records_index` carries denormalised filter columns (timestamp, channel, type, account_id, contact_id, subject, is_archived) so OData `$filter` and `$orderby` can be answered without reading every blob.

This index is a **cache, not source of truth** — losing it just means re-listing the bucket and re-parsing the JSONs.

## Write flow

```mermaid
sequenceDiagram
    participant C as Caller<br/>(OData or archive endpoint)
    participant S as service.ts
    participant RE as Routing engine
    participant OB as ObjectBackend
    participant DB as records_index

    C->>S: createRecord({tenantId, entity, record, isArchive?})
    S->>S: normaliseTimestamp + ageDaysFromTimestamp
    S->>RE: decide({kind=record, ageDays, entity, tenantId})
    RE-->>S: {backendId, storageClass}
    S->>OB: put(tenants/{t}/records/{entity}/{pk}.json, JSON.stringify(record))
    S->>DB: INSERT records_index<br/>(denormalise Timestamp, Channel, Type, AccountId, ContactId, Subject, IsArchived)
    S-->>C: record (with normalised fields)
```

## Read flow (single record)

```mermaid
sequenceDiagram
    participant C as Caller
    participant S as service.ts
    participant DB as records_index
    participant OB as ObjectBackend

    C->>S: getRecord({tenantId, entity, pk})
    S->>DB: SELECT object_key, backend_id WHERE tenant=? AND entity=? AND pk=?
    DB-->>S: row (or null)
    alt row exists
        S->>OB: get(object_key)
        OB-->>S: JSON body
        S-->>C: parsed record (toOData → ISO datetimes)
    else not found
        S-->>C: null
    end
```

## Why JSON-per-record vs columnar?

- One object family means one IAM story, one backup policy, one cross-cloud copy
- The index is rebuildable from the bucket → bucket is source of truth
- Column-level filtering still works — denormalise into the index columns
- For >100k records per tenant, swap the SQLite index for DuckDB-over-Parquet without touching the bucket

## Files

| File | Purpose |
|---|---|
| [`service.ts`](service.ts) | `createRecord`, `getRecord`, `updateRecord`, `deleteRecord`, `listRecords` (OData query passthrough) |
| [`routes.ts`](routes.ts) | `/v1/records/*` REST surface — used by dashboard and `archive` bulk path |

The OData mount lives separately in [`../odata/handler.ts`](../odata/handler.ts) and calls into this service for record I/O.
