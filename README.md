# Gmail maintenance

A rule-based Gmail organizer and retention system built with Google Apps Script.

The project uses a single rules configuration to manage:

- Gmail labels
- Native Gmail filters
- Inbox retention
- Automatic archiving
- Email retention and cleanup
- Known message formats
- Anomaly detection
- Rule discovery

The goal is to make Gmail behavior declarative: define how a category of email should behave in `rules.gs`, then let the maintenance script keep Gmail consistent with that configuration.

## How It Works

Each rule defines a Gmail query, a label, an Inbox lifetime, and an overall retention period.

For example:

```javascript
rule(
  "Wishlist Deals",
  'from:deals@example.com {"from your wishlist" "now on sale"}',
  "Deals/Games",
  INBOX.D14,
  KEEP.D30
)
```

This means:

- Match messages from `deals@example.com` containing either `"from your wishlist"` or `"now on sale"`.
- Apply the `Deals/Games` label.
- Allow the message to remain in Inbox for 14 days.
- Move it to Trash after 30 days.

Native Gmail filters handle behavior that needs to happen when mail arrives, while the Apps Script maintenance process handles later organization and lifecycle management.

## Project Structure

```text
gmail-maintenance/
├── README.md
├── LICENSE
├── main.gs
├── rules.gs
├── ruleUtils.gs
├── gmailUtils.gs
├── organizer.gs
├── cleanup.gs
├── anomalyDetector.gs
├── nativeFilterSync.gs
├── nativeFilterAudit.gs
└── suggestNextRule.gs
```

### `rules.gs`

The main configuration file and source of truth for managed email behavior.

### `main.gs`

Runs each maintenance stage and is the entry point intended for a scheduled trigger.

### `ruleUtils.gs`

Contains rule matching, known-format handling, query construction, and other rule-related utilities.

### `gmailUtils.gs`

Contains shared Gmail and Gmail API utilities for labels, native filters, and diagnostics.

### `nativeFilterSync.gs`

Creates or updates native Gmail filters so their arrival-time behavior matches `RULES`.

### `nativeFilterAudit.gs`

Checks native Gmail filters against `RULES` without modifying them.

### `organizer.gs`

Applies current rule labels to existing mail and removes managed labels that have become obsolete.

### `cleanup.gs`

Archives and moves recognized mail to Trash according to the lifecycle configured for each rule.

### `anomalyDetector.gs`

For rules with `knownFormats`, detects messages that belong to the broader rule population but do not match a recognized format.

### `suggestNextRule.gs`

Suggests a sender not currently covered by `RULES`.

## Setup

### 1. Create an Apps Script project

Open Google Apps Script and create a new standalone project:

`https://script.google.com/`

Give the project a name such as `Gmail Maintainence`.

### 2. Add the source files

Create the following script files in the Apps Script project:

```text
main.gs
rules.gs
ruleUtils.gs
gmailUtils.gs
organizer.gs
cleanup.gs
anomalyDetector.gs
nativeFilterSync.gs
nativeFilterAudit.gs
suggestNextRule.gs
```

Copy the corresponding source from this repository into each file.

The default `Code.gs` file can be deleted.

### 3. Enable the Gmail API service

This project uses the Advanced Gmail service for operations that are not available through the basic `GmailApp` interface.

In the Apps Script editor:

1. Open **Services**.
2. Click **Add a service**.
3. Select **Gmail API**.
4. Add it to the project.

The service should then appear as `Gmail` in the project.

### 4. Configure your rules

Edit `rules.gs`.

Each rule follows this structure:

```javascript
rule(
  name,
  query,
  label,
  inboxRetentionDays,
  retentionDays
)
```

For example:

```javascript
rule(
  "Tech Newsletter",
  'from:newsletter@example.com',
  "Reading/Technology",
  INBOX.SKIP,
  KEEP.FOREVER
)
```

Standard Gmail search syntax can be used in rule queries.

Examples:

```javascript
// Sender
'from:newsletter@example.com'

// Sender AND phrase
'from:orders@example.com "order confirmation"'

// Sender AND (phrase A OR phrase B)
'from:deals@example.com {"from your wishlist" "now on sale"}'
```

## Inbox Retention

Inbox retention controls how long a recognized message remains in Inbox.

```javascript
INBOX.SKIP
INBOX.D1
INBOX.D14
INBOX.D30
```

For example:

```javascript
INBOX.SKIP
```

causes the generated native Gmail filter to skip Inbox immediately.

By contrast:

```javascript
INBOX.D14
```

allows the message to arrive in Inbox normally. The maintenance script archives it once it is older than 14 days.

## Email Retention

Retention controls how long the underlying email is kept.

```javascript
KEEP.DISCARD
KEEP.D14
KEEP.D30
KEEP.FOREVER
```

For example:

```javascript
KEEP.D30
```

moves recognized mail to Trash after 30 days.

```javascript
KEEP.FOREVER
```

does not perform automatic retention cleanup for that rule.

## Known Formats

Some senders produce multiple kinds of email. A broad sender rule can therefore optionally define the specific message formats that are safe for automatic processing.

For example:

```javascript
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
        query: '"jobs recommended for you"'
      },
      {
        name: "Search alert",
        query:
          '{"new jobs matching your search" "new opportunities for you"}'
      }
    ]
  }
)
```

Here:

```text
from:jobs@example.com
```

defines the broad population, while `knownFormats` defines which messages within that population are recognized.

Messages from the sender that do not match a known format are left untouched by rule-based organization and cleanup and are reported by anomaly detection.

This is useful when automatically deleting or archiving some kinds of mail from a sender could otherwise affect an unexpected new message type.

## First Run

Before creating a scheduled trigger, run the system manually.

In the Apps Script editor:

1. Select `runMaintenance`.
2. Click **Run**.
3. Approve the requested Google account permissions.
4. Review the execution log.
5. Check the resulting Gmail labels and filters.

The first run may do considerably more work than later runs because existing mail needs to be reconciled with the configured rules.

Review your rules carefully before running the project against an important Gmail account. Depending on the configuration, the maintenance process can archive messages, move messages to Trash, create filters, and remove labels previously managed by the project.

## Scheduled Maintenance

Once the configuration has been tested, create a time-driven Apps Script trigger for:

```text
runMaintenance
```

In the Apps Script editor:

1. Open **Triggers**.
2. Click **Add Trigger**.
3. Choose `runMaintenance`.
4. Select **Time-driven** as the event source.
5. Choose the desired schedule.
6. Save the trigger.

The appropriate frequency depends on how quickly you want timed Inbox and retention rules to take effect. An hourly or daily trigger is sufficient for many configurations.

Native filters do not depend on the scheduled trigger to process new mail once they have been created. In particular, `INBOX.SKIP` rules can skip Inbox as soon as matching mail arrives.

## Maintenance Stages

`runMaintenance()` executes the following stages:

```text
Native filter sync
        ↓
Anomaly detection
        ↓
Email organization
        ↓
Lifecycle cleanup
        ↓
Native filter audit
        ↓
Suggest next rule
```

Each stage has isolated error handling. A failure in one stage is logged without automatically preventing the remaining stages from running.

## Managed Labels

Labels referenced by `RULES` are treated as labels managed by this project.

The organizer remembers the managed labels from the previous successful run. If a label disappears from `RULES`, the organizer can remove that obsolete label from Gmail.

This also supports label renaming: the new label is applied before the old managed label is removed.

On the first run, there is no previous managed-label state. The project therefore establishes a baseline rather than assuming that unrelated existing Gmail labels should be deleted.

## Native Gmail Filters

The project synchronizes native Gmail filters for each configured rule.

Native filters are responsible for:

- Applying the configured label when mail arrives.
- Skipping Inbox when `INBOX.SKIP` is configured.

Rules with `knownFormats` generate a native filter for each recognized format rather than applying the broad rule query indiscriminately.

The project does not treat every native Gmail filter in the account as its own. Unrelated filters are left alone.

## Safety

Automatic email cleanup should be configured conservatively.

In particular:

- Start with rules that are easy to verify.
- Use `KEEP.FOREVER` when automatic deletion is unnecessary.
- Use `knownFormats` when a sender produces multiple kinds of mail and only specific formats should be processed.
- Review anomaly detection output before expanding a rule.
- Run `runMaintenance()` manually and inspect its output before enabling a scheduled trigger.

Messages moved to Trash remain subject to Gmail's normal Trash behavior.

## License

See `LICENSE` for license information.