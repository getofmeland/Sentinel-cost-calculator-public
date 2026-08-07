/**
 * The KQL a customer runs against their own workspace, whose results they paste
 * into Analyse mode.
 *
 * Every clause here exists for a documented reason. Getting this wrong produces
 * confidently wrong savings advice, which is worse than none, so the reasoning
 * is recorded alongside rather than in a commit message.
 *
 * https://learn.microsoft.com/en-us/azure/azure-monitor/logs/analyze-usage
 */

/** Complete days to look back. Matches Microsoft's samples and the 31-day commitment period. */
export const USAGE_LOOKBACK_DAYS = 31

/**
 * Megabytes to gigabytes for BILLING purposes.
 *
 * 1000, not 1024. Azure Monitor bills in "GB (10^9 bytes)" — but Microsoft's own
 * Usage sample-query page ships `sum(Quantity) / 1024` in two places, which
 * overstates volume by 2.4%. Near a commitment-tier boundary that is enough to
 * recommend the wrong tier, so the divisor lives here, named and tested, rather
 * than inline in a query string a user might edit.
 */
export const MB_PER_GB_BILLING = 1000

/**
 * The query is deliberately written to return MEGABYTES and let TypeScript do
 * the conversion, so the divisor above is the single tested source of truth and
 * the pasted numbers stay comfortably above the range where KQL would render
 * them in exponential notation.
 */
export const USAGE_QUERY = `// Sentinel / Log Analytics ingestion by table — last ${USAGE_LOOKBACK_DAYS} complete days
// Lookback is a timespan literal (the trailing d), not a number. ago() rejects
// a bare integer with "argument #1 was not of an expected data type: timespan".
let Lookback = ${USAGE_LOOKBACK_DAYS}d;
let PeriodStart = startofday(ago(Lookback));
let PeriodEnd = startofday(now());
Usage
| where TimeGenerated >= PeriodStart and TimeGenerated < PeriodEnd
| where StartTime >= PeriodStart and StartTime < PeriodEnd
| summarize
    TotalMB = round(sum(Quantity), 1),
    BillableMB = round(sumif(Quantity, tostring(IsBillable) =~ "true"), 1)
  by TableName = DataType, Plan
| project TableName, Plan, TotalMB, BillableMB
| order by BillableMB desc`

/**
 * Notes surfaced next to the query in the UI. These are the traps that silently
 * corrupt results rather than producing an error, so the user has to know.
 */
export const USAGE_QUERY_NOTES = [
  {
    title: 'Run it on the Logs surface, not Advanced hunting',
    body:
      'Usage is a Log Analytics workspace table. In the Azure portal: Log Analytics workspaces → '
      + 'your workspace → Logs. In the Defender portal: Microsoft Sentinel → Logs. Advanced hunting '
      + 'uses the Defender XDR schema and has no Usage table, so the query cannot resolve there.',
  },
  {
    title: 'Set the time range to "Set in query"',
    body:
      'The portal time picker defaults to 24 hours and will silently override the query, giving you '
      + 'roughly a thirtieth of your real volume with no warning. The query carries its own date '
      + 'filter, so set the picker to "Set in query" before running it.',
  },
  {
    title: 'Open Logs from the workspace, not from a resource',
    body:
      'Resource-scoped queries only cover Analytics-plan tables, so Basic and Auxiliary volume '
      + 'would be missing from the result.',
  },
  {
    title: 'You need Log Analytics Reader',
    body:
      'Reader, Contributor, Owner or Microsoft Sentinel Reader also work. If table-level RBAC hides '
      + 'tables from you, those queries succeed but return nothing — no error — so the result would '
      + 'be quietly incomplete.',
  },
] as const

/**
 * Optional second query: billable volume per DAY, rather than per table.
 *
 * WHY A SECOND QUERY RATHER THAN MORE COLUMNS ON THE FIRST
 *
 * The main query is deliberately untouched. It works, people have run it, and a
 * changed query means every saved copy silently returns the wrong shape. This
 * one is additive: skip it and the analysis behaves exactly as before.
 *
 * WHAT IT UNLOCKS
 *
 * The main query returns a 31-day total, so the tool can only size a commitment
 * tier against an AVERAGE. That is the wrong statistic for the decision, because
 * commitment pricing is asymmetric in the customer's favour on one side only:
 * volume above your commitment bills at that tier's own discounted rate, so
 * under-committing costs little, while a tier can only be lowered every 31 days,
 * so over-committing is locked in. Sizing to the mean of a spiky month
 * systematically over-commits.
 *
 * With the daily series the tool stops estimating altogether: it prices every
 * tier against the actual days observed and picks the cheapest. No percentile
 * rule of thumb, no assumption about the shape of the distribution.
 *
 * Returns roughly one row per day per plan — about thirty lines.
 */
export const DAILY_VOLUME_QUERY = `// Billable volume per day — optional, improves commitment tier accuracy
let Lookback = ${USAGE_LOOKBACK_DAYS}d;
let PeriodStart = startofday(ago(Lookback));
let PeriodEnd = startofday(now());
Usage
| where TimeGenerated >= PeriodStart and TimeGenerated < PeriodEnd
| where StartTime >= PeriodStart and StartTime < PeriodEnd
| summarize BillableMB = round(sumif(Quantity, tostring(IsBillable) =~ "true"), 1)
  by Day = format_datetime(startofday(StartTime), 'yyyy-MM-dd'), Plan
| order by Day asc`

/**
 * Errors users have actually hit, with the cause rather than a restatement of
 * the message. Both of these were reported against shipped versions.
 */
export const USAGE_QUERY_ERRORS = [
  {
    message: "Failed to resolve table or column expression named 'Usage'",
    cause:
      'You are almost certainly in Advanced hunting, which uses the Defender XDR schema and has no '
      + 'Usage table. Switch to Microsoft Sentinel → Logs in the Defender portal, or open Logs from '
      + 'the Log Analytics workspace in the Azure portal. It can also mean no workspace is selected.',
  },
  {
    message: "ago(): argument #1 was not of an expected data type: timespan",
    cause:
      'An older copy of this query. Copy it again from above — the lookback needs its unit suffix '
      + '(31d rather than 31).',
  },
] as const

/**
 * What this measurement cannot see. Stated explicitly in the UI, because an
 * omission that looks like a zero is its own kind of wrong answer.
 */
export const USAGE_QUERY_LIMITATIONS = [
  'Sentinel data lake usage — ingestion, query, storage and compute meters have no KQL equivalent. '
    + 'Check Microsoft Sentinel > Cost management in the Defender portal for those.',
  'Per-table retention settings, which are not exposed to KQL at all. Retention costs stay estimated '
    + 'rather than measured.',
  'Tables configured but idle in the period, which cost retention but report no ingestion.',
] as const
