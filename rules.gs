/*
 * ============================================================
 * Gmail rule configuration
 * ============================================================
 *
 * This file is the main configuration for the project.
 *
 * Each rule defines:
 *
 *   rule(
 *     name,
 *     Gmail query,
 *     label,
 *     inbox duration,
 *     retention duration,
 *     optional extras
 *   )
 *
 *
 * Inbox:
 *
 *   INBOX.SKIP  = skip Inbox immediately
 *   INBOX.D1    = archive after 1 day
 *   INBOX.D14   = archive after 14 days
 *   INBOX.D30   = archive after 30 days
 *
 *
 * Retention:
 *
 *   KEEP.DISCARD  = move to Trash immediately
 *   KEEP.D14      = move to Trash after 14 days
 *   KEEP.D30      = move to Trash after 30 days
 *   KEEP.FOREVER  = retain indefinitely
 *
 *
 * knownFormats:
 *
 *   Optional.
 *
 *   Use when a broad rule population contains several known
 *   message formats and only those formats should be acted on.
 *
 *   Messages that match the broad rule but do not match a
 *   known format are detected as anomalies rather than being
 *   automatically processed.
 */


/*
 * ============================================================
 * Durations
 * ============================================================
 */

const INBOX = {
  SKIP: 0,
  D1: 1,
  D14: 14,
  D30: 30
};

const KEEP = {
  DISCARD: 0,
  D14: 14,
  D30: 30,
  FOREVER: null
};


/*
 * ============================================================
 * Rule constructor
 * ============================================================
 */

function rule(
  name,
  query,
  label,
  inboxRetentionDays,
  retentionDays,
  extra = {}
) {
  return {
    name,
    query,
    label,
    inboxRetentionDays,
    retentionDays,
    ...extra
  };
}


/*
 * ============================================================
 * Example rules
 * ============================================================
 *
 * Replace these examples with rules for your own Gmail
 * account.
 *
 * Standard Gmail search syntax can be used directly in each
 * query.
 */

const RULES = [

  /*
   * ----------------------------------------------------------
   * Basic sender rule
   * ----------------------------------------------------------
   *
   * Matches all mail from one sender.
   *
   * Skips Inbox immediately and is retained indefinitely.
   */

  rule(
    "Tech Newsletter",
    'from:newsletter@example.com',
    "Reading/Technology",
    INBOX.SKIP,
    KEEP.FOREVER
  ),


  /*
   * ----------------------------------------------------------
   * Sender + required phrase
   * ----------------------------------------------------------
   *
   * Gmail search terms are combined with AND by default.
   *
   * This matches mail from the specified sender that also
   * contains the phrase "order confirmation".
   */

  rule(
    "Store Receipts",
    'from:orders@example.com "order confirmation"',
    "Receipts/Store",
    INBOX.SKIP,
    KEEP.FOREVER
  ),


  /*
   * ----------------------------------------------------------
   * Multiple matching phrases
   * ----------------------------------------------------------
   *
   * Gmail's { ... } syntax means OR.
   *
   * This matches mail from the specified sender containing
   * either "from your wishlist" OR "now on sale".
   *
   * The message initially remains in Inbox, is archived after
   * 14 days, and is moved to Trash after 30 days.
   */

  rule(
    "Wishlist Deals",
    'from:deals@example.com {"from your wishlist" "now on sale"}',
    "Deals/Games",
    INBOX.D14,
    KEEP.D30
  ),


  /*
   * ----------------------------------------------------------
   * Immediate cleanup
   * ----------------------------------------------------------
   *
   * Skips Inbox immediately and is eligible for immediate
   * cleanup.
   */

  rule(
    "Low-value Notifications",
    'from:notifications@example.com',
    "Notifications/Disposable",
    INBOX.SKIP,
    KEEP.DISCARD
  ),


  /*
   * ----------------------------------------------------------
   * Known formats
   * ----------------------------------------------------------
   *
   * Sometimes one sender produces several kinds of email.
   *
   * The base query defines the broad population, while
   * knownFormats defines the message formats that are safe
   * for the system to process automatically.
   *
   * An email matching the base query but none of these
   * formats will be reported by anomaly detection rather
   * than silently treated as known.
   */

  rule(
    "Job Alerts",
    'from:jobs@example.com',
    "Jobs/Alerts",
    INBOX.D14,
    KEEP.D30,
    {
      knownFormats: [
        {
          name: "Recommendations",
          query:
            '"jobs recommended for you"'
        },
        {
          name: "Search alert",
          query:
            '{"new jobs matching your search" "new opportunities for you"}'
        }
      ]
    }
  ),


  /*
   * ----------------------------------------------------------
   * Short-lived Inbox notification
   * ----------------------------------------------------------
   *
   * Remains in Inbox for one day before being archived.
   * The underlying email is retained indefinitely.
   */

  rule(
    "Security Alerts",
    'from:security@example.com',
    "Security/Alerts",
    INBOX.D1,
    KEEP.FOREVER
  )

];