/**
 * Aura-enabled action used by the dashboard / demo "Archive Now" button.
 * Runs the archiver immediately instead of waiting for the nightly schedule.
 */
public with sharing class ArchiveNowController {
    @AuraEnabled
    public static Integer archiveNow() {
        return InteractionArchiverSchedulable.run();
    }
}
