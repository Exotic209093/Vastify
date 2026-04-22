/**
 * Archives a batch of Interaction__c records to Vastify (records API) and deletes them
 * from the native SObject to reclaim SF data storage.
 *
 * This runs in Queueable context (callout-capable). The Schedulable version below just
 * enqueues this.
 */
public with sharing class InteractionArchiverQueueable implements Queueable, Database.AllowsCallouts {
    private final List<Id> ids;

    public InteractionArchiverQueueable(List<Id> ids) {
        this.ids = ids;
    }

    public void execute(QueueableContext ctx) {
        if (ids == null || ids.isEmpty()) return;
        List<Interaction__c> rows = [
            SELECT Id, Timestamp__c, Channel__c, Type__c, Account__c, Contact__c, Subject__c, Payload__c
            FROM Interaction__c
            WHERE Id IN :ids
        ];
        if (rows.isEmpty()) return;

        List<Map<String, Object>> records = new List<Map<String, Object>>();
        for (Interaction__c i : rows) {
            records.add(new Map<String, Object>{
                'Id' => i.Id,
                'Timestamp' => i.Timestamp__c == null ? null : i.Timestamp__c.getTime(),
                'Channel' => i.Channel__c,
                'Type' => i.Type__c,
                'AccountId' => i.Account__c,
                'ContactId' => i.Contact__c,
                'Subject' => i.Subject__c,
                'Payload' => i.Payload__c,
                'IsArchived' => true
            });
        }

        HttpResponse resp = VastifyCallout.post('/v1/records/archive', JSON.serialize(new Map<String, Object>{
            'records' => records
        }));
        VastifyCallout.expectJson(resp);

        delete rows;
    }
}
