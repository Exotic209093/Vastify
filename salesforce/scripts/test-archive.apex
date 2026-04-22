// Run the archiver — finds Interaction__c rows older than 90 days and moves them to Vastify via /v1/records/archive.
// The Schedulable enqueues Queueable(s) which do the actual callout + delete.

Integer nativeBefore = [SELECT COUNT() FROM Interaction__c];
Integer oldBefore    = [SELECT COUNT() FROM Interaction__c WHERE Timestamp__c < :Datetime.now().addDays(-90)];
System.debug('BEFORE — native total: ' + nativeBefore + ' | older than 90d: ' + oldBefore);

Integer batches = InteractionArchiverSchedulable.run();
System.debug('Archiver enqueued ' + batches + ' batch(es).');
