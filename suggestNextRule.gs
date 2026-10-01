/*
 * ============================================================
 * Rule discovery
 * ============================================================
 */


/*
 * Finds one sender that is not currently covered by RULES.
 *
 * buildUncoveredSenderQuery() constructs a Gmail search that
 * excludes the senders already represented by configured
 * rules.
 *
 * This function then examines recent matching threads and
 * reports the first sender it finds.
 *
 * It is intended as a lightweight discovery tool: once the
 * suggested sender has been reviewed and a rule added if
 * appropriate, a later maintenance run can suggest another.
 */
function suggestNextRule() {
  const query =
    buildUncoveredSenderQuery();

  const threads =
    GmailApp.search(
      query,
      0,
      20
    );

  for (const thread of threads) {
    for (
      const message of
      thread.getMessages()
    ) {
      const sender =
        extractEmailAddress(
          message.getFrom()
        );

      if (sender) {
        console.log(
          `Next rule candidate: ${sender}`
        );

        return;
      }
    }
  }

  console.log(
    "No uncovered sender found."
  );
}