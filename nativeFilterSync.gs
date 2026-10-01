/*
 * ============================================================
 * Native Gmail filter synchronization
 * ============================================================
 */


/*
 * Reconciles native Gmail filters with the current RULES
 * configuration.
 *
 * Native filters handle arrival-time behavior:
 *
 *   - apply the rule's label
 *   - skip Inbox when the rule uses INBOX.SKIP
 *
 * For each expected filter:
 *
 *   1. If an exact filter already exists, leave it alone.
 *   2. If filters with the correct query but outdated actions
 *      exist, replace them.
 *   3. If no matching filter exists, create one.
 *
 * Rules using knownFormats produce one native filter for each
 * known format rather than one filter for the broad base
 * query.
 */
function syncNativeFilters() {
  let nativeFilters =
    getNativeFilters();

  const labelMaps =
    getGmailLabelMaps();

  let created = 0;
  let replaced = 0;
  let alreadyCorrect = 0;

  for (const rule of RULES) {
    /*
     * Ensure the configured label exists before attempting to
     * create filters that reference its Gmail API ID.
     */
    const labelId =
      getOrCreateGmailLabelId(
        rule.label,
        labelMaps
      );

    const expectedFilters =
      getExpectedNativeFilters(
        rule
      );

    for (
      const expectedFilter of
      expectedFilters
    ) {
      /*
       * Find existing native filters whose criteria correspond
       * to this expected RULES query.
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
       * A filter is correct only when both its query and its
       * actions match the current rule.
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
        alreadyCorrect++;
        continue;
      }

      /*
       * Matching query, wrong actions:
       *
       * Remove every outdated version before creating the
       * expected filter.
       */
      if (matches.length > 0) {
        for (
          const filter of matches
        ) {
          Gmail.Users.Settings.Filters
            .remove(
              "me",
              filter.id
            );
        }

        createNativeFilter(
          expectedFilter.query,
          labelId,
          rule.inboxRetentionDays
        );

        console.log(
          `↻ ${rule.name} / ` +
          `${expectedFilter.name}: ` +
          `replaced ${matches.length} ` +
          `outdated filter(s)`
        );

        replaced++;

        /*
         * Refresh the local snapshot because Gmail's native
         * filter state has changed.
         */
        nativeFilters =
          getNativeFilters();

        continue;
      }

      /*
       * No filter exists for this expected query.
       */
      createNativeFilter(
        expectedFilter.query,
        labelId,
        rule.inboxRetentionDays
      );

      console.log(
        `+ ${rule.name} / ` +
        `${expectedFilter.name}: created`
      );

      created++;

      /*
       * Keep subsequent comparisons synchronized with Gmail.
       */
      nativeFilters =
        getNativeFilters();
    }
  }

  console.log("");

  console.log(
    `Sync complete: ` +
    `${created} created, ` +
    `${replaced} replaced, ` +
    `${alreadyCorrect} already correct.`
  );
}