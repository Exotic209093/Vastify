// Verifies both External Objects are queryable via SF Connect.

System.debug('--- Vastify_Interaction__x ---');
try {
    List<Vastify_Interaction__x> rows = [
        SELECT ExternalId, Channel__c, Type__c, Subject__c, Timestamp__c
        FROM Vastify_Interaction__x
        ORDER BY Timestamp__c DESC
        LIMIT 5
    ];
    System.debug('  count: ' + rows.size());
    for (Vastify_Interaction__x r : rows) {
        System.debug('   - ' + r.Channel__c + ' | ' + r.Type__c + ' | ' + r.Subject__c);
    }
} catch (Exception e) {
    System.debug('  ERROR: ' + e.getMessage());
}

System.debug('--- ArchivedInteraction__x ---');
try {
    List<ArchivedInteraction__x> archived = [
        SELECT ExternalId, Channel__c, Type__c, Subject__c, Timestamp__c
        FROM ArchivedInteraction__x
        ORDER BY Timestamp__c DESC
        LIMIT 5
    ];
    System.debug('  count: ' + archived.size());
    for (ArchivedInteraction__x r : archived) {
        System.debug('   - ' + r.Channel__c + ' | ' + r.Type__c + ' | ' + r.Subject__c);
    }
} catch (Exception e) {
    System.debug('  ERROR: ' + e.getMessage());
}
