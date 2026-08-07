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
 * Numbers may arrive with thousands separators, currency-style grouping, or
 * exponential notation depending on how the grid formatted them. A comma
 * decimal separator inside a comma-delimited file is unresolvable, so a value
 * that does not parse cleanly is rejected rather than guessed at.
 */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s ]/g, '').replace(/,/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : null
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

  // Strip a UTF-8 BOM, which CSV exports commonly carry, and normalise endings.
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
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

  const warnings: string[] = []
  const rows: UsageRow[] = []
  const seen = new Set<string>()
  let planAssumedRowCount = 0
  let skipped = 0

  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter)
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

    const resolvedBillable = billableGb ?? totalGb ?? 0
    const resolvedTotal = totalGb ?? billableGb ?? 0

    let plan = index.plan !== undefined ? normalisePlan(cells[index.plan]) : null
    if (plan === null) {
      // Pre-May-2026 rows have no Plan, and a user may have dropped the column.
      // Analytics is the safe assumption: it is the only plan commitment tiers
      // apply to, so assuming it cannot understate the tier recommendation.
      plan = 'Analytics'
      planAssumedRowCount++
    }

    if (seen.has(tableName + plan)) { skipped++; continue }
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
    throw new UsageParseError(
      'Found the headings but no usable rows.',
      'Check the results are not empty and that numbers are plain — no currency symbols.',
    )
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} could not be read and were ignored.`)
  }
  if (planAssumedRowCount > 0) {
    warnings.push(
      `${planAssumedRowCount} row${planAssumedRowCount === 1 ? '' : 's'} had no Plan column and were `
      + 'treated as Analytics. Include Plan in the query for an accurate commitment tier.',
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
