/**
 * Fires once per insert of ContentVersion (a file upload). Enqueues the Vastify offload
 * job asynchronously — Apex callouts are forbidden in synchronous triggers.
 *
 * Skip rule: ContentVersions whose Title begins with the marker prefix are ones we
 * created to back-populate records already offloaded; we don't re-offload them.
 */
trigger ContentVersionTrigger on ContentVersion (after insert) {
    List<Id> toOffload = new List<Id>();
    for (ContentVersion cv : Trigger.new) {
        if (cv.Title != null && cv.Title.startsWith('__vastify_skip__')) continue;
        toOffload.add(cv.Id);
    }
    if (!toOffload.isEmpty()) {
        System.enqueueJob(new FileOffloadQueueable(toOffload));
    }
}
