const MANAGED_LABELS_PROPERTY =
  "managedLabels";


/*
 * ============================================================
 * Email organization
 * ============================================================
 */


/*
 * Reconciles Gmail labels against the current RULES
 * configuration.
 *
 * The organizer performs three steps:
 *
 *   1. Load the labels managed by the previous successful run.
 *   2. Apply the labels required by the current RULES.
 *   3. Remove managed labels that no longer exist in RULES.
 *
 * The new managed-label state is saved only after all
 * organization work completes successfully.
 */
function organizeEmails() {
  const previousManagedLabels =
    getStoredManagedLabelNames();

  const currentManagedLabels =
    getManagedLabelNames();

  /*
   * Apply current labels before removing obsolete ones.
   *
   * This is important when a rule's label has been renamed:
   * the replacement label is applied before the old label is
   * removed.
   */
  organizeCurrentLabels();

  removeObsoleteManagedLabels(
    previousManagedLabels,
    currentManagedLabels
  );

  saveManagedLabelNames(
    currentManagedLabels
  );
}


/*
 * Ensures that every recognized message has the label
 * currently specified by its rule.
 *
 * Other labels are deliberately left untouched. Multiple
 * rules may legitimately apply different labels to the same
 * thread.
 */
function organizeCurrentLabels() {
  for (const rule of RULES) {
    const desiredLabel =
      getOrCreateLabel(
        rule.label
      );

    /*
     * Only search for recognized messages that do not already
     * have the desired label.
     */
    const candidateMessages =
      getKnownMessagesForQuery(
        rule,
        `-label:${quoteGmailLabel(
          rule.label
        )}`
      );

    const processedThreadIds =
      new Set();

    let checked = 0;
    let labeled = 0;

    for (
      const message of
      candidateMessages
    ) {
      const thread =
        message.getThread();

      const threadId =
        thread.getId();

      /*
       * GmailApp labels operate at thread level, while RULES
       * classification operates at message level.
       *
       * Avoid processing the same thread more than once when
       * several matching messages belong to it.
       */
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

      checked++;

      const currentLabelNames =
        new Set(
          thread
            .getLabels()
            .map(
              label =>
                label.getName()
            )
        );

      if (
        !currentLabelNames.has(
          rule.label
        )
      ) {
        thread.addLabel(
          desiredLabel
        );

        labeled++;
      }
    }

    console.log(
      `${rule.name}: ` +
      `${checked} candidates checked, ` +
      `${labeled} labeled.`
    );
  }
}


/*
 * ============================================================
 * Obsolete managed labels
 * ============================================================
 */


/*
 * Removes labels that were controlled by the previous RULES
 * configuration but are no longer referenced anywhere in the
 * current RULES.
 *
 * Example:
 *
 *   Previous RULES:
 *     Deals/Games
 *
 *   Current RULES:
 *     Deals/Game Sales
 *
 * organizeCurrentLabels() first applies Deals/Game Sales.
 * This function can then safely remove Deals/Games.
 *
 * A label is only considered obsolete when no current rule
 * uses it. This allows multiple rules to share the same label.
 */
function removeObsoleteManagedLabels(
  previousManagedLabels,
  currentManagedLabels
) {
  const obsoleteLabels =
    Array.from(
      previousManagedLabels
    ).filter(
      labelName =>
        !currentManagedLabels.has(
          labelName
        )
    );

  if (
    obsoleteLabels.length === 0
  ) {
    console.log(
      "No obsolete managed labels."
    );

    return;
  }

  console.log(
    "\n--- Obsolete managed labels ---"
  );

  for (
    const labelName of
    obsoleteLabels
  ) {
    const label =
      GmailApp.getUserLabelByName(
        labelName
      );

    if (!label) {
      console.log(
        `${labelName}: already absent.`
      );

      continue;
    }

    const threads =
      label.getThreads();

    /*
     * Remove the obsolete label from every thread before
     * deleting the label itself.
     */
    for (const thread of threads) {
      thread.removeLabel(
        label
      );
    }

    /*
     * Verify that Gmail actually removed the label everywhere
     * before deleting it.
     *
     * If anything remains, throw an error rather than silently
     * updating the stored managed-label state.
     */
    const remainingThreads =
      label.getThreads();

    if (
      remainingThreads.length > 0
    ) {
      throw new Error(
        `Could not fully remove obsolete ` +
        `label "${labelName}". ` +
        `${remainingThreads.length} ` +
        `thread(s) remain.`
      );
    }

    label.deleteLabel();

    console.log(
      `${labelName}: removed from ` +
      `${threads.length} thread(s) ` +
      `and deleted.`
    );
  }
}


/*
 * ============================================================
 * Managed-label state
 * ============================================================
 */


/*
 * Returns the unique set of labels referenced by the current
 * RULES configuration.
 */
function getManagedLabelNames() {
  return new Set(
    RULES
      .map(
        rule => rule.label
      )
      .filter(Boolean)
  );
}


/*
 * Loads the managed-label set from the previous successful
 * organizer run.
 *
 * Script Properties are used so this state persists between
 * executions.
 *
 * No stored value means this is the first run. In that case,
 * no existing labels are considered obsolete.
 */
function getStoredManagedLabelNames() {
  const properties =
    PropertiesService
      .getScriptProperties();

  const value =
    properties.getProperty(
      MANAGED_LABELS_PROPERTY
    );

  if (!value) {
    return new Set();
  }

  try {
    const labels =
      JSON.parse(value);

    if (
      !Array.isArray(labels)
    ) {
      return new Set();
    }

    return new Set(
      labels
    );
  } catch (error) {
    console.warn(
      "Invalid stored managed-label state; " +
      "ignoring it."
    );

    return new Set();
  }
}


/*
 * Stores the current managed-label set for comparison during
 * the next organizer run.
 *
 * This is called only after current-label organization and
 * obsolete-label cleanup complete successfully.
 */
function saveManagedLabelNames(
  managedLabelNames
) {
  const properties =
    PropertiesService
      .getScriptProperties();

  const labels =
    Array.from(
      managedLabelNames
    ).sort();

  properties.setProperty(
    MANAGED_LABELS_PROPERTY,
    JSON.stringify(labels)
  );
}