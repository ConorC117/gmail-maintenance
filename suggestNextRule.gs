/*
 * ============================================================
 * Rule discovery configuration
 * ============================================================
 */

const DISCOVERY_BATCH_SIZE = 100;
const DISCOVERY_TOP_N = 10;

const DISCOVERY_STATE_KEY =
  "ruleDiscoveryState";

const DISCOVERY_QUERY =
  "in:anywhere -in:trash -in:spam";


/*
 * ============================================================
 * Rule discovery
 * ============================================================
 *
 * Incrementally scans Gmail and ranks senders by the number
 * of messages in threads without any currently managed label.
 *
 * Each execution processes a bounded batch of threads.
 * Progress persists between executions.
 *
 * Rankings are provisional until the scan completes.
 *
 * Coverage is approximated at thread level using labels.
 */


/*
 * Main discovery entry point.
 *
 * Intended to run during normal maintenance.
 */
function suggestNextRule() {
  const fingerprint =
    getDiscoveryRulesFingerprint();

  let state =
    getRuleDiscoveryState();

  /*
   * Reset the scan when the managed label configuration
   * changes.
   */
  if (
    !state ||
    state.fingerprint !== fingerprint
  ) {
    state =
      createRuleDiscoveryState(
        fingerprint
      );

    console.log(
      "Discovery configuration changed. " +
      "Starting a new scan."
    );
  }

  /*
   * Once complete, display the existing ranking.
   */
  if (state.complete) {
    logRuleDiscoveryRanking(state);
    return;
  }

  const managedLabels =
    getManagedLabelNames();

  /*
   * Retrieve the next batch of threads.
   */
  const threads =
    GmailApp.search(
      DISCOVERY_QUERY,
      state.offset,
      DISCOVERY_BATCH_SIZE
    );

  if (threads.length === 0) {
    state.complete = true;

    saveRuleDiscoveryState(state);
    logRuleDiscoveryRanking(state);

    return;
  }

  /*
   * Inspect each thread for managed labels.
   */
  for (const thread of threads) {
    const threadLabels =
      new Set(
        thread
          .getLabels()
          .map(
            label =>
              label.getName()
          )
      );

    const isCovered =
      Array.from(
        managedLabels
      ).some(
        label =>
          threadLabels.has(label)
      );

    /*
     * A thread with a managed label is treated as covered.
     */
    if (isCovered) {
      state.scanned +=
        thread.getMessageCount();

      continue;
    }

    /*
     * Count messages by sender for uncovered threads.
     */
    for (
      const message of
      thread.getMessages()
    ) {
      const sender =
        extractEmailAddress(
          message.getFrom()
        );

      if (!sender) {
        continue;
      }

      state.counts[sender] =
        (state.counts[sender] || 0) + 1;

      state.uncovered++;
      state.scanned++;
    }
  }

  state.offset += threads.length;

  if (
    threads.length <
    DISCOVERY_BATCH_SIZE
  ) {
    state.complete = true;
  }

  saveRuleDiscoveryState(state);
  logRuleDiscoveryRanking(state);
}


/*
 * ============================================================
 * Rule configuration fingerprint
 * ============================================================
 */


/*
 * Creates a fingerprint of the managed labels.
 *
 * Adding, removing, or renaming a managed label restarts
 * discovery.
 */
function getDiscoveryRulesFingerprint() {
  const labels =
    Array.from(
      getManagedLabelNames()
    ).sort();

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(labels)
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
 * ============================================================
 * Persistent discovery state
 * ============================================================
 */

function createRuleDiscoveryState(
  fingerprint
) {
  return {
    fingerprint: fingerprint,
    offset: 0,
    scanned: 0,
    uncovered: 0,
    complete: false,
    counts: {}
  };
}


function getRuleDiscoveryState() {
  const stored =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        DISCOVERY_STATE_KEY
      );

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored);
  } catch (error) {
    console.warn(
      "Invalid discovery state. Starting over."
    );

    return null;
  }
}


function saveRuleDiscoveryState(state) {
  PropertiesService
    .getScriptProperties()
    .setProperty(
      DISCOVERY_STATE_KEY,
      JSON.stringify(state)
    );
}


/*
 * ============================================================
 * Ranking output
 * ============================================================
 */

function logRuleDiscoveryRanking(state) {
  const ranking =
    Object.entries(state.counts)
      .sort(
        (a, b) =>
          b[1] - a[1] ||
          a[0].localeCompare(b[0])
      )
      .slice(
        0,
        DISCOVERY_TOP_N
      );

  console.log(
    "\n--- Top uncovered senders ---"
  );

  if (ranking.length === 0) {
    console.log(
      "No uncovered messages found."
    );
  }

  for (
    const [index, [sender, count]]
    of ranking.entries()
  ) {
    console.log(
      `${index + 1}. ${sender} — ` +
      `${count} uncovered messages`
    );
  }

  console.log(
    `\nMessages scanned: ${state.scanned}`
  );

  console.log(
    `Uncovered messages: ${state.uncovered}`
  );

  console.log(
    `Discovery: ${
      state.complete
        ? "Complete"
        : "In progress"
    }`
  );
}


/*
 * ============================================================
 * Manual reset
 * ============================================================
 */

function resetRuleDiscovery() {
  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      DISCOVERY_STATE_KEY
    );

  console.log(
    "Rule discovery state reset."
  );
}
