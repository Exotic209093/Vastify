# Vastify Salesforce package

SFDX project containing Apex, custom SObjects, External Objects, tabs, app, and a permission set. Deployed against Developer Edition and Agentforce DE orgs.

See [`../docs/SALESFORCE.md`](../docs/SALESFORCE.md) for the full step-by-step deploy guide including known quirks and fixes for edition-specific failures.

## Components

### Apex (`force-app/main/default/classes`)

| Class | Role |
|---|---|
| `VastifyCallout` | Shared HTTP helper. Reads base URL + API key from `Vastify_Setting__mdt.Default`. |
| `FileOffloadQueueable` | Enqueued per `ContentVersion` insert. Streams bytes to `/v1/files/upload`, writes `External_File__c` with the presigned URL. |
| `InteractionArchiverSchedulable` | `System.schedule('Vastify Nightly Archiver', ...)`. Finds `Interaction__c` older than `Archive_Age_Days__c`, splits into 200-row batches, enqueues a queueable per batch. |
| `InteractionArchiverQueueable` | Posts a batch to `/v1/records/archive` and deletes the native rows on success. |
| `ArchiveNowController` | `@AuraEnabled` entry point — runs the archiver immediately for demos. |
| `VastifyCalloutMock`, `VastifyTests` | Test harness. |

### Trigger (`force-app/main/default/triggers`)

`ContentVersionTrigger` — `after insert` — enqueues `FileOffloadQueueable` for each new ContentVersion except those we created back into Salesforce.

### Custom SObjects (`force-app/main/default/objects`)

| Object | Purpose |
|---|---|
| `External_File__c` | Stores the presigned URL + metadata for each offloaded ContentVersion |
| `Interaction__c` | The native source SObject the archiver reads from and deletes |
| `Vastify_Setting__mdt` | Custom metadata type — API URL, key, archive age threshold, delete-original flag |

### External Objects

**Created via Setup → External Data Sources → Validate and Sync** (not via metadata — see [`../docs/SALESFORCE.md`](../docs/SALESFORCE.md) for why):

| Object | Source |
|---|---|
| `Vastify_Interaction__x` | `Interaction` entity set on `Vastify_OData` |
| `ArchivedInteraction__x` | `ArchivedInteraction` entity set on `Vastify_OData` |

### Tabs + App

- Tabs: `External_File__c`, `Interaction__c`, `Vastify_Interaction__x`, `ArchivedInteraction__x`
- App: `Vastify` (Lightning) — includes standard Account + Contact tabs plus the four above

### Permission Set

`Vastify_Admin` — grants FLS on all custom fields, tab visibility, and Apex class access. Must be assigned to the deploying user after deploy:

```bash
sf org assign permset --target-org <alias> --name Vastify_Admin
```

## Scripts

Apex anonymous scripts under `scripts/`:

| Script | Purpose |
|---|---|
| `configure-setting.apex` | Upserts the `Vastify_Setting.Default` custom metadata record via `Metadata.Operations`. Run after deploy. |
| `seed.apex` | Seeds 10 Accounts, 50 Contacts, 500 Interactions across two years. |
| `test-file-offload.apex` | Inserts a ContentVersion to exercise the trigger → queueable → middleware pipeline. |
| `test-archive.apex` | Runs `InteractionArchiverSchedulable.run()` immediately. |
| `check-external-object.apex` | Verifies both External Objects via SOQL. |

All scripts run with: `sf apex run --target-org <alias> --file scripts/<name>.apex`.

## Remote Site + Custom Metadata — tunnel URL

Two files reference the middleware tunnel URL (e.g. ngrok):

- `force-app/main/default/remoteSiteSettings/Vastify_API.remoteSite-meta.xml`
- `force-app/main/default/customMetadata/Vastify_Setting.Default.md-meta.xml`

Both ship with `https://REPLACE-ME.ngrok-free.app`. Update both before deploy, or the callouts will fail.
