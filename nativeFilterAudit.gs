/*
 * ============================================================
 * Native Gmail filter audit
 * ============================================================
 */


/*
 * Audits native Gmail filters against the current RULES
 * configuration.
 *
 * Unlike syncNativeFilters(), this function is read-only.
 * It reports whether each expected native filter:
 *
 *   ✓ exists with the correct actions
 *   ✗ is missing
 *   ⚠ exists but has incorrect actions
 *
 * Rules using knownFormats expect one native filter for each
 * known format.
 */
function auditNativeFilters() {
  const nativeFilters =
    getNativeFilters();

  const labelMaps =
    getGmailLabelMaps();

  let correct = 0;
  let missing = 0;
  let incorrect = 0;

  for (const rule of RULES) {
    const expectedFilters =
      getExpectedNativeFilters(
        rule
      );

    for (
      const expectedFilter of
      expectedFilters
    ) {
      /*
       * Find native filters whose criteria match the expected
       * query.
       */
      const matches =
        nativeFilters.filter(
          filter =>
            nativeFilterMatchesQuery(
              filter,
              expectedFilter.query
            )
        );

      /*
       * No matching query means the expected native filter is
       * completely absent.
       */
      if (matches.length === 0) {
        console.log(
          `✗ ${rule.name} / ` +
          `${expectedFilter.name}: missing`
        );

        missing++;
        continue;
      }

      /*
       * A query match is not enough. At least one matching
       * filter must also apply the correct label and Inbox
       * behavior.
       */
      const correctMatch =
        matches.find(
          filter =>
            nativeFilterActionsMatch(
              filter,
              rule,
              labelMaps.namesById
            )
        );

      if (correctMatch) {
        console.log(
          `✓ ${rule.name} / ` +
          `${expectedFilter.name}: correct`
        );

        correct++;
        continue;
      }

      /*
       * One or more filters use the expected query, but none
       * have the actions required by the current rule.
       */
      console.log(
        `⚠ ${rule.name} / ` +
        `${expectedFilter.name}: ` +
        `incorrect actions`
      );

      for (const filter of matches) {
        logNativeFilterDifferences(
          filter,
          rule,
          labelMaps.namesById
        );
      }

      incorrect++;
    }
  }

  console.log("");

  console.log(
    `Audit complete: ` +
    `${correct} correct, ` +
    `${missing} missing, ` +
    `${incorrect} incorrect.`
  );
}


/*
 * Logs the action-level differences between an existing
 * native Gmail filter and the actions expected by a rule.
 *
 * The comparison covers the behavior managed by this project:
 *
 *   - which RULES label is applied
 *   - whether Inbox is skipped
 */
function logNativeFilterDifferences(
  nativeFilter,
  rule,
  labelNamesById
) {
  const action =
    nativeFilter.action || {};

  const addedLabels =
    (action.addLabelIds || [])
      .map(
        id =>
          labelNamesById.get(id) ||
          id
      );

  const removedLabels =
    action.removeLabelIds || [];

  const hasExpectedLabel =
    addedLabels.includes(
      rule.label
    );

  const nativeSkipsInbox =
    removedLabels.includes(
      "INBOX"
    );

  const shouldSkipInbox =
    rule.inboxRetentionDays ===
    INBOX.SKIP;

  if (!hasExpectedLabel) {
    console.log(
      `    Expected label: ` +
      `"${rule.label}"`
    );

    console.log(
      `    Actual labels: ` +
      (
        addedLabels.length > 0
          ? addedLabels
              .map(
                label =>
                  `"${label}"`
              )
              .join(", ")
          : "(none)"
      )
    );
  }

  if (
    nativeSkipsInbox !==
    shouldSkipInbox
  ) {
    console.log(
      `    Expected Inbox behavior: ` +
      (
        shouldSkipInbox
          ? "skip Inbox"
          : "keep in Inbox"
      )
    );

    console.log(
      `    Actual Inbox behavior: ` +
      (
        nativeSkipsInbox
          ? "skip Inbox"
          : "keep in Inbox"
      )
    );
  }
}