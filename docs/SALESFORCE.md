# Salesforce deploy guide

Step-by-step deployment of the Vastify package into a Salesforce org. This guide matches what was actually deployed to a Developer Edition "Clean Dev Box" org during development — the quirks noted here are real ones we hit, not theoretical ones.

## Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) 2.x
- A Developer Edition or scratch org authenticated with `sf org login web --alias <alias>`
- The Vastify middleware running locally and reachable through an HTTPS tunnel (we use ngrok free tier, `https://*.ngrok-free.app`)

## 1. Set the tunnel URL in metadata

Two files reference the tunnel URL and must be updated before deploy:

| File | What to change |
|---|---|
| `force-app/main/default/remoteSiteSettings/Vastify_API.remoteSite-meta.xml` | `<url>` → your tunnel base URL (e.g. `https://abcd-1234.ngrok-free.app`) |
| `force-app/main/default/customMetadata/Vastify_Setting.Default.md-meta.xml` | `Api_Url__c` → same tunnel base URL |

Leave `Api_Key__c` as `vastify_demo_key_change_me` unless you've changed it in the middleware's `.env`.

## 2. Deploy in stages

The package has a few pieces that benefit from being deployed in order; deploying everything in one shot works on most orgs but fails on stricter edition (e.g., Agentforce Developer Edition) with a `UNKNOWN_EXCEPTION` before any specific component error surfaces.

```bash
cd salesforce

# Stage 1 — SObjects (custom fields + object shells)
sf project deploy start --target-org <alias> \
  --source-dir force-app/main/default/objects/External_File__c \
  --source-dir force-app/main/default/objects/Interaction__c \
  --source-dir force-app/main/default/objects/Vastify_Setting__mdt \
  --test-level NoTestRun

# Stage 2 — Apex (classes + trigger)
sf project deploy start --target-org <alias> \
  --source-dir force-app/main/default/classes \
  --source-dir force-app/main/default/triggers \
  --test-level NoTestRun

# Stage 3 — Remote site + custom tabs + app
sf project deploy start --target-org <alias> \
  --source-dir force-app/main/default/remoteSiteSettings \
  --source-dir force-app/main/default/tabs/External_File__c.tab-meta.xml \
  --source-dir force-app/main/default/tabs/Interaction__c.tab-meta.xml \
  --source-dir force-app/main/default/applications \
  --test-level NoTestRun

# Stage 4 — Permission set (grants FLS to the admin user)
sf project deploy start --target-org <alias> \
  --source-dir force-app/main/default/permissionsets \
  --test-level NoTestRun

sf org assign permset --target-org <alias> --name Vastify_Admin
```

## 3. Upsert the Custom Metadata record via Apex

On Agentforce / fresh DE orgs, deploying a `.md-meta.xml` record via the Metadata API fails with `UNKNOWN_EXCEPTION` before any component error surfaces. Upsert it via Apex instead:

```bash
sf apex run --target-org <alias> --file scripts/configure-setting.apex
```

The script uses `Metadata.Operations.enqueueDeployment` to upsert `Vastify_Setting.Default` with your tunnel URL and API key.

## 4. Create the External Data Source via Setup UI

**This step must be manual** on Agentforce / fresh DE orgs. Metadata-deployed `ExternalDataSource` records render in the list view but their detail page 500s, and `SELECT ... FROM Vastify_Interaction__x` raises `ExternalObjectException` before hitting the endpoint.

1. `sf org open --target-org <alias> --path lightning/setup/ExternalDataSource/home`
2. Click **New External Data Source**
3. Fill in:
   - **External Data Source**: `Vastify OData`
   - **Name**: `Vastify_OData`
   - **Type**: `Salesforce Connect: OData 4.0`
   - **URL**: `https://<your-tunnel>/odata/v1/`
   - **Special Compatibility**: `None`
   - **Identity Type**: `Anonymous`
   - **Authentication Protocol**: `No Authentication`
   - Leave **Writable External Objects** unticked (can flip on later)
4. Save.
5. Click **Validate and Sync**.
6. Tick **both** rows (`Interaction`, `ArchivedInteraction`) and set **Name Field** to `Id` on each.
7. If `Interaction` fails to sync ("We couldn't sync the Interaction external object"), rename it in the form:
   - **External Object Name**: `Vastify_Interaction`
   - **Label**: `Vastify Interaction`
   - **Plural Label**: `Vastify Interactions`
   - Untick `ArchivedInteraction` if it already synced, and click Sync.
8. You should end up with two External Objects: `Vastify_Interaction__x` and `ArchivedInteraction__x`.

## 5. Add the External Object tabs

Once the External Objects exist, deploy their tabs:

```bash
sf project deploy start --target-org <alias> \
  --source-dir force-app/main/default/tabs/Vastify_Interaction__x.tab-meta.xml \
  --source-dir force-app/main/default/tabs/ArchivedInteraction__x.tab-meta.xml \
  --test-level NoTestRun
```

## 6. Seed demo data

```bash
sf apex run --target-org <alias> --file scripts/seed.apex
```

This inserts 10 Accounts, 50 Contacts, and 500 `Interaction__c` rows with timestamps spread over the past two years (roughly 60% are older than 90 days, so the archiver has something to move).

## 7. Smoke-test the pipelines

```bash
# File offload — creates a ContentVersion, trigger enqueues FileOffloadQueueable
sf apex run --target-org <alias> --file scripts/test-file-offload.apex

# Wait a few seconds for the Queueable to complete, then check
sf data query --target-org <alias> --query "SELECT Id,Backend__c,Storage_Class__c,Size_Bytes__c FROM External_File__c"

# External Objects — SF Connect fetches live from middleware
sf apex run --target-org <alias> --file scripts/check-external-object.apex

# Archive pipeline — moves >90-day Interaction__c rows out to the middleware
sf apex run --target-org <alias> --file scripts/test-archive.apex
```

## Known quirks

These are real issues we hit on Agentforce DE; they're not bugs in the package but quirks of that org edition.

### `UNKNOWN_EXCEPTION` on full-package deploy

**Symptom:** `sf project deploy start` with no `--source-dir` fails with `UNKNOWN_EXCEPTION: An unexpected error occurred. Please include this ErrorId…` and `numberComponentsDeployed: 0`.

**Cause:** A single malformed or edition-incompatible component poisons the whole transaction before per-component errors are reported.

**Fix:** Deploy in stages as above. When stage N fails, the component errors become specific.

### Custom Metadata records fail via metadata deploy

**Symptom:** Deploying `customMetadata/*.md-meta.xml` throws `UNKNOWN_EXCEPTION` with no per-component error.

**Fix:** Upsert via Apex (`scripts/configure-setting.apex`).

### External Data Source detail page 500s

**Symptom:** Opening a metadata-deployed `Vastify_OData` data source in Setup returns a Salesforce "Internal Server Error". The list view renders but clicking in fails.

**Fix:** Delete the metadata-deployed data source and create it via Setup UI instead. We documented this inline in the deploy flow above.

### SOQL on External Object throws before hitting the endpoint

**Symptom:** `SELECT ... FROM Vastify_Interaction__x` throws `ExternalObjectException: Error received from the external system: …`, but the middleware never sees the request (verifiable via ngrok inspector).

**Cause:** The External Object metadata was deployed before the data source was properly linked. The internal SF Connect binding isn't established.

**Fix:** Validate-and-Sync through Setup UI creates or repairs the binding.

### Validate-and-Sync fails on `Interaction`

**Symptom:** `ArchivedInteraction` syncs successfully; `Interaction` fails with "unexpected error".

**Cause:** API-name collision with the native `Interaction__c`.

**Fix:** Rename to `Vastify_Interaction` in the sync form. The final external API name becomes `Vastify_Interaction__x` which is what the rest of the package expects.

### Admin user has no FLS on new custom fields

**Symptom:** Deploy reports "Created" for fields, but `Schema.getDescribe()` from Apex returns no custom fields. Any SOQL referencing the new fields throws `Field does not exist`.

**Cause:** Salesforce System Administrator profile does not grant FLS to newly-deployed fields automatically on DE orgs.

**Fix:** Assign the `Vastify_Admin` permission set (`sf org assign permset ...`).

### `viewAllRecords` / `modifyAllRecords` rejected for External Objects

**Symptom:** Permission set deploy fails with "The user license doesn't allow the permission: View All Vastify_..." on External Objects.

**Fix:** Keep those flags `false` on External Objects. We already do in `Vastify_Admin.permissionset-meta.xml`.
