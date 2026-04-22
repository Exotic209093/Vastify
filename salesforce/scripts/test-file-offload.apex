// Inserts a test ContentVersion. The ContentVersionTrigger fires FileOffloadQueueable,
// which calls the middleware. Afterward we query External_File__c to confirm the URL landed.

ContentVersion cv = new ContentVersion(
    Title = 'Vastify SF offload smoke ' + Datetime.now().format(),
    PathOnClient = 'vastify-sf-smoke.txt',
    VersionData = Blob.valueOf('SF → Vastify offload test on ' + Datetime.now().format()),
    IsMajorVersion = true
);
insert cv;
System.debug('Inserted ContentVersion ' + cv.Id + '. Queueable enqueued by trigger.');
