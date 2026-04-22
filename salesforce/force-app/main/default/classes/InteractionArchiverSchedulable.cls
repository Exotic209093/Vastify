/**
 * Scheduled job that finds old Interaction__c rows and enqueues batches for archival.
 *
 * Runs nightly via:
 *   System.schedule('Vastify Nightly Archiver', '0 0 2 * * ?', new InteractionArchiverSchedulable());
 *
 * Threshold age (days) read from Vastify_Setting__mdt.Default.Archive_Age_Days__c (default 90).
 */
public with sharing class InteractionArchiverSchedulable implements Schedulable {
    private static final Integer BATCH_SIZE = 200;
    private static final Integer MAX_BATCHES_PER_RUN = 50; // governor-friendly upper bound

    public void execute(SchedulableContext ctx) {
        run();
    }

    public static Integer run() {
        Vastify_Setting__mdt s = VastifyCallout.getSetting();
        Integer ageDays = (s.Archive_Age_Days__c == null) ? 90 : s.Archive_Age_Days__c.intValue();

        Datetime cutoff = Datetime.now().addDays(-ageDays);
        List<Id> allIds = new List<Id>();
        for (Interaction__c i : [
            SELECT Id FROM Interaction__c
            WHERE Timestamp__c < :cutoff
            ORDER BY Timestamp__c ASC
            LIMIT 10000
        ]) {
            allIds.add(i.Id);
        }

        Integer enqueuedBatches = 0;
        List<Id> buffer = new List<Id>();
        for (Id id : allIds) {
            buffer.add(id);
            if (buffer.size() >= BATCH_SIZE) {
                System.enqueueJob(new InteractionArchiverQueueable(buffer));
                buffer = new List<Id>();
                enqueuedBatches++;
                if (enqueuedBatches >= MAX_BATCHES_PER_RUN) break;
            }
        }
        if (!buffer.isEmpty() && enqueuedBatches < MAX_BATCHES_PER_RUN) {
            System.enqueueJob(new InteractionArchiverQueueable(buffer));
            enqueuedBatches++;
        }
        return enqueuedBatches;
    }
}
