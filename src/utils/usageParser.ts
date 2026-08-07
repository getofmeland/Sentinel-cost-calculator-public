import { MB_PER_GB_BILLING, USAGE_LOOKBACK_DAYS } from '../data/usageQuery'

/**
 * Parses query results a user pastes or uploads from the Azure or Defender
 * portal.
 *
 * Microsoft documents which menu item to click and nothing else — no delimiter,
 * no quoting rules, no BOM, no line endings, no number formatting. So this
 * sniffs rather than assumes, and treats anything it cannot confidently
 * interpret as an error rather than guessing.
 *
 * Clipboard copy is typically tab-separated and may omit headers; CSV export is
 * comma-separated, quoted, and BOM-prefixed. Both are accepted.
 */

/** Table plans, as reported by the Usage table's Plan column. */
export type TablePlan = 'Analytics' | 'Basic' | 'Auxiliary'

export interface UsageRow {
  tableName: string
  plan: TablePlan
  /** Billable volume over the measured period */
  billableGb: number
  /** All volume including free, over the measured period */
  totalGb: number
  billableGbPerDay: number
  totalGbPerDay: number
  /** True when the row reported volume but none of it was billable */
  isFree: boolean
}

export interface ParsedUsage {
  rows: UsageRow[]
  lookbackDays: number
  totalBillableGbPerDay: number
  totalGbPerDay: number
  /** Analytics-plan billable volume — the only volume commitment tiers apply to */
  analyticsBillableGbPerDay: number
  basicBillableGbPerDay: number
  auxiliaryBillableGbPerDay: number
  /** Rows whose Plan column was absent; treated as Analytics with a caveat */
  planAssumedRowCount: number
  warnings: string[]
}

export class UsageParseError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'UsageParseError'
  }
}

// ─── Column recognition ──────────────────────────────────────────────────────

/**
 * Column aliases we accept. Users edit queries, and the portal exports whatever
 * alias the query used, so matching on a fixed header order would be brittle.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  tableName: ['tablename', 'datatype', 'table', 'name'],
  plan: ['plan', 'tableplan'],
  billableMb: ['billablemb', 'billabledatamb'],
  billableGb: ['billablegb', 'billabledatagb', 'billabledatagbs'],
  totalMb: ['totalmb', 'totaldatamb', 'quantity'],
  totalGb: ['totalgb', 'totaldatagb', 'totalvolumegb', 'totalingestionvolgb'],
}

function matchColumn(header: string): string | null {
  const norm = header.trim().toLowerCase().replace(/[\s_-]/g, '')
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(norm)) return key
  }
  return null
}

// ─── Tokenising ──────────────────────────────────────────────────────────────

/** Split a delimited line, honouring RFC 4180 quoting with doubled quotes. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      out.push(field); field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map(f => f.trim())
}

/**
 * Pick the delimiter by seeing which produces a consistent, plausible column
 * count across the first few lines — rather than assuming comma or tab.
 */
export function sniffDelimiter(lines: string[]): string {
  const candidates = ['\t', ',', ';', '|']
  let best = '\t'
  let bestScore = -1

  for (const d of candidates) {
    const counts = lines.slice(0, 5).map(l => splitDelimited(l, d).length)
    if (counts.length === 0) continue
    const consistent = counts.every(c => c === counts[0])
    // Need at least two columns to be a table at all.
    const score = consistent && counts[0] >= 2 ? counts[0] : -1
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

/**
 * The complete grammar of a number this parser will accept. Anything else is
 * rejected rather than guessed at, because every guess available here is wrong
 * by a factor of ten or more.
 *
 * ACCEPTED
 *   1234   1234.5   0            plain
 *   1,234   1,234.5   1,234,567  comma as a thousands separator, groups of three
 *   1.23E+05   4.2e-3            Azure emits exponential notation for large values
 *   whitespace anywhere           grids use spaces and non-breaking spaces to group
 *
 * REJECTED, and why it matters
 *   1234,5    a decimal comma. Whether that means 1234.5 or 12345 depends on the
 *             reader's locale, and this tool ships a EUR option, so European
 *             pastes are squarely in scope. The old code stripped every comma
 *             unconditionally and returned 12345 \u2014 a tenfold overstatement of a
 *             cost, silently.
 *   1.234,5   European grouping, same reasoning, up to a thousandfold.
 *   0x10      Number('0x10') is 16. JavaScript numeric literals are not volumes
 *             anyone typed, and accepting them means accepting 0b, 0o and
 *             Infinity too.
 *
 * The previous implementation's docstring already claimed values that "do not
 * parse cleanly" were rejected. They were not; it deferred to Number(), which
 * is far more permissive than the prose promised.
 */
const STRICT_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s\u00A0]/g, '')
  if (!STRICT_NUMBER.test(cleaned)) return null
  const n = Number(cleaned.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Exported as `matchPlan` for the daily-volume parser, which needs exactly the
 * same tolerance for the portal's "Auxiliary / Lake" rendering.
 */
export function matchPlan(raw: string | undefined): TablePlan | null {
  return normalisePlan(raw)
}

function normalisePlan(raw: string | undefined): TablePlan | null {
  // Whitespace stripped because the portal renders the plan as "Auxiliary / Lake"
  // with spaces around the slash, while the API value is plain "Auxiliary".
  const p = (raw ?? '').toLowerCase().replace(/\s/g, '')
  if (p === 'analytics') return 'Analytics'
  if (p === 'basic') return 'Basic'
  // Microsoft renamed the portal label to "Auxiliary / Lake" but the value
  // stays "Auxiliary"; lake-only ingestion reports under this plan.
  if (p === 'auxiliary' || p === 'lake' || p === 'auxiliary/lake') return 'Auxiliary'
  return null
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const MAX_ROWS = 5000

export function parseUsagePaste(input: string, lookbackDays = USAGE_LOOKBACK_DAYS): ParsedUsage {
  if (!input || !input.trim()) {
    throw new UsageParseError('Nothing to read.', 'Paste the results of the query above.')
  }
  // Every per-day figure divides by this. Zero yields Infinity, which then
  // propagates through every cost in the report as a plausible-looking number.
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new UsageParseError(
      'The lookback period must be a positive number of days.',
      `The query above measures ${USAGE_LOOKBACK_DAYS} complete days.`,
    )
  }

  // Strip a UTF-8 BOM (\uFEFF), which CSV exports commonly carry, and normalise
  // line endings. Written as an escape rather than a literal so it is visible.
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '')

  if (lines.length === 0) {
    throw new UsageParseError('Nothing to read.', 'Paste the results of the query above.')
  }
  if (lines.length > MAX_ROWS) {
    throw new UsageParseError(
      `That is ${lines.length.toLocaleString()} rows, which is more than this expects.`,
      'Paste the per-table summary rather than raw log records.',
    )
  }

  const delimiter = sniffDelimiter(lines)
  const firstCells = splitDelimited(lines[0], delimiter)

  // A header row is one where at least two cells are recognised column names.
  const headerMatches = firstCells.map(matchColumn)
  const hasHeader = headerMatches.filter(Boolean).length >= 2

  if (!hasHeader) {
    throw new UsageParseError(
      'Could not find the column headings.',
      'Copy the results including the header row, or use "Export to CSV". Expected columns like '
      + 'TableName, Plan, TotalMB and BillableMB.',
    )
  }

  const index: Record<string, number> = {}
  headerMatches.forEach((key, i) => { if (key && !(key in index)) index[key] = i })

  if (index.tableName === undefined) {
    throw new UsageParseError(
      'No table-name column found.',
      'The results need a TableName (or DataType) column.',
    )
  }
  const hasVolume =
    index.billableMb !== undefined || index.billableGb !== undefined
    || index.totalMb !== undefined || index.totalGb !== undefined
  if (!hasVolume) {
    throw new UsageParseError(
      'No volume column found.',
      'The results need BillableMB or BillableGB (TotalMB / TotalGB also accepted).',
    )
  }

  const hasBillableColumn = index.billableMb !== undefined || index.billableGb !== undefined

  // The width a data row is EXPECTED to have, taken as the most common width
  // across the data rows rather than from the header.
  //
  // Comparing against the header instead looks obvious and is wrong: a header
  // can legitimately be narrower than its data. An Excel round-trip that adds a
  // column without a heading gives every row one extra field, and judging by the
  // header then condemns the entire paste as malformed — which is a far worse
  // failure than the shifted-column bug this check exists to catch. Judging by
  // the modal width instead isolates the rows that genuinely disagree with their
  // neighbours, which is exactly the unquoted-delimiter case.
  //
  // Leading columns still align when the header is short, so the indexed
  // columns are read correctly; only trailing unnamed fields are ignored.
  const dataWidths = lines.slice(1).map(l => splitDelimited(l, delimiter).length)
  const widthCounts = new Map<number, number>()
  for (const w of dataWidths) widthCounts.set(w, (widthCounts.get(w) ?? 0) + 1)
  const modalWidth = [...widthCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? firstCells.length

  const warnings: string[] = []
  const rows: UsageRow[] = []
  const seen = new Set<string>()
  let planAssumedRowCount = 0
  let planUnrecognised = 0
  let malformed = 0
  let skipped = 0
  let unreadableBillable = 0
  let duplicates = 0
  let impossibleVolume = 0

  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter)

    // A row wider than its neighbours has an unquoted delimiter inside a value —
    // a thousands separator in a CSV, or a comma in a table name like "Palo
    // Alto, Fortinet". Every column after it is then read from the wrong place.
    // The delimiter is sniffed from the first five lines only, so a row further
    // down can do this without the sniff noticing, and the result was billable
    // volume understated fivefold with no warning at all. Short rows fall
    // through to the missing-name and missing-volume checks below.
    if (cells.length > modalWidth) { malformed++; continue }

    const tableName = cells[index.tableName]?.trim()
    if (!tableName) { skipped++; continue }

    // Volume: prefer the billable figure; fall back to total when only that is present.
    const billableMb = index.billableMb !== undefined ? parseNumber(cells[index.billableMb] ?? '') : null
    const billableGbDirect = index.billableGb !== undefined ? parseNumber(cells[index.billableGb] ?? '') : null
    const totalMb = index.totalMb !== undefined ? parseNumber(cells[index.totalMb] ?? '') : null
    const totalGbDirect = index.totalGb !== undefined ? parseNumber(cells[index.totalGb] ?? '') : null

    const billableGb = billableGbDirect ?? (billableMb !== null ? billableMb / MB_PER_GB_BILLING : null)
    const totalGb = totalGbDirect ?? (totalMb !== null ? totalMb / MB_PER_GB_BILLING : null)

    // A row with no readable volume at all is a parse failure, not a zero.
    if (billableGb === null && totalGb === null) { skipped++; continue }

    // Falling back to the total is only sound when the paste has NO billable
    // column. When the column is there but this cell will not read — blank,
    // "null", whitespace, negative — the billable figure is unknown, and
    // treating unknown as "all of it" charges the customer for volume that may
    // not be billable and then recommends a move that saves nothing. Unknown is
    // not zero either, so the row is dropped and counted rather than guessed.
    if (hasBillableColumn && billableGb === null) { unreadableBillable++; continue }

    const resolvedBillable = billableGb ?? totalGb ?? 0
    const resolvedTotal = totalGb ?? billableGb ?? 0

    // Billable above total is arithmetically impossible and means the columns
    // are transposed or misaligned. Silently believing it inflates the bill.
    if (resolvedBillable > resolvedTotal + 1e-9) { impossibleVolume++ }

    // Two different situations, previously counted as one and reported with a
    // message that named the wrong cause. A missing column is expected on
    // pre-May-2026 workspaces; an unrecognised VALUE means the column is there
    // and we could not read it, which is a different problem with a different
    // fix. Both default to Analytics — the only plan commitment tiers apply to,
    // so the assumption cannot understate a tier — but they are now told apart.
    let plan: TablePlan
    if (index.plan === undefined) {
      plan = 'Analytics'
      planAssumedRowCount++
    } else {
      const matched = normalisePlan(cells[index.plan])
      plan = matched ?? 'Analytics'
      if (matched === null) planUnrecognised++
    }

    if (seen.has(tableName + plan)) { duplicates++; continue }
    seen.add(tableName + plan)

    rows.push({
      tableName,
      plan,
      billableGb: resolvedBillable,
      totalGb: resolvedTotal,
      billableGbPerDay: resolvedBillable / lookbackDays,
      totalGbPerDay: resolvedTotal / lookbackDays,
      isFree: resolvedTotal > 0 && resolvedBillable === 0,
    })
  }

  if (rows.length === 0) {
    // Naming the actual cause matters here: "no usable rows" sends someone
    // hunting for a formatting problem when the real one is a column of blank
    // billable figures, which is what an empty sumif() produces.
    throw new UsageParseError(
      unreadableBillable > 0
        ? 'Every row had an unreadable billable volume.'
        : 'Found the headings but no usable rows.',
      unreadableBillable > 0
        ? 'The BillableMB column is present but empty. That happens when the query returns no '
          + 'billable rows, or when a spreadsheet round-trip has blanked the column. Re-run the '
          + 'query and copy the results directly.'
        : 'Check the results are not empty and that numbers are plain — no currency symbols.',
    )
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} could not be read and were ignored.`)
  }
  if (unreadableBillable > 0) {
    warnings.push(
      `${unreadableBillable} row${unreadableBillable === 1 ? ' had an' : 's had'} unreadable billable `
      + `volume and ${unreadableBillable === 1 ? 'was' : 'were'} excluded. Your real spend is higher `
      + 'than shown. Re-copy the results including every column.',
    )
  }
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} duplicate table and plan row${duplicates === 1 ? '' : 's'} ignored. If the paste `
      + 'was doubled this is correct; if your query splits a table by another column, the excluded '
      + 'volume is missing from these figures.',
    )
  }
  if (impossibleVolume > 0) {
    warnings.push(
      `${impossibleVolume} row${impossibleVolume === 1 ? ' reports' : 's report'} more billable than `
      + 'total volume, which is not possible — check the columns are the right way round. The spend '
      + 'and savings shown for those rows are higher than they should be.',
    )
  }
  if (planAssumedRowCount > 0) {
    warnings.push(
      `${planAssumedRowCount} row${planAssumedRowCount === 1 ? '' : 's'} had no Plan column and were `
      + 'treated as Analytics. Include Plan in the query for an accurate commitment tier.',
    )
  }
  if (planUnrecognised > 0) {
    warnings.push(
      `${planUnrecognised} row${planUnrecognised === 1 ? '' : 's'} had a Plan value we do not `
      + `recognise and ${planUnrecognised === 1 ? 'was' : 'were'} counted as Analytics. Basic and `
      + 'Auxiliary volume counted as Analytics is priced too high and inflates the commitment tier, '
      + 'which only covers Analytics volume.',
    )
  }
  if (malformed > 0) {
    warnings.push(
      `${malformed} row${malformed === 1 ? '' : 's'} had more columns than the heading and `
      + `${malformed === 1 ? 'was' : 'were'} excluded — usually an unquoted comma inside a number or `
      + 'a table name. Your real spend may be higher than shown. Exporting to CSV from the portal '
      + 'quotes those values properly.',
    )
  }
  if (modalWidth > firstCells.length) {
    warnings.push(
      `Your rows carry ${modalWidth - firstCells.length} more column${modalWidth - firstCells.length === 1 ? '' : 's'} `
      + 'than the heading row names. The named columns were read normally and the extra ones ignored, '
      + 'but check the heading row copied across in full.',
    )
  }
  if (!hasBillableColumn) {
    warnings.push(
      'No billable volume column was found, so every row is counted as fully billable. Free tables '
      + 'will look like spend. Include BillableMB in the query for accurate figures.',
    )
  }

  const sum = (f: (r: UsageRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const planSum = (p: TablePlan) =>
    rows.filter(r => r.plan === p).reduce((a, r) => a + r.billableGbPerDay, 0)

  rows.sort((a, b) => b.billableGbPerDay - a.billableGbPerDay)

  return {
    rows,
    lookbackDays,
    totalBillableGbPerDay: sum(r => r.billableGbPerDay),
    totalGbPerDay: sum(r => r.totalGbPerDay),
    analyticsBillableGbPerDay: planSum('Analytics'),
    basicBillableGbPerDay: planSum('Basic'),
    auxiliaryBillableGbPerDay: planSum('Auxiliary'),
    planAssumedRowCount,
    warnings,
  }
}
