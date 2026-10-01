/*
 * ============================================================
 * Gmail maintenance
 * ============================================================
 */


/*
 * Main maintenance entry point.
 *
 * This is the function intended to be run by a scheduled
 * Apps Script trigger.
 *
 * Maintenance stages run in this order:
 *
 *   1. Synchronize native Gmail filters.
 *   2. Check for unknown message formats.
 *   3. Apply current RULES labels.
 *   4. Apply archive and retention policies.
 *   5. Audit native Gmail filters.
 *   6. Suggest an uncovered sender for a future rule.
 *
 * Each stage runs independently. A failure in one subsystem
 * is logged but does not prevent the remaining stages from
 * running.
 */
function runMaintenance() {
  console.log(
    "=== Gmail maintenance started ==="
  );

  runMaintenanceStep(
    "Native filter sync",
    syncNativeFilters
  );

  runMaintenanceStep(
    "Anomaly detection",
    detectAnomalies
  );

  runMaintenanceStep(
    "Email organization",
    organizeEmails
  );

  runMaintenanceStep(
    "Lifecycle cleanup",
    cleanupEmails
  );

  runMaintenanceStep(
    "Native filter audit",
    auditNativeFilters
  );

  runMaintenanceStep(
    "Suggest next rule",
    suggestNextRule
  );

  console.log(
    "\n=== Gmail maintenance complete ==="
  );
}


/*
 * Runs one maintenance stage with isolated error handling and
 * execution-time logging.
 *
 * Errors are deliberately not rethrown so that an unrelated
 * maintenance stage can still run if one stage fails.
 */
function runMaintenanceStep(
  name,
  fn
) {
  console.log(
    `\n--- ${name} ---`
  );

  const started =
    Date.now();

  try {
    fn();

    const seconds =
      (
        (Date.now() - started) /
        1000
      ).toFixed(1);

    console.log(
      `${name} completed in ` +
      `${seconds}s.`
    );
  } catch (error) {
    const seconds =
      (
        (Date.now() - started) /
        1000
      ).toFixed(1);

    console.error(
      `${name} FAILED after ` +
      `${seconds}s: ` +
      `${error.stack || error}`
    );
  }
}