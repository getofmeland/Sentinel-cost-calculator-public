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
let LookbackDays = ${USAGE_LOOKBACK_DAYS};
let PeriodStart = startofday(ago(LookbackDays));
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
    title: 'Set the time range to "Set in query"',
    body:
      'The portal time picker defaults to 24 hours and will silently override the query, giving you '
      + 'roughly a thirtieth of your real volume with no warning. The query carries its own date '
      + 'filter, so set the picker to "Set in query" before running it.',
  },
  {
    title: 'Run it from the Log Analytics workspace',
    body:
      'Open Logs from the workspace itself rather than from an individual resource. Resource-scoped '
      + 'queries only cover Analytics-plan tables, so Basic and Auxiliary volume would be missing.',
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
