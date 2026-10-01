/*
 * ============================================================
 * Native Gmail filters
 * ============================================================
 */


/*
 * Returns all native Gmail filters configured on the account.
 *
 * Requires the Advanced Gmail service.
 */
function getNativeFilters() {
  const response =
    Gmail.Users.Settings.Filters.list(
      "me"
    );

  return response.filter || [];
}


/*
 * ============================================================
 * Gmail labels
 * ============================================================
 */


/*
 * Returns mappings between Gmail label names and Gmail API
 * label IDs.
 *
 * Both directions are useful because RULES refers to labels
 * by name while the Gmail API usually refers to them by ID.
 */
function getGmailLabelMaps() {
  const response =
    Gmail.Users.Labels.list("me");

  const labels =
    response.labels || [];

  const idsByName =
    new Map();

  const namesById =
    new Map();

  for (const label of labels) {
    idsByName.set(
      label.name,
      label.id
    );

    namesById.set(
      label.id,
      label.name
    );
  }

  return {
    idsByName: idsByName,
    namesById: namesById
  };
}


/*
 * Ensures that all parent labels required for a nested label
 * exist.
 *
 * Gmail represents nested labels using "/" in the name, but
 * creating a child label does not necessarily create its
 * display hierarchy.
 *
 * Example:
 *
 *   Reading/Technology/AI
 *
 * ensures that these parents exist:
 *
 *   Reading
 *   Reading/Technology
 *
 * The final label is created separately by the caller.
 */
function ensureParentLabels(
  labelName
) {
  const parts =
    labelName.split("/");

  if (parts.length <= 1) {
    return;
  }

  let currentPath = "";

  /*
   * Stop before the final component because the caller is
   * responsible for creating the requested label itself.
   */
  for (
    let i = 0;
    i < parts.length - 1;
    i++
  ) {
    currentPath =
      currentPath
        ? `${currentPath}/${parts[i]}`
        : parts[i];

    const existing =
      GmailApp.getUserLabelByName(
        currentPath
      );

    if (existing) {
      continue;
    }

    console.log(
      `Creating parent label: ` +
      `"${currentPath}"`
    );

    GmailApp.createLabel(
      currentPath
    );
  }
}


/*
 * Returns the Gmail API ID for a user label, creating the
 * label if necessary.
 *
 * labelMaps is updated when a new label is discovered or
 * created so callers can continue using the same maps during
 * the current execution.
 */
function getOrCreateGmailLabelId(
  labelName,
  labelMaps
) {
  let labelId =
    labelMaps.idsByName.get(
      labelName
    );

  if (labelId) {
    /*
     * Even if the child already exists, an older
     * configuration may have created it without its display
     * parent.
     */
    ensureParentLabels(
      labelName
    );

    return labelId;
  }

  /*
   * Refresh Gmail's labels before attempting creation in case
   * the supplied maps are stale.
   */
  const refreshedMaps =
    getGmailLabelMaps();

  labelId =
    refreshedMaps.idsByName.get(
      labelName
    );

  if (labelId) {
    labelMaps.idsByName.set(
      labelName,
      labelId
    );

    labelMaps.namesById.set(
      labelId,
      labelName
    );

    ensureParentLabels(
      labelName
    );

    return labelId;
  }

  /*
   * Create parent labels first so Gmail displays the intended
   * hierarchy.
   */
  ensureParentLabels(
    labelName
  );

  console.log(
    `Creating Gmail label: "${labelName}"`
  );

  const created =
    Gmail.Users.Labels.create(
      {
        name: labelName,
        labelListVisibility:
          "labelShow",
        messageListVisibility:
          "show"
      },
      "me"
    );

  labelMaps.idsByName.set(
    labelName,
    created.id
  );

  labelMaps.namesById.set(
    created.id,
    labelName
  );

  return created.id;
}


/*
 * Returns a GmailApp user label, creating it if necessary.
 *
 * This is the GmailApp counterpart to
 * getOrCreateGmailLabelId(), which is used when an API label
 * ID is required.
 */
function getOrCreateLabel(labelName) {
  /*
   * Always ensure the display hierarchy exists.
   */
  ensureParentLabels(
    labelName
  );

  let label =
    GmailApp.getUserLabelByName(
      labelName
    );

  if (label) {
    return label;
  }

  /*
   * Refresh the complete user-label collection before
   * attempting creation.
   */
  const labels =
    GmailApp.getUserLabels();

  label =
    labels.find(
      existingLabel =>
        existingLabel.getName() ===
        labelName
    );

  if (label) {
    return label;
  }

  console.log(
    `Creating GmailApp label: ` +
    `"${labelName}"`
  );

  return GmailApp.createLabel(
    labelName
  );
}


/*
 * ============================================================
 * Native filter creation
 * ============================================================
 */


/*
 * Creates a native Gmail filter for a RULES entry.
 *
 * Native filters handle arrival-time behavior:
 *
 *   - apply the configured label
 *   - optionally skip Inbox
 *
 * Positive Inbox retention periods are handled later by
 * cleanupEmails().
 */
function createNativeFilter(
  query,
  labelId,
  inboxRetentionDays
) {
  const criteria =
    splitNativeFilterQuery(
      query
    );

  const action = {
    addLabelIds: [
      labelId
    ]
  };

  /*
   * Only INBOX.SKIP (0) removes the message from Inbox when
   * it arrives.
   */
  if (
    inboxRetentionDays ===
    INBOX.SKIP
  ) {
    action.removeLabelIds = [
      "INBOX"
    ];
  }

  Gmail.Users.Settings.Filters.create(
    {
      criteria: criteria,
      action: action
    },
    "me"
  );
}


/*
 * Converts a Gmail-style search query into the criteria format
 * expected by the Gmail Filters API.
 *
 * The sender is extracted into the dedicated "from" field.
 * Everything else remains in the general query field.
 *
 * Example:
 *
 *   from:deals@example.com {"wishlist" "on sale"}
 *
 * becomes approximately:
 *
 *   {
 *     from: "deals@example.com",
 *     query: '{"wishlist" "on sale"}'
 *   }
 */
function splitNativeFilterQuery(query) {
  const fromMatch =
    query.match(
      /(?:^|\s)from:([^\s]+)/i
    );

  let remainingQuery =
    query;

  const criteria = {};

  if (fromMatch) {
    criteria.from =
      fromMatch[1];

    remainingQuery =
      query.replace(
        fromMatch[0],
        " "
      );
  }

  remainingQuery =
    remainingQuery
      .replace(/\s+/g, " ")
      .trim();

  if (remainingQuery) {
    criteria.query =
      remainingQuery;
  }

  return criteria;
}


/*
 * ============================================================
 * Native filter comparison
 * ============================================================
 */


/*
 * Determines whether a native Gmail filter's criteria match
 * an expected RULES query.
 */
function nativeFilterMatchesQuery(
  nativeFilter,
  expectedQuery
) {
  const nativeQuery =
    buildNativeFilterQuery(
      nativeFilter.criteria || {}
    );

  return (
    normalizeGmailQuery(
      nativeQuery
    ) ===
    normalizeGmailQuery(
      expectedQuery
    )
  );
}


/*
 * Reconstructs a Gmail-style query from native Gmail filter
 * criteria so it can be compared with a RULES query.
 */
function buildNativeFilterQuery(
  criteria
) {
  const parts = [];

  if (criteria.from) {
    parts.push(
      `from:${criteria.from}`
    );
  }

  if (criteria.to) {
    parts.push(
      `to:${criteria.to}`
    );
  }

  if (criteria.subject) {
    parts.push(
      `subject:${quoteIfNeeded(
        criteria.subject
      )}`
    );
  }

  if (criteria.query) {
    parts.push(
      criteria.query
    );
  }

  if (criteria.negatedQuery) {
    parts.push(
      `-(${criteria.negatedQuery})`
    );
  }

  return parts.join(" ");
}


/*
 * Checks whether a native Gmail filter performs the actions
 * required by a RULES entry.
 *
 * A matching filter must:
 *
 *   - apply the rule's configured label
 *   - skip Inbox exactly when the rule uses INBOX.SKIP
 */
function nativeFilterActionsMatch(
  nativeFilter,
  rule,
  labelNamesById
) {
  const action =
    nativeFilter.action || {};

  const addedLabels =
    new Set(
      (action.addLabelIds || [])
        .map(
          id =>
            labelNamesById.get(id) ||
            id
        )
    );

  const removedLabels =
    new Set(
      action.removeLabelIds || []
    );

  const labelMatches =
    addedLabels.has(
      rule.label
    );

  const nativeSkipsInbox =
    removedLabels.has(
      "INBOX"
    );

  const shouldSkipInbox =
    rule.inboxRetentionDays ===
    INBOX.SKIP;

  const inboxMatches =
    nativeSkipsInbox ===
    shouldSkipInbox;

  return (
    labelMatches &&
    inboxMatches
  );
}


/*
 * Normalizes superficial whitespace differences before
 * comparing Gmail queries.
 */
function normalizeGmailQuery(query) {
  return query
    .replace(/\s+/g, " ")
    .trim();
}


/*
 * Quotes a value when it contains whitespace, unless it is
 * already quoted.
 */
function quoteIfNeeded(value) {
  if (
    value.startsWith('"') &&
    value.endsWith('"')
  ) {
    return value;
  }

  if (/\s/.test(value)) {
    return `"${value}"`;
  }

  return value;
}


/*
 * ============================================================
 * Diagnostics
 * ============================================================
 */


/*
 * Logs every user-created Gmail label and its Gmail API ID.
 *
 * This is a manual diagnostic utility and is not part of the
 * scheduled maintenance run.
 */
function logAllGmailLabels() {
  const response =
    Gmail.Users.Labels.list(
      "me"
    );

  const labels =
    response.labels || [];

  labels
    .filter(
      label =>
        label.type === "user"
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          undefined,
          {
            sensitivity: "base"
          }
        )
    )
    .forEach(
      label => {
        console.log(
          `"${label.name}" ` +
          `[${label.id}]`
        );
      }
    );
}