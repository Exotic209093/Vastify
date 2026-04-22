/**
 * Seeds the SF org with Accounts, Contacts, and Interaction__c records for the demo.
 * Some records are dated > 90 days ago so the archiver has something to move.
 *
 * Run: sf apex run -f salesforce/scripts/seed.apex
 */
List<String> seedAccountNames = new List<String>{
    'Acme Corp', 'Globex', 'Initech', 'Umbrella Co.',
    'Stark Industries', 'Wayne Enterprises', 'Tyrell Corp',
    'Soylent Corp', 'Massive Dynamic', 'Cyberdyne Systems'
};

// Idempotent: clear prior seed rows so re-runs work cleanly.
delete [SELECT Id FROM Interaction__c];
delete [SELECT Id FROM Contact WHERE AccountId IN (SELECT Id FROM Account WHERE Name IN :seedAccountNames)];
delete [SELECT Id FROM Account WHERE Name IN :seedAccountNames];

List<Account> accounts = new List<Account>();
for (String name : seedAccountNames) accounts.add(new Account(Name = name));
insert accounts;

List<Contact> contacts = new List<Contact>();
for (Account a : accounts) {
    for (Integer i = 0; i < 5; i++) {
        contacts.add(new Contact(
            FirstName = 'Demo',
            LastName = 'Contact ' + (i+1),
            Email = 'demo' + i + '@' + a.Name.toLowerCase().replaceAll('[^a-z0-9]', '') + '.test',
            AccountId = a.Id
        ));
    }
}
insert contacts;

List<String> channels = new List<String>{ 'email', 'sms', 'call', 'chat', 'web' };
List<String> types    = new List<String>{ 'inbound', 'outbound', 'notification' };
List<String> subjects = new List<String>{
    'Welcome', 'Check-in', 'Renewal', 'Issue resolved', 'Meeting',
    'Contract signed', 'Enquiry', 'Payment', 'Support', 'Follow-up'
};

List<Interaction__c> rows = new List<Interaction__c>();
Datetime now = Datetime.now();

// 500 rows spread over the last 2 years — roughly 60% older than 90 days (archiver candidates).
for (Integer i = 0; i < 500; i++) {
    Integer daysBack = Integer.valueOf(Math.random() * 730);
    Datetime ts = now.addDays(-daysBack);
    Contact c = contacts[Math.mod(i, contacts.size())];
    rows.add(new Interaction__c(
        Timestamp__c = ts,
        Channel__c   = channels[Math.mod(i, channels.size())],
        Type__c      = types[Math.mod(i, types.size())],
        Account__c   = c.AccountId,
        Contact__c   = c.Id,
        Subject__c   = subjects[Math.mod(i, subjects.size())] + ' #' + (i+1),
        Payload__c   = 'Seeded interaction ' + (i+1) + ' on ' + ts.format()
    ));
}
insert rows;

System.debug('Seeded ' + accounts.size() + ' accounts, ' + contacts.size() + ' contacts, '
             + rows.size() + ' interactions.');
