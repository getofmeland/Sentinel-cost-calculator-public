import {
  UsageParseError, sniffDelimiter, splitDelimited, parseNumber, matchPlan,
  type TablePlan,
} from './usageParser'
import { MB_PER_GB_BILLING } from '../data/usageQuery'

/**
 * Parser for the optional per-day volume query.
 *
 * Separate from the per-table parser because the two inputs fail differently
 * and a shared "smart" parser would guess. Pasting one into the other's box is
 * the mistake people will actually make, so each says which is which.
 */

export interface DailyVolumeRow {
  /** ISO date as the query formats it, kept as a string — no timezone to get wrong */
  day: string
  plan: TablePlan
  billableGb: number
}

export interface ParsedDailyVolume {
  rows: DailyVolumeRow[]
  /** Analytics-plan GB for each observed day, ascending. The tier sizing input. */
  analyticsGbByDay: number[]
  dayCount: number
  warnings: string[]
}

const MAX_ROWS = 2000

export function parseDailyVolumePaste(input: string): ParsedDailyVolume {
  if (!input || !input.trim()) {
    throw new UsageParseError('Nothing to read.', 'Paste the results of the daily volume query.')
  }

  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '')
  if (lines.length > MAX_ROWS) {
    throw new UsageParseError(
      `That is ${lines.length.toLocaleString()} rows, which is far more than a month of days.`,
      'This box wants the daily volume query, not the per-table one.',
    )
  }

  const delimiter = sniffDelimiter(lines)
  const header = splitDelimited(lines[0], delimiter).map(c => c.trim().toLowerCase())

  const dayIdx = header.findIndex(h => h === 'day' || h === 'date' || h === 'starttime' || h === 'timegenerated')
  const planIdx = header.findIndex(h => h === 'plan')
  const volIdx = header.findIndex(h => h === 'billablemb' || h === 'billablegb' || h === 'mb' || h === 'gb')
  const volIsGb = volIdx >= 0 && header[volIdx].endsWith('gb')

  if (dayIdx < 0 || volIdx < 0) {
    throw new UsageParseError(
      'This does not look like the daily volume results.',
      'Expected a Day column and a BillableMB column. If you pasted the per-table results, they '
      + 'belong in the box above.',
    )
  }

  const warnings: string[] = []
  const rows: DailyVolumeRow[] = []
  // Same day and plan can legitimately appear once only; a duplicate means the
  // paste was doubled, which would silently double the volume for that day.
  const seen = new Set<string>()
  let duplicates = 0
  let unreadable = 0
  let planAssumed = 0

  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter)
    const day = cells[dayIdx]?.trim()
    if (!day) { unreadable++; continue }

    // parseNumber already rejects negatives and non-finite values.
    const raw = parseNumber(cells[volIdx] ?? '')
    if (raw === null) { unreadable++; continue }

    // Which days survive is the entire signal this feature reads, so a row lost
    // here is not cosmetic — it changes the recommended tier. Counted, never
    // dropped in silence.
    const matched = planIdx >= 0 ? matchPlan(cells[planIdx]) : null
    if (planIdx >= 0 && matched === null) planAssumed++
    const plan = matched ?? 'Analytics'
    const key = `${day}|${plan}`
    if (seen.has(key)) { duplicates++; continue }
    seen.add(key)

    rows.push({ day, plan, billableGb: volIsGb ? raw : raw / MB_PER_GB_BILLING })
  }

  if (rows.length === 0) {
    throw new UsageParseError(
      'No daily rows could be read.',
      'Copy the results including the header row.',
    )
  }
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} duplicate day/plan row${duplicates === 1 ? '' : 's'} ignored — the paste looks doubled.`,
    )
  }
  if (unreadable > 0) {
    warnings.push(
      `${unreadable} row${unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'was' : 'were'} `
      + 'ignored. Tier sizing reads the shape of these days, so missing days change the answer.',
    )
  }
  if (planAssumed > 0) {
    warnings.push(
      `${planAssumed} row${planAssumed === 1 ? '' : 's'} had an unrecognised Plan value and `
      + `${planAssumed === 1 ? 'was' : 'were'} counted as Analytics, which can push the recommended `
      + 'tier higher than it should be.',
    )
  }

  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.plan !== 'Analytics') continue
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.billableGb)
  }
  const analyticsGbByDay = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e[1])

  if (analyticsGbByDay.length < 7) {
    warnings.push(
      `Only ${analyticsGbByDay.length} day${analyticsGbByDay.length === 1 ? '' : 's'} of Analytics `
      + 'volume found. Tier sizing needs a fuller month to be worth trusting.',
    )
  }

  return { rows, analyticsGbByDay, dayCount: analyticsGbByDay.length, warnings }
}
