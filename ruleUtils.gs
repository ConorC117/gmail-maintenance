const ALL_KNOWN_QUERY_CACHE = new Map();


/*
 * Performs a final sender check on a message returned by
 * Gmail search.
 *
 * GmailApp.search() returns threads, so a matching thread can
 * contain individual messages that do not themselves match
 * the rule's sender.
 */
function messageMatchesRule(rule, message) {
  const match =
    rule.query.match(
      /(?:^|\s)from:([^\s]+)/i
    );

  if (!match) {
    return false;
  }

  const expectedSender =
    match[1].toLowerCase();

  const actualSender =
    message
      .getFrom()
      .toLowerCase();

  return actualSender.includes(
    expectedSender
  );
}


/*
 * Returns all messages in a rule's broad population.
 */
function getRuleMessages(rule) {
  return getRuleMessagesForQuery(
    rule
  );
}


/*
 * Returns messages matching a rule plus an optional
 * additional Gmail search constraint.
 *
 * Examples of extraQuery:
 *
 *   in:inbox
 *   older_than:14d
 *   after:1234567890
 */
function getRuleMessagesForQuery(
  rule,
  extraQuery = ""
) {
  const query =
    `${rule.query} ${extraQuery}`.trim();

  const threads =
    GmailApp.search(query);

  const messages = [];

  for (const thread of threads) {
    for (
      const message of
      thread.getMessages()
    ) {
      if (
        messageMatchesRule(
          rule,
          message
        )
      ) {
        messages.push(message);
      }
    }
  }

  return messages;
}


/*
 * Returns the IDs of all messages recognized by a rule.
 */
function getKnownMessageIds(rule) {
  return getKnownMessageIdsForQuery(
    rule
  );
}


/*
 * Returns the IDs of recognized messages for a rule while
 * applying an optional additional Gmail search constraint.
 *
 * If a rule has no knownFormats, its base query defines the
 * complete recognized population.
 *
 * If knownFormats are configured, a message must match at
 * least one of those formats to be considered known.
 */
function getKnownMessageIdsForQuery(
  rule,
  extraQuery = ""
) {
  const knownMessageIds =
    new Set();

  if (!rule.knownFormats) {
    for (
      const message of
      getRuleMessagesForQuery(
        rule,
        extraQuery
      )
    ) {
      knownMessageIds.add(
        message.getId()
      );
    }

    return knownMessageIds;
  }

  for (
    const format of
    rule.knownFormats
  ) {
    const query =
      `${rule.query} ` +
      `${format.query} ` +
      `${extraQuery}`;

    const threads =
      GmailApp.search(
        query.trim()
      );

    for (const thread of threads) {
      for (
        const message of
        thread.getMessages()
      ) {
        if (
          messageMatchesRule(
            rule,
            message
          )
        ) {
          knownMessageIds.add(
            message.getId()
          );
        }
      }
    }
  }

  return knownMessageIds;
}


/*
 * Returns the IDs of every message recognized by any rule.
 */
function getAllKnownMessageIds() {
  return getAllKnownMessageIdsForQuery();
}


/*
 * Returns the IDs of every message recognized by any rule
 * within an optional Gmail search constraint.
 *
 * Results are cached for the duration of the script execution
 * because anomaly detection may request the same population
 * more than once.
 */
function getAllKnownMessageIdsForQuery(
  extraQuery = ""
) {
  const cacheKey =
    extraQuery.trim();

  if (
    ALL_KNOWN_QUERY_CACHE.has(
      cacheKey
    )
  ) {
    return ALL_KNOWN_QUERY_CACHE.get(
      cacheKey
    );
  }

  const knownMessageIds =
    new Set();

  for (const rule of RULES) {
    const ruleKnownMessageIds =
      getKnownMessageIdsForQuery(
        rule,
        extraQuery
      );

    for (
      const messageId of
      ruleKnownMessageIds
    ) {
      knownMessageIds.add(
        messageId
      );
    }
  }

  ALL_KNOWN_QUERY_CACHE.set(
    cacheKey,
    knownMessageIds
  );

  return knownMessageIds;
}


/*
 * Returns recognized messages for a rule while applying an
 * optional additional Gmail search constraint.
 *
 * Messages are deduplicated because a message could match
 * more than one known format.
 */
function getKnownMessagesForQuery(
  rule,
  extraQuery = ""
) {
  const messagesById =
    new Map();

  if (!rule.knownFormats) {
    const messages =
      getRuleMessagesForQuery(
        rule,
        extraQuery
      );

    for (const message of messages) {
      messagesById.set(
        message.getId(),
        message
      );
    }

    return Array.from(
      messagesById.values()
    );
  }

  for (
    const format of
    rule.knownFormats
  ) {
    const query =
      `${rule.query} ` +
      `${format.query} ` +
      `${extraQuery}`;

    const threads =
      GmailApp.search(
        query.trim()
      );

    for (const thread of threads) {
      for (
        const message of
        thread.getMessages()
      ) {
        if (
          messageMatchesRule(
            rule,
            message
          )
        ) {
          messagesById.set(
            message.getId(),
            message
          );
        }
      }
    }
  }

  return Array.from(
    messagesById.values()
  );
}


/*
 * Builds the native Gmail filters expected for a rule.
 *
 * A rule without knownFormats needs one native filter.
 *
 * A rule with knownFormats gets one native filter per format
 * so only explicitly recognized message types are acted on
 * when they arrive.
 */
function getExpectedNativeFilters(rule) {
  if (!rule.knownFormats) {
    return [
      {
        name: rule.name,
        query: rule.query
      }
    ];
  }

  return rule.knownFormats.map(
    format => ({
      name: format.name,
      query:
        `${rule.query} ${format.query}`
    })
  );
}


/*
 * Creates a fingerprint of the parts of a rule that determine
 * message classification.
 *
 * Anomaly detection uses this to determine whether a previous
 * verification remains valid after RULES changes.
 */
function getRuleFingerprint(rule) {
  const classification = {
    query: rule.query,

    knownFormats:
      rule.knownFormats
        ? rule.knownFormats.map(
            format =>
              format.query
          )
        : null
  };

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(
        classification
      )
    );

  return digest
    .map(
      byte =>
        (byte & 0xff)
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


/*
 * Extracts a normalized email address from a Gmail
 * From header.
 *
 * Examples:
 *
 *   Example <sender@example.com>
 *       -> sender@example.com
 *
 *   sender@example.com
 *       -> sender@example.com
 */
function extractEmailAddress(from) {
  const match =
    from.match(
      /<([^>]+)>/
    );

  if (match) {
    return match[1]
      .toLowerCase();
  }

  return from
    .trim()
    .toLowerCase();
}


/*
 * Builds a Gmail query that excludes senders already covered
 * by RULES.
 *
 * This is used by suggestNextRule() to find mail from a
 * sender that has not yet been configured.
 */
function buildUncoveredSenderQuery() {
  const exclusions = [];

  for (const rule of RULES) {
    const match =
      rule.query.match(
        /from:([^\s]+)/i
      );

    if (match) {
      exclusions.push(
        `-from:${match[1]}`
      );
    }
  }

  return exclusions.join(" ");
}


/*
 * Quotes a Gmail label name so it can safely be used in a
 * Gmail search query.
 */
function quoteGmailLabel(labelName) {
  const escaped =
    labelName.replace(
      /"/g,
      '\\"'
    );

  return `"${escaped}"`;
}