/**
 * Enqueued by ContentVersionTrigger after an attachment is inserted.
 * Streams the file to the Vastify middleware, stores the returned presigned URL on an
 * External_File__c row, and (optionally) deletes the ContentVersion to reclaim SF storage.
 */
public with sharing class FileOffloadQueueable implements Queueable, Database.AllowsCallouts {
    private final List<Id> contentVersionIds;

    public FileOffloadQueueable(List<Id> contentVersionIds) {
        this.contentVersionIds = contentVersionIds;
    }

    public void execute(QueueableContext ctx) {
        if (contentVersionIds == null || contentVersionIds.isEmpty()) return;

        List<ContentVersion> versions = [
            SELECT Id, Title, FileExtension, ContentDocumentId, VersionData
            FROM ContentVersion
            WHERE Id IN :contentVersionIds
        ];

        List<External_File__c> externalFiles = new List<External_File__c>();
        List<Id> toDelete = new List<Id>();
        Vastify_Setting__mdt s = VastifyCallout.getSetting();
        Boolean deleteOriginal = s.Delete_Original_ContentVersion__c == true;

        for (ContentVersion cv : versions) {
            try {
                String contentType = inferContentType(cv.FileExtension);
                String base64 = EncodingUtil.base64Encode(cv.VersionData);
                Map<String, Object> body = new Map<String, Object>{
                    'originalName' => cv.Title,
                    'contentType' => contentType,
                    'sfContentVersionId' => cv.Id,
                    'dataBase64' => base64
                };
                HttpResponse resp = VastifyCallout.post('/v1/files/upload', JSON.serialize(body));
                Map<String, Object> parsed = VastifyCallout.expectJson(resp);

                External_File__c ef = new External_File__c(
                    Name = cv.Title != null ? cv.Title.left(80) : 'file',
                    Original_Name__c = cv.Title,
                    Original_ContentVersion_Id__c = cv.Id,
                    Content_Document_Id__c = cv.ContentDocumentId,
                    Backend__c = (String) parsed.get('backendId'),
                    Storage_Class__c = (String) parsed.get('storageClass'),
                    Object_Key__c = (String) parsed.get('objectKey'),
                    Size_Bytes__c = (Decimal) parsed.get('sizeBytes'),
                    Vastify_File_Id__c = (String) parsed.get('id'),
                    Presigned_Url__c = (String) parsed.get('presignedUrl'),
                    Presigned_Expires_At__c = expiresAtToDatetime(parsed.get('presignedExpiresAt'))
                );
                externalFiles.add(ef);
                if (deleteOriginal) toDelete.add(cv.Id);
            } catch (Exception e) {
                System.debug(LoggingLevel.ERROR, 'Vastify offload failed for ' + cv.Id + ': ' + e.getMessage());
            }
        }

        if (!externalFiles.isEmpty()) insert externalFiles;
        if (!toDelete.isEmpty()) {
            // Deleting the ContentDocument removes all ContentVersions for it.
            // We have the ContentDocumentId on each record we processed.
            Set<Id> docIds = new Set<Id>();
            for (ContentVersion cv : versions) {
                if (toDelete.contains(cv.Id)) docIds.add(cv.ContentDocumentId);
            }
            if (!docIds.isEmpty()) {
                delete [SELECT Id FROM ContentDocument WHERE Id IN :docIds];
            }
        }
    }

    private static Datetime expiresAtToDatetime(Object raw) {
        if (raw == null) return null;
        Long ms = (raw instanceof Long) ? (Long) raw : Long.valueOf(String.valueOf(raw));
        return Datetime.newInstance(ms);
    }

    private static String inferContentType(String ext) {
        if (ext == null) return 'application/octet-stream';
        String e = ext.toLowerCase();
        if (e == 'pdf') return 'application/pdf';
        if (e == 'png') return 'image/png';
        if (e == 'jpg' || e == 'jpeg') return 'image/jpeg';
        if (e == 'gif') return 'image/gif';
        if (e == 'txt') return 'text/plain';
        if (e == 'csv') return 'text/csv';
        if (e == 'json') return 'application/json';
        if (e == 'xml') return 'application/xml';
        return 'application/octet-stream';
    }
}
