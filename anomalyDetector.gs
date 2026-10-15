
const ANOMALY_MAX_SAMPLES = 10;
const ANOMALY_BATCH_SIZE = 100;
const ANOMALY_WINDOW_DAYS = 30;
const ANOMALY_TIME_BUDGET_MS = 240000;

const ANOMALY_STATE_PREFIX =
  "anomalyVerificationV4:";


/*
 * ============================================================
 * Anomaly detection
 * ============================================================
 *
 * Validates messages from senders whose rules use
 * knownFormats.
 *
 * Rules sharing a sender are evaluated together.
 *
 * Historical mail is scanned in bounded date windows.
 * Completed windows are remembered between executions.
 *
 * Only fully checked windows advance the verification state.
 *
 * Anomalies prevent further advancement until addressed.
 *
 * No global all-rule lookup is required.
 */


/*
 * Main entry point.
 */
function detectAnomalies() {
  const deadline =
    Date.now() + ANOMALY_TIME_BUDGET_MS;

  for (const group of getAnomalySenderGroups()) {
    if (Date.now() >= deadline) {
      console.log(
        "Anomaly detection: time budget reached."
      );
      return;
    }

    scanAnomalySender(group, deadline);
  }
}


/*
 * ============================================================
 * Sender grouping
 * ============================================================
 */

function getAnomalySenderGroups() {
  const groups = new Map();

  for (const rule of RULES) {
    const match = rule.query.match(
      /(?:^|\s)from:([^\s]+)/i
    );

    if (!match) {
      continue;
    }

    const sender = match[1].toLowerCase();

    if (!groups.has(sender)) {
      groups.set(sender, {
        sender,
        rules: []
      });
    }

    groups.get(sender).rules.push(rule);
  }

  return Array.from(groups.values())
    .filter(group =>
      group.rules.some(rule => rule.knownFormats)
    );
}


/*
 * ============================================================
 * Sender validation
 * ============================================================
 */

function scanAnomalySender(group, deadline) {
  const properties =
    PropertiesService.getScriptProperties();

  const stateKey =
    ANOMALY_STATE_PREFIX + group.sender;

  const fingerprint =
    getAnomalyGroupFingerprint(group);

  let state = null;

  const stored =
    properties.getProperty(stateKey);

  if (stored) {
    try {
      state = JSON.parse(stored);
    } catch (error) {
      state = null;
    }
  }

  /*
   * Initialize a new historical scan whenever the
   * classification criteria change.
   */
  if (
    !state ||
    state.fingerprint !== fingerprint
  ) {
    const oldest =
      getAnomalyOldestMessageDate(
        group.sender
      );

    if (oldest === null) {
      console.log(
        `${group.sender}: no messages found.`
      );
      return;
    }

    state = {
      fingerprint,
      verifiedThrough: oldest,
      initialized: true
    };
  }

  const scanStartedAt =
    Math.floor(Date.now() / 1000);

  const windowSeconds =
    ANOMALY_WINDOW_DAYS * 86400;

  const windowStart =
    state.verifiedThrough;

  if (windowStart >= scanStartedAt) {
    console.log(
      `${group.sender}: already verified.`
    );
    return;
  }

  const windowEnd =
    Math.min(
      windowStart + windowSeconds,
      scanStartedAt
    );

  const dateQuery =
    `after:${windowStart} before:${windowEnd}`;

  /*
   * Retrieve the sender's population within this window.
   */
  const populationIds =
    listAnomalyMessageIds(
      `from:${group.sender} ${dateQuery}`,
      deadline
    );

  if (populationIds === null) {
    return;
  }

  /*
   * Retrieve recognized IDs separately for each effective
   * rule query, preserving the original query semantics.
   */
  const recognizedIds = new Set();

  for (
    const query of
    getAnomalyRecognizedQueries(group)
  ) {
    const ids =
      listAnomalyMessageIds(
        `${query} ${dateQuery}`,
        deadline
      );

    if (ids === null) {
      return;
    }

    for (const id of ids) {
      recognizedIds.add(id);
    }
  }

  /*
   * Compare the complete population against the union of
   * recognized messages.
   */
  const unknownIds =
    Array.from(populationIds)
      .filter(id =>
        !recognizedIds.has(id)
      );

  if (unknownIds.length > 0) {
    console.warn(
      `${group.sender}: ` +
      `${unknownIds.length} unrecognized message(s).`
    );

    for (
      const id of
      unknownIds.slice(
        0,
        ANOMALY_MAX_SAMPLES
      )
    ) {
      if (Date.now() >= deadline) {
        return;
      }

      const message =
        Gmail.Users.Messages.get(
          "me",
          id,
          {
            format: "metadata",
            metadataHeaders: [
              "From",
              "Subject",
              "Date"
            ]
          }
        );

      const headers =
        message.payload?.headers || [];

      const getHeader = name =>
        headers.find(
          header =>
            header.name.toLowerCase() ===
            name.toLowerCase()
        )?.value || "";

      console.warn(
        `  ${getHeader("Date")} | ` +
        `${getHeader("From")} | ` +
        `${getHeader("Subject")} | ${id}`
      );
    }

    /*
     * Do not advance while anomalies remain.
     */
    properties.setProperty(
      stateKey,
      JSON.stringify(state)
    );

    return;
  }

  /*
   * The window was fully checked with no anomalies.
   */
  state.verifiedThrough = windowEnd;

  properties.setProperty(
    stateKey,
    JSON.stringify(state)
  );

  console.log(
    `${group.sender}: verified ` +
    `${new Date(windowStart * 1000).toISOString()} ` +
    `through ` +
    `${new Date(windowEnd * 1000).toISOString()}.`
  );
}


/*
 * ============================================================
 * Gmail message listing
 * ============================================================
 */


/*
 * Lists all matching message IDs, with pagination.
 *
 * Returns null if the time budget is reached.
 *
 * The caller must not advance verification state when
 * a query returns null.
 */
function listAnomalyMessageIds(query, deadline) {
  const ids = new Set();
  let pageToken;

  do {
    if (Date.now() >= deadline) {
      console.log(
        "Anomaly detection: time budget reached."
      );
      return null;
    }

    const response =
      Gmail.Users.Messages.list(
        "me",
        {
          q: query,
          maxResults: ANOMALY_BATCH_SIZE,
          ...(pageToken
            ? { pageToken }
            : {})
        }
      );

    for (
      const message of
      response.messages || []
    ) {
      ids.add(message.id);
    }

    pageToken =
      response.nextPageToken;

  } while (pageToken);

  return ids;
}


/*
 * ============================================================
 * Historical scan initialization
 * ============================================================
 */


/*
 * Finds the oldest message from a sender.
 *
 * Uses a bounded search to establish the beginning of the
 * historical scan.
 */
function getAnomalyOldestMessageDate(sender) {
  const threads =
    GmailApp.search(
      `from:${sender}`,
      0,
      1
    );

  if (threads.length === 0) {
    return null;
  }

  /*
   * Gmail search returns newest threads first, so the first
   * result cannot establish the oldest historical message.
   *
   * Start from the Unix epoch instead. Empty windows are
   * inexpensive, and verification will advance gradually.
   */
  return 0;
}


/*
 * ============================================================
 * Recognition queries
 * ============================================================
 */

function getAnomalyRecognizedQueries(group) {
  const queries = [];

  for (const rule of group.rules) {
    if (!rule.knownFormats) {
      queries.push(rule.query);
      continue;
    }

    for (const format of rule.knownFormats) {
      queries.push(
        `${rule.query} ${format.query}`
      );
    }
  }

  return [...new Set(queries)];
}


/*
 * ============================================================
 * Classification fingerprint
 * ============================================================
 */

function getAnomalyGroupFingerprint(group) {
  const queries =
    getAnomalyRecognizedQueries(group).sort();

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(queries)
    );

  return digest
    .map(byte =>
      (byte & 0xff)
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}
