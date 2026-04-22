// Upserts the Vastify_Setting__mdt.Default record via the Metadata API.
// Used instead of deploying the .md-meta.xml, which the Agentforce dev org rejects.

Metadata.CustomMetadata mdRecord = new Metadata.CustomMetadata();
mdRecord.fullName = 'Vastify_Setting.Default';
mdRecord.label = 'Default';

Metadata.CustomMetadataValue v1 = new Metadata.CustomMetadataValue();
v1.field = 'Api_Url__c';
v1.value = 'https://REPLACE-ME.ngrok-free.app';
mdRecord.values.add(v1);

Metadata.CustomMetadataValue v2 = new Metadata.CustomMetadataValue();
v2.field = 'Api_Key__c';
v2.value = 'vastify_demo_key_change_me';
mdRecord.values.add(v2);

Metadata.CustomMetadataValue v3 = new Metadata.CustomMetadataValue();
v3.field = 'Archive_Age_Days__c';
v3.value = 90;
mdRecord.values.add(v3);

Metadata.CustomMetadataValue v4 = new Metadata.CustomMetadataValue();
v4.field = 'Delete_Original_ContentVersion__c';
v4.value = false;
mdRecord.values.add(v4);

Metadata.DeployContainer container = new Metadata.DeployContainer();
container.addMetadata(mdRecord);

Id jobId = Metadata.Operations.enqueueDeployment(container, null);
System.debug('Vastify_Setting.Default upsert enqueued: ' + jobId);
