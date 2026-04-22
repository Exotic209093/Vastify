@IsTest
public class VastifyTests {
    // Note: Custom Metadata Types cannot be inserted via DML in tests — they're deployed
    // separately. These tests exercise the callout logic via a mock and verify the DML
    // on External_File__c / Interaction__c.

    @IsTest
    static void fileOffloadQueueable_persistsExternalFile() {
        ContentVersion cv = new ContentVersion(
            Title = 'vastify-test.txt',
            PathOnClient = 'vastify-test.txt',
            VersionData = Blob.valueOf('hello vastify'),
            IsMajorVersion = true
        );
        insert cv;
        ContentVersion stored = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];

        String respBody = JSON.serialize(new Map<String, Object>{
            'id' => 'file_abc',
            'backendId' => 'gcs',
            'storageClass' => 'STANDARD',
            'objectKey' => 'tenants/demo/files/file_abc',
            'sizeBytes' => 13,
            'presignedUrl' => 'https://example.com/presigned',
            'presignedExpiresAt' => System.now().addDays(1).getTime()
        });

        Test.setMock(HttpCalloutMock.class, new VastifyCalloutMock(201, respBody));
        Test.startTest();
        System.enqueueJob(new FileOffloadQueueable(new List<Id>{ stored.Id }));
        Test.stopTest();

        List<External_File__c> rows = [
            SELECT Id, Backend__c, Vastify_File_Id__c, Presigned_Url__c
            FROM External_File__c
        ];
        System.assertEquals(1, rows.size(), 'external file row should be created');
        System.assertEquals('gcs', rows[0].Backend__c);
        System.assertEquals('file_abc', rows[0].Vastify_File_Id__c);
    }

    @IsTest
    static void archiverQueueable_deletesInteractions() {
        Interaction__c i = new Interaction__c(
            Timestamp__c = Datetime.now().addDays(-100),
            Channel__c = 'email',
            Type__c = 'outbound',
            Subject__c = 'test'
        );
        insert i;

        Test.setMock(HttpCalloutMock.class, new VastifyCalloutMock(200, '{"inserted":1,"ids":["x"]}'));
        Test.startTest();
        System.enqueueJob(new InteractionArchiverQueueable(new List<Id>{ i.Id }));
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Interaction__c WHERE Id = :i.Id]);
    }

    @IsTest
    static void archiveNowController_returnsCount() {
        Integer batches = ArchiveNowController.archiveNow();
        System.assert(batches >= 0, 'archiveNow should return a non-negative count');
    }
}
