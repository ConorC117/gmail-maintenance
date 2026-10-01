const CLEANUP_BATCH_SIZE = 100;


/*
 * ============================================================
 * Lifecycle cleanup
 * ============================================================
 */


/*
 * Applies the Inbox and retention lifecycles defined by RULES.
 *
 * Each rule has two independent lifecycles:
 *
 *   inboxRetentionDays
 *     Controls how long recognized mail remains in Inbox.
 *
 *   retentionDays
 *     Controls how long recognized mail is retained before
 *     being moved to Trash.
 *
 * Only recognized messages are processed. For rules using
 * knownFormats, messages outside those formats are left
 * untouched.
 */
function cleanupEmails() {
  for (const rule of RULES) {
    let deleted = 0;
    let archived = 0;

    /*
     * --------------------------------------------------------
     * Email retention
     * --------------------------------------------------------
     *
     * KEEP.FOREVER is represented by null and therefore
     * requires no cleanup.
     *
     * Any finite retention period moves recognized messages
     * to Trash once they are old enough.
     */
    if (
      rule.retentionDays !==
      KEEP.FOREVER
    ) {
      const messagesToDelete =
        getKnownMessagesForQuery(
          rule,
          `older_than:${rule.retentionDays}d ` +
          `-in:trash`
        );

      moveMessagesToTrash(
        messagesToDelete
      );

      deleted =
        messagesToDelete.length;
    }

    /*
     * --------------------------------------------------------
     * Inbox retention
     * --------------------------------------------------------
     *
     * INBOX.SKIP:
     *   Native Gmail filters keep the message out of Inbox
     *   immediately, so no scheduled archive step is needed.
     *
     * Positive duration:
     *   The message arrives in Inbox normally and is archived
     *   after the configured number of days.
     */
    if (
      rule.inboxRetentionDays >
      INBOX.SKIP
    ) {
      const messagesToArchive =
        getKnownMessagesForQuery(
          rule,
          `in:inbox ` +
          `older_than:${rule.inboxRetentionDays}d ` +
          `-in:trash`
        );

      /*
       * GmailApp archives at thread level, while RULES
       * classification operates at message level.
       *
       * Avoid processing the same thread more than once when
       * several matching messages belong to it.
       */
      const processedThreadIds =
        new Set();

      for (
        const message of
        messagesToArchive
      ) {
        const thread =
          message.getThread();

        const threadId =
          thread.getId();

        if (
          processedThreadIds.has(
            threadId
          )
        ) {
          continue;
        }

        processedThreadIds.add(
          threadId
        );

        if (thread.isInInbox()) {
          thread.moveToArchive();
          archived++;
        }
      }
    }

    console.log(
      `${rule.name}: ` +
      `${archived} archived, ` +
      `${deleted} moved to Trash.`
    );
  }
}


/*
 * ============================================================
 * Batched Trash operations
 * ============================================================
 */


/*
 * Moves messages to Trash using Gmail API batch operations.
 *
 * Applying the TRASH system label through batchModify avoids
 * making a separate Gmail API request for every message.
 *
 * Messages are processed in batches to reduce API usage during
 * large historical cleanups.
 */
function moveMessagesToTrash(messages) {
  if (messages.length === 0) {
    return;
  }

  for (
    let i = 0;
    i < messages.length;
    i += CLEANUP_BATCH_SIZE
  ) {
    const batch =
      messages.slice(
        i,
        i + CLEANUP_BATCH_SIZE
      );

    const messageIds =
      batch.map(
        message =>
          message.getId()
      );

    Gmail.Users.Messages.batchModify(
      {
        ids: messageIds,
        addLabelIds: [
          "TRASH"
        ],
        removeLabelIds: [
          "INBOX"
        ]
      },
      "me"
    );
  }
}