const ANOMALY_MAX_SAMPLES = 10;

const ANOMALY_STATE_PREFIX =
  "anomalyVerification:";


/*
 * ============================================================
 * Anomaly detection
 * ============================================================
 */


/*
 * Checks rules using knownFormats for messages that belong to
 * the rule's broad population but are not recognized by any
 * currently configured rule.
 *
 * This provides a safety layer for broad sender rules.
 *
 * Example:
 *
 *   Base query:
 *     from:jobs@example.com
 *
 *   Known formats:
 *     "jobs recommended for you"
 *     "new jobs matching your search"
 *
 * If that sender introduces a new message format, the message
 * is reported as an anomaly rather than silently being treated
 * as known.
 *
 * Successful verification is persisted between runs. Once a
 * rule's history has been verified, later runs only need to
 * inspect messages received since the previous successful
 * verification.
 *
 * Changing the rule's classification criteria invalidates the
 * saved verification state and causes a full recheck.
 */
function detectAnomalies() {
  const scanStartedAt =
    Math.floor(
      Date.now() / 1000
    );

  for (const rule of RULES) {
    /*
     * Rules without knownFormats define their entire query 
     * population as recognized, so they have no unknown-format 
     * subset to test.
     */
    if (!rule.knownFormats) {
      continue;
    }

    const fingerprint =
      getRuleFingerprint(
        rule
      );

    const state =
      getAnomalyVerificationState(
        rule
      );

    const stateIsCurrent =
      state &&
      state.fingerprint ===
        fingerprint &&
      Number.isFinite(
        state.verifiedThrough
      );

    /*
     * If the rule has already been successfully verified with
     * the same classification criteria, inspect only messages
     * newer than that verification watermark.
     *
     * Otherwise, validate the complete rule population.
     */
    const extraQuery =
      stateIsCurrent
        ? `after:${state.verifiedThrough}`
        : "";

    const population =
      getRuleMessagesForQuery(
        rule,
        extraQuery
      );

    /*
     * A message may be unknown to this particular rule but
     * intentionally recognized by another rule.
     *
     * Restrict the cross-rule lookup to the same incremental
     * window when possible.
     */
    const allKnownMessageIds =
      getAllKnownMessageIdsForQuery(
        extraQuery
      );

    const anomalies = [];

    for (
      const message of population
    ) {
      if (
        allKnownMessageIds.has(
          message.getId()
        )
      ) {
        continue;
      }

      anomalies.push(
        message
      );

      if (
        anomalies.length >=
        ANOMALY_MAX_SAMPLES
      ) {
        break;
      }
    }

    if (anomalies.length > 0) {
      console.warn(
        `${rule.name}: ` +
        `${anomalies.length}` +
        (
          anomalies.length ===
          ANOMALY_MAX_SAMPLES
            ? "+"
            : ""
        ) +
        ` anomaly sample(s) found.`
      );

      for (
        const message of anomalies
      ) {
        console.warn(
          `  ${message.getDate().toISOString()} ` +
          `| ${message.getFrom()} ` +
          `| ${message.getSubject()} ` +
          `| ${message.getId()}`
        );
      }

      /*
       * Do not advance the verification watermark while
       * anomalies exist. The population will be checked again
       * on the next run.
       */
      continue;
    }

    /*
     * No anomalies were found, so everything up to the start
     * of this scan can be considered verified.
     */
    saveAnomalyVerificationState(
      rule,
      {
        fingerprint: fingerprint,
        verifiedThrough:
          scanStartedAt
      }
    );

    console.log(
      `${rule.name}: verified through ` +
      `${new Date(
        scanStartedAt * 1000
      ).toISOString()}`
    );
  }
}


/*
 * ============================================================
 * Verification state
 * ============================================================
 */


/*
 * Loads the persisted anomaly-verification state for a rule.
 *
 * Invalid or missing state is treated as no prior
 * verification, causing the rule to receive a full scan.
 */
function getAnomalyVerificationState(
  rule
) {
  const properties =
    PropertiesService
      .getScriptProperties();

  const value =
    properties.getProperty(
      getAnomalyVerificationKey(
        rule
      )
    );

  if (!value) {
    return null;
  }

  try {
    const state =
      JSON.parse(value);

    if (
      !state ||
      typeof state !== "object"
    ) {
      return null;
    }

    return state;
  } catch (error) {
    console.warn(
      `${rule.name}: invalid anomaly ` +
      `verification state; performing ` +
      `a full scan.`
    );

    return null;
  }
}


/*
 * Persists the latest successful verification state for a
 * rule.
 */
function saveAnomalyVerificationState(
  rule,
  state
) {
  const properties =
    PropertiesService
      .getScriptProperties();

  properties.setProperty(
    getAnomalyVerificationKey(
      rule
    ),
    JSON.stringify(state)
  );
}


/*
 * Returns the Script Properties key used to store a rule's
 * anomaly-verification state.
 *
 * Rule names therefore act as stable identifiers for this
 * state.
 */
function getAnomalyVerificationKey(
  rule
) {
  return (
    ANOMALY_STATE_PREFIX +
    rule.name
  );
}