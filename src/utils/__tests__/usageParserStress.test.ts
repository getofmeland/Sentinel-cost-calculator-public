// @vitest-environment node
/**
 * Adversarial stress tests for the paste parser.
 *
 * The parser has been run against real Azure exports only a handful of times,
 * with small data. Everything here is a shape a real clipboard copy or CSV
 * export can genuinely take: portal quirks, locale formatting, columns the user
 * moved or removed, and outright hostile input.
 *
 * These began as fourteen `it.fails` cases documenting live defects. All are now
 * fixed and every test asserts real behaviour; the ones named "FIXED" keep the
 * original input and a note on the wrong number it used to produce, so the
 * regression cover is legible as history rather than just as assertions.
 *
 * Two root causes produced every serious finding:
 *
 *   1. A value the parser could not read was treated as ABSENT rather than as an
 *      ERROR, so `billableGb ?? totalGb` quietly substituted total volume for
 *      billable volume. An empty BillableMB cell — which `sumif()` produces for
 *      any table with no billable rows, so every workspace has them — was billed
 *      at full volume and then offered back as a saving.
 *   2. No row was ever checked against the header's column count, so an unquoted
 *      comma inside a number or a table name shifted every later cell one place
 *      left, silently, whenever it fell outside the five-line sniff window.
 *
 * Both directions of error are now named in the warning text, because "your real
 * spend is higher than shown" and "higher than it should be" send a reader to
 * very different places.
 */

import { describe, it, expect } from 'vitest'

import {
  parseUsagePaste,
  splitDelimited,
  sniffDelimiter,
  parseNumber,
  UsageParseError,
} from '../usageParser'
import { analyseUsage } from '../analysis'
import { USAGE_QUERY } from '../../data/usageQuery'

/** The shape the documented query actually emits. */
const header = 'TableName\tPlan\tTotalMB\tBillableMB'
const tsv = (...rows: string[]) => [header, ...rows].join('\n')

const row = (r: ReturnType<typeof parseUsagePaste>, name: string) =>
  r.rows.find(x => x.tableName === name)!

// ─────────────────────────────────────────────────────────────────────────────
// 1. Portal quirks
// ─────────────────────────────────────────────────────────────────────────────

describe('portal quirks: delimiters, line endings, BOM, whitespace', () => {
  it('reads a tab-separated clipboard copy', () => {
    const r = parseUsagePaste(tsv('SecurityEvent\tAnalytics\t1000\t1000'), 31)
    expect(r.rows).toHaveLength(1)
    expect(row(r, 'SecurityEvent').billableGb).toBe(1)
  })

  it('reads a quoted, BOM-prefixed, CRLF CSV export with trailing blank lines', () => {
    const csv = '﻿' + [
      '"TableName","Plan","TotalMB","BillableMB"',
      '"SecurityEvent","Analytics","1000","1000"',
      '"Syslog","Basic","500","500"',
      '', '', '',
    ].join('\r\n')
    const r = parseUsagePaste(csv, 31)
    expect(r.rows).toHaveLength(2)
    // A surviving BOM would corrupt the first heading and lose the table column.
    expect(row(r, 'SecurityEvent').billableGb).toBe(1)
    expect(r.basicBillableGbPerDay).toBeCloseTo(0.5 / 31, 6)
  })

  it('reads a lone-CR (classic Mac / some clipboard paths) export', () => {
    const r = parseUsagePaste(header + '\rA\tAnalytics\t1000\t1000\r', 31)
    expect(r.rows).toHaveLength(1)
  })

  it('reads a semicolon-delimited European Excel CSV', () => {
    const r = parseUsagePaste('TableName;Plan;TotalMB;BillableMB\nA;Analytics;1000;1000', 31)
    expect(row(r, 'A').billableGb).toBe(1)
  })

  it('tolerates a trailing delimiter on every line', () => {
    const r = parseUsagePaste(header + '\t\nA\tAnalytics\t1000\t1000\t', 31)
    expect(row(r, 'A').billableGb).toBe(1)
  })

  it('strips non-breaking and thin spaces used as digit grouping', () => {
    // The grid renders 1 240 000 with U+00A0 between groups.
    const r = parseUsagePaste(tsv('A\tAnalytics\t1 240 000\t1 240 000'), 31)
    expect(row(r, 'A').billableGb).toBe(1240)
    expect(parseNumber('1 234.5')).toBe(1234.5)
  })

  it('handles thousands separators when the CSV quotes them, as RFC 4180 requires', () => {
    const r = parseUsagePaste(
      'TableName,Plan,TotalMB,BillableMB\n"A","Analytics","1,234.5","1,234.5"', 31)
    expect(row(r, 'A').billableGb).toBeCloseTo(1.2345, 6)
  })

  it('rejects an UNQUOTED thousands separator when it lands inside the sniff window', () => {
    // Header has 4 comma-fields, the row has 6, so no delimiter is consistent and
    // the sniffer falls back to tab, which finds no headings. Confusing message,
    // but it is an error rather than a wrong number — the acceptable outcome.
    expect(() => parseUsagePaste(
      'TableName,Plan,TotalMB,BillableMB\nA,Analytics,1,234.5,1,234.5', 31))
      .toThrow(/column headings/i)
  })

  /**
   * DEFECT 1 (HIGH — silently wrong numbers).
   *
   * The delimiter is sniffed from the first five lines only, and no row is ever
   * checked against the header's column count. A CSV row whose numbers carry
   * unquoted thousands separators — the genuine comma ambiguity — therefore
   * shifts every later cell one place left with no warning at all.
   *
   * Input:   ...,SecurityEvent,Analytics,1,234.5,1,234.5   (row 6 of the paste)
   * Cells:   ['SecurityEvent','Analytics','1','234.5','1','234.5']
   * Gives:   totalGb 0.001, billableGb 0.2345
   * Truth:   totalGb 1.2345, billableGb 1.2345    — understated 5x, and total 1234x
   *
   * Correct behaviour: reject any row whose field count differs from the header
   * (or re-sniff across the whole paste). Throwing here is fine; guessing is not.
   */
  it('FIXED: a row with more fields than the header is excluded, not read from the wrong columns', () => {
    const r = parseUsagePaste([
      'TableName,Plan,TotalMB,BillableMB',
      'A,Analytics,1000,1000',
      'B,Analytics,1000,1000',
      'C,Analytics,1000,1000',
      'D,Analytics,1000,1000',
      'SecurityEvent,Analytics,1,234.5,1,234.5',
    ].join('\n'), 31)
    // Recovery is impossible in principle: "1,234.5" in a comma-delimited row
    // is genuinely indistinguishable from two fields. Rejecting is the only
    // honest option, and the warning says which way the error runs.
    expect(r.rows.map(x => x.tableName)).not.toContain('SecurityEvent')
    expect(r.warnings.some(w => /more columns than the heading/i.test(w))).toBe(true)
    expect(r.warnings.some(w => /real spend may be higher/i.test(w))).toBe(true)
  })

  /**
   * DEFECT 1b (MEDIUM — silently wrong, same root cause).
   *
   * Same missing arity check, different trigger: an unquoted comma inside a table
   * name past the sniff window.
   *
   * Input:  Palo Alto, Fortinet,Analytics,900,900   (row 6)
   * Gives:  tableName 'Palo Alto', and a warning claiming the Plan column was
   *         missing when it was present — the plan cell read ' Fortinet'.
   * Truth:  tableName 'Palo Alto, Fortinet', plan Analytics, no warning.
   *
   * A truncated table name also silently defeats catalogue matching downstream,
   * so the table lands in "unclassified" with no explanation.
   */
  it('FIXED: an unquoted comma in a table name excludes the row rather than truncating it', () => {
    const r = parseUsagePaste([
      'TableName,Plan,TotalMB,BillableMB',
      'A,Analytics,100,100', 'B,Analytics,100,100',
      'C,Analytics,100,100', 'D,Analytics,100,100',
      'Palo Alto, Fortinet,Analytics,900,900',
    ].join('\n'), 31)
    // Previously this landed as 'Palo Alto' with a warning falsely blaming a
    // missing Plan column, and the truncated name then silently failed to match
    // the catalogue downstream.
    expect(r.rows.map(x => x.tableName)).not.toContain('Palo Alto')
    expect(r.planAssumedRowCount).toBe(0)
    expect(r.warnings.some(w => /more columns than the heading/i.test(w))).toBe(true)
  })

  it('sniffs the delimiter rather than assuming, and prefers tab on a tie', () => {
    expect(sniffDelimiter(['a\tb\tc', 'd\te\tf'])).toBe('\t')
    expect(sniffDelimiter(['a,b,c', 'd,e,f'])).toBe(',')
    expect(sniffDelimiter(['a;b;c', 'd;e;f'])).toBe(';')
    expect(sniffDelimiter(['a|b|c', 'd|e|f'])).toBe('|')
    // Ragged lines: nothing is consistent, so it falls back to tab and lets the
    // header check produce the error.
    expect(sniffDelimiter(['a,b,c,d', 'e,f,1,2,3'])).toBe('\t')
  })

  it('keeps a delimiter inside a quoted field and honours doubled quotes', () => {
    expect(splitDelimited('"Palo Alto, Fortinet","x"', ',')).toEqual(['Palo Alto, Fortinet', 'x'])
    expect(splitDelimited('"a","say ""hi""","c"', ',')).toEqual(['a', 'say "hi"', 'c'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Numeric edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('numeric edge cases', () => {
  it('treats a genuine zero as zero, not as missing', () => {
    // The distinction that makes isFree work: 0 must not fall through to total.
    const r = parseUsagePaste(tsv('Free\tAnalytics\t1000\t0', 'Paid\tAnalytics\t1000\t1000'), 31)
    expect(row(r, 'Free').billableGb).toBe(0)
    expect(row(r, 'Free').isFree).toBe(true)
    expect(row(r, 'Paid').isFree).toBe(false)
  })

  it('reads scientific notation, which Azure emits for large aggregates', () => {
    expect(parseNumber('1.23E+05')).toBe(123000)
    expect(parseNumber('1.23e+05')).toBe(123000)
    expect(parseNumber('1.23E-05')).toBeCloseTo(0.0000123, 12)
    const r = parseUsagePaste(tsv('A\tAnalytics\t1.23E+05\t1.23E+05'), 31)
    expect(row(r, 'A').billableGb).toBe(123)
  })

  it('rejects an unreadable number rather than coercing it to zero', () => {
    expect(parseNumber('n/a')).toBeNull()
    expect(parseNumber('null')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber(' ')).toBeNull()
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('-5')).toBeNull()
    expect(parseNumber('1e400')).toBeNull() // overflows to Infinity
    expect(parseNumber('100 MB')).toBeNull()
  })

  it('drops a row whose only volume column is unreadable, and counts it', () => {
    const r = parseUsagePaste('TableName\tPlan\tTotalMB\nA\tAnalytics\t-5\nB\tAnalytics\t10', 31)
    expect(r.rows.map(x => x.tableName)).toEqual(['B'])
    expect(r.warnings.join(' ')).toMatch(/could not be read/i)
  })

  it('accepts an absurdly large but finite value without producing NaN', () => {
    const r = parseUsagePaste(tsv('A\tAnalytics\t1e308\t1e308'), 31)
    expect(Number.isFinite(r.totalBillableGbPerDay)).toBe(true)
    expect(r.totalBillableGbPerDay).toBeGreaterThan(0)
  })

  /**
   * DEFECT 2 (CRITICAL — silently wrong numbers, over-states cost).
   *
   * An EMPTY BillableMB cell is treated as "column absent" and falls back to
   * TotalMB, so a table with nothing billable is reported as 100% billable.
   *
   * This is not hypothetical. The shipped query uses
   *   BillableMB = round(sumif(Quantity, tostring(IsBillable) =~ "true"), 1)
   * and a Kusto aggregate over no matching rows yields null, which the grid
   * renders as an empty cell and the CSV export as an empty (or "null") field.
   * Every workspace has such tables — AzureActivity, SecurityAlert, free
   * connector data. Any CSV round-trip through Excel can also blank a cell.
   *
   * Input:  AzureActivity  Analytics  190000  <empty>
   * Gives:  billableGb 190, isFree false, warnings []
   *         — and $1,003.73/month of phantom cost downstream (see the last describe)
   * Truth:  billableGb 0,   isFree true
   *
   * Correct behaviour: an unreadable/blank cell in a column that IS present must
   * either drop the row with the existing "could not be read" warning, or be
   * treated as zero — never as "use the total instead". Note the fallback is
   * only defensible when the whole column is missing (see DEFECT 5).
   */
  it('FIXED: an empty BillableMB cell drops the row and warns, rather than billing the total', () => {
    // The row is no longer billed at its total. Here it was the only row, so
    // the parse fails outright — and the message names the real cause rather
    // than sending someone hunting for a formatting problem.
    expect(() => parseUsagePaste(tsv('AzureActivity\tAnalytics\t190000\t'), 31))
      .toThrow(/unreadable billable volume/i)
  })

  /** DEFECT 2b — same defect via the literal string "null" that some exports emit. */
  it('FIXED: a "null" BillableMB cell drops the row rather than billing the total', () => {
    expect(() => parseUsagePaste(tsv('AzureActivity\tAnalytics\t190000\tnull'), 31))
      .toThrow(/unreadable billable volume/i)
  })

  /** DEFECT 2c — same defect via a whitespace-only cell, and with no warning raised. */
  it('FIXED: a whitespace-only BillableMB cell drops the row rather than billing the total', () => {
    expect(() => parseUsagePaste(tsv('A\tAnalytics\t190000\t   '), 31))
      .toThrow(/unreadable billable volume/i)
  })

  /**
   * DEFECT 3 (HIGH — silently wrong numbers).
   *
   * A negative BillableMB (which should never occur, but is exactly the sort of
   * thing a hand-edited query or a spreadsheet round-trip produces) is rejected
   * by parseNumber, then silently replaced by TotalMB by the `??` fallback.
   *
   * Input:  A  Analytics  1000  -5
   * Gives:  billableGb 1 (i.e. the total), no warning at all
   * Truth:  the row is not trustworthy — drop it and say so.
   */
  it('FIXED: a negative BillableMB drops the row and says so', () => {
    expect(() => parseUsagePaste(tsv('A\tAnalytics\t1000\t-5'), 31))
      .toThrow(/unreadable billable volume/i)
  })

  /**
   * DEFECT 4 (HIGH — silently wrong numbers, up to 1000x).
   *
   * parseNumber strips every comma unconditionally, so a decimal comma from a
   * European locale is read as a thousands separator. Its own doc comment claims
   * such values are "rejected rather than guessed at" — they are not. This tool
   * ships an EUR currency option, so European locales are explicitly in scope,
   * and in a TAB-separated paste there is no delimiter ambiguity to save us:
   * the number simply arrives wrong.
   *
   * '1234,5'   → 12345    (10x over)
   * '1.234,5'  → 1.2345   (1000x under)
   */
  it('FIXED: a decimal comma is rejected rather than read as a thousands separator', () => {
    // Was 12345 — a tenfold overstatement of a cost, silently.
    expect(parseNumber('1234,5')).toBeNull()
  })

  it('FIXED: European 1.234,5 grouping is rejected rather than read as 1.2345', () => {
    // Was 1.2345 — a thousandfold understatement.
    expect(parseNumber('1.234,5')).toBeNull()
  })

  /**
   * DEFECT 4b (LOW — silently wrong, but implausible input).
   * Number() accepts JavaScript numeric literals, so hex/octal/binary text is
   * accepted as a volume. '0x10' → 16 rather than being rejected as non-numeric.
   */
  it('FIXED: JavaScript numeric literals are not volumes', () => {
    // Number('0x10') is 16. Accepting it means accepting 0b, 0o and Infinity too.
    expect(parseNumber('0x10')).toBeNull()
    expect(parseNumber('0b11')).toBeNull()
    expect(parseNumber('Infinity')).toBeNull()
    // The forms that must still work.
    expect(parseNumber('1,234.5')).toBeCloseTo(1234.5, 6)
    expect(parseNumber('1.23E+05')).toBeCloseTo(123000, 6)
    expect(parseNumber('0')).toBe(0)
  })

  /**
   * DEFECT 4c (LOW — silently wrong, direction unclear).
   * BillableMB greater than TotalMB is arithmetically impossible, and is kept
   * without comment. It leaves totalGbPerDay below billableGbPerDay, so any
   * downstream "free volume = total − billable" reads negative.
   */
  it('FIXED: billable exceeding total is kept but flagged as impossible', () => {
    // The row is retained — the figures may still be roughly right and dropping
    // them would understate spend — but the contradiction is named, because
    // transposed columns are the usual cause and silence would hide it.
    const r = parseUsagePaste(tsv('A\tAnalytics\t100\t120'), 31)
    expect(r.warnings.some(w => /more billable than total/i.test(w))).toBe(true)
  })

  it('divides by the lookback window, and refuses a zero window', () => {
    expect(parseUsagePaste('TableName\tBillableMB\nX\t31000', 31).rows[0].billableGbPerDay)
      .toBeCloseTo(1, 6)
    // Not reachable from the UI, which always takes the 31-day default, but the
    // parameter is exported. A zero lookback used to yield Infinity, which then
    // propagates through every cost in the report as a plausible-looking figure.
    expect(() => parseUsagePaste('TableName\tBillableMB\nX\t31000', 0))
      .toThrow(/positive number of days/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Column variance
// ─────────────────────────────────────────────────────────────────────────────

describe('column variance', () => {
  it('reads columns in any order, ignoring extra ones the user added', () => {
    const r = parseUsagePaste([
      'BillableMB\tSolution\tPlan\tTotalMB\tTableName',
      '100\tSecurityInsights\tAnalytics\t200\tSecurityEvent',
    ].join('\n'), 31)
    const t = row(r, 'SecurityEvent')
    expect(t.billableGb).toBeCloseTo(0.1, 9)
    expect(t.totalGb).toBeCloseTo(0.2, 9)
  })

  it('accepts DataType, and GB columns when the user kept the divisor in their query', () => {
    expect(parseUsagePaste('DataType\tBillableMB\nSigninLogs\t310000', 31).rows[0].tableName)
      .toBe('SigninLogs')
    expect(parseUsagePaste('TableName\tBillableGB\nSigninLogs\t310', 31).rows[0].billableGb)
      .toBe(310)
  })

  it('takes the leftmost column when two headings map to the same field', () => {
    // Documents the tie-break. A user query that happens to project a `Name`
    // column wins over the real TableName, which is a trap worth knowing about.
    const r = parseUsagePaste('Name\tTableName\tBillableMB\nsomething-else\tSecurityEvent\t100', 31)
    expect(r.rows[0].tableName).toBe('something-else')
    expect(parseUsagePaste('TableName\tBillableMB\tBillableMB\nA\t100\t999', 31).rows[0].billableGb)
      .toBeCloseTo(0.1, 9)
  })

  it('treats a missing Plan column as Analytics and says so — the pre-May-2026 case', () => {
    // Workspaces older than mid-May 2026 have no Plan column in Usage at all.
    // Analytics is the safe assumption for tier sizing.
    const r = parseUsagePaste('TableName\tTotalMB\tBillableMB\nSecurityEvent\t1000\t1000', 31)
    expect(r.rows[0].plan).toBe('Analytics')
    expect(r.planAssumedRowCount).toBe(1)
    expect(r.warnings.join(' ')).toMatch(/no Plan column/i)
    expect(r.analyticsBillableGbPerDay).toBeCloseTo(1 / 31, 9)
  })

  it('keeps the same table name under two different plans as two rows', () => {
    const r = parseUsagePaste([
      'TableName\tPlan\tBillableMB',
      'SecurityEvent\tAnalytics\t100',
      'SecurityEvent\tBasic\t120',
    ].join('\n'), 31)
    expect(r.rows).toHaveLength(2)
    expect(r.analyticsBillableGbPerDay).toBeCloseTo(0.1 / 31, 9)
    expect(r.basicBillableGbPerDay).toBeCloseTo(0.12 / 31, 9)
  })

  it('skips a row that is shorter than the header, and counts it', () => {
    const r = parseUsagePaste(tsv('A\tAnalytics', 'B\tAnalytics\t100\t100'), 31)
    expect(r.rows.map(x => x.tableName)).toEqual(['B'])
    expect(r.warnings.join(' ')).toMatch(/could not be read/i)
  })

  it('skips a header row repeated mid-paste (two pages copied)', () => {
    const r = parseUsagePaste([header, 'A\tAnalytics\t100\t100', header, 'B\tAnalytics\t100\t100']
      .join('\n'), 31)
    expect(r.rows).toHaveLength(2)
  })

  it('rejects headings it cannot map, rather than positionally guessing', () => {
    // The Defender grid's display names ("Total (MB)") do not normalise to an
    // alias, so this is an error rather than a wrong number. Good.
    expect(() => parseUsagePaste(
      'Table name\tTable plan\tTotal (MB)\tBillable (MB)\nA\tAnalytics\t100\t100', 31))
      .toThrow(/volume column/i)
  })

  /**
   * DEFECT 5 (MEDIUM — silently wrong numbers, over-states cost).
   *
   * When the BillableMB column is missing entirely — a user who trimmed the
   * query, or an older sample that only projected TotalMB — every table is
   * treated as 100% billable and NOT ONE WARNING is raised. Compare the missing
   * Plan column, which does warn. Every workspace has free ingestion, so this
   * silently over-states billable volume and the commitment tier sized from it.
   *
   * Input:  TableName Plan TotalMB / AzureActivity Analytics 190000
   * Gives:  billableGb 190, isFree false, warnings []
   * Truth:  the same fallback is defensible, but it must be declared, exactly as
   *         the Plan assumption is.
   */
  it('FIXED: a missing BillableMB column still bills the total, but says so', () => {
    // The fallback itself is defensible — without the column there is nothing
    // better to do. The silence was not: free tables looked like spend.
    const r = parseUsagePaste('TableName\tPlan\tTotalMB\nAzureActivity\tAnalytics\t190000', 31)
    expect(r.rows[0].billableGb).toBe(190)
    expect(r.warnings.some(w => /no billable volume column/i.test(w))).toBe(true)
    expect(r.warnings.some(w => /free tables will look like spend/i.test(w))).toBe(true)
  })

  /**
   * DEFECT 6 (MEDIUM — silently wrong numbers, under-states volume ~31x).
   *
   * De-duplication keys on tableName+plan and DROPS later duplicates instead of
   * summing them. A user who groups by day as well as table — a natural edit,
   * and what Microsoft's own daily-trend samples do — keeps only the first day
   * and discards the other thirty. The warning that fires says the rows "could
   * not be read", which points the user at formatting rather than at grouping.
   *
   * Input:  three rows for SecurityEvent/Analytics of 100, 120, 90 MB
   * Gives:  billableGb 0.1 and "2 rows could not be read and were ignored."
   * Truth:  0.31 GB (summed), or a warning that names duplicate grouping.
   */
  it('PARTLY FIXED: duplicates still discarded, but the warning now names the cause', () => {
    const r = parseUsagePaste([
      'TableName\tPlan\tBillableMB',
      'SecurityEvent\tAnalytics\t100',
      'SecurityEvent\tAnalytics\t120',
      'SecurityEvent\tAnalytics\t90',
    ].join('\n'), 31)
    // Still not summed: a doubled paste and a legitimately grouped query are
    // indistinguishable here, and summing a doubled paste would overstate spend.
    // The warning now names duplicate grouping rather than blaming formatting.
    expect(r.rows[0].billableGb).toBeCloseTo(0.1, 9)
    expect(r.warnings.some(w => /duplicate table and plan/i.test(w))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plan values
// ─────────────────────────────────────────────────────────────────────────────

describe('plan values', () => {
  it('normalises casing, the "Auxiliary / Lake" relabel, and bare "Lake"', () => {
    const r = parseUsagePaste([
      'TableName\tPlan\tBillableMB',
      'A\tanalytics\t100',
      'B\tBASIC\t100',
      'C\tAuxiliary / Lake\t100',
      'D\tLake\t100',
      'E\tAuxiliary\t100',
    ].join('\n'), 31)
    expect(r.rows.map(x => [x.tableName, x.plan]).sort()).toEqual([
      ['A', 'Analytics'], ['B', 'Basic'], ['C', 'Auxiliary'], ['D', 'Auxiliary'], ['E', 'Auxiliary'],
    ].sort())
    expect(r.planAssumedRowCount).toBe(0)
    // Commitment tiers apply only to the Analytics slice.
    expect(r.analyticsBillableGbPerDay).toBeCloseTo(0.1 / 31, 9)
    expect(r.auxiliaryBillableGbPerDay).toBeCloseTo(0.3 / 31, 9)
  })

  /**
   * DEFECT 7 (MEDIUM-HIGH — silently wrong classification, over-states the tier).
   *
   * Any plan value the parser does not recognise — "Basic Logs" (Microsoft's own
   * prose name for the plan), "Standard", a blank cell, a future label — is
   * silently reclassified as Analytics and counted in planAssumedRowCount. The
   * user is then told "N rows had no Plan column", which is false: the column was
   * there and had a value. Basic/Auxiliary volume priced and tier-sized as
   * Analytics breaks the rule that tiers apply only to Analytics volume.
   *
   * Input:  B  Basic Logs  100  /  C  Standard  100  /  D  <blank>  100
   * Gives:  all three Analytics; warning "3 rows had no Plan column"
   * Truth:  reject or quarantine the unrecognised value, and word the warning to
   *         distinguish "column absent" from "value not understood".
   */
  it('FIXED: an unrecognised Plan value is reported as such, not as a missing column', () => {
    const r = parseUsagePaste([
      'TableName\tPlan\tBillableMB',
      'B\tBasic Logs\t100',
      'C\tStandard\t100',
      'D\t\t100',
    ].join('\n'), 31)
    // All three rows have a Plan column with a value we cannot read. Blaming a
    // missing column sent the user to fix the wrong thing.
    expect(r.warnings.join(' ')).not.toMatch(/no Plan column/i)
    expect(r.warnings.some(w => /Plan value we do not recognise/i.test(w))).toBe(true)
    // And it names the consequence: tiers only cover Analytics volume.
    expect(r.warnings.some(w => /inflates the commitment tier/i.test(w))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Scale
// ─────────────────────────────────────────────────────────────────────────────

describe('scale', () => {
  const manyTables = (n: number) => [header,
    ...Array.from({ length: n }, (_, i) => `T${i}\tAnalytics\t${(i + 1) * 100}\t${(i + 1) * 100}`),
  ].join('\n')

  it('parses a 450-table workspace exactly, with no drift or NaN', () => {
    const r = parseUsagePaste(manyTables(450), 31)
    expect(r.rows).toHaveLength(450)
    // Sum of 100..45000 MB = 450*451/2 * 100 MB = 10,147,500 MB
    expect(r.totalBillableGbPerDay).toBeCloseTo(10147.5 / 31, 6)
    expect(Number.isNaN(r.totalBillableGbPerDay)).toBe(false)
  })

  it('parses right up to the 5,000-line cap quickly', () => {
    const started = Date.now()
    const r = parseUsagePaste(manyTables(4999), 31)
    expect(r.rows).toHaveLength(4999)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('refuses a paste over the cap rather than hanging on it', () => {
    expect(() => parseUsagePaste(manyTables(5000), 31)).toThrow(/more than this expects/i)
    const tenThousand = ['TableName\tBillableMB',
      ...Array.from({ length: 10000 }, (_, i) => `T${i}\t1`)].join('\n')
    expect(() => parseUsagePaste(tenThousand, 31)).toThrow(UsageParseError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Hostile input
// ─────────────────────────────────────────────────────────────────────────────

describe('hostile input throws a clear error with a hint', () => {
  const throwsWithHint = (input: string, message: RegExp) => {
    try {
      parseUsagePaste(input, 31)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UsageParseError)
      expect((e as UsageParseError).message).toMatch(message)
      expect((e as UsageParseError).hint).toBeTruthy()
    }
  }

  it('rejects empty and whitespace-only input', () => {
    throwsWithHint('', /nothing to read/i)
    throwsWithHint('   \n \r\n\t\n', /nothing to read/i)
    throwsWithHint('﻿', /nothing to read/i)
  })

  it('rejects the KQL query text pasted instead of its results', () => {
    throwsWithHint(USAGE_QUERY, /column headings/i)
    // A fragment of it names real columns but no table column.
    throwsWithHint('| project TableName, Plan, TotalMB, BillableMB', /table-name column/i)
  })

  it('rejects a pasted portal error message', () => {
    throwsWithHint("Failed to resolve table or column expression named 'Usage'", /column headings/i)
    throwsWithHint('ago(): argument #1 was not of an expected data type: timespan',
      /column headings/i)
  })

  it('rejects a selection copied without the header row', () => {
    throwsWithHint('SecurityEvent\tAnalytics\t1000\t1000\nSyslog\tAnalytics\t500\t500',
      /column headings/i)
  })

  it('rejects a header row with no data under it', () => {
    throwsWithHint(header, /no usable rows/i)
    throwsWithHint(header + '\n \t \t \t ', /no usable rows/i)
  })

  it('rejects results with a table column but no volume column', () => {
    throwsWithHint('TableName\tPlan\nSecurityEvent\tAnalytics', /volume column/i)
  })

  it('rejects volume with no table name', () => {
    throwsWithHint('BillableMB\tTotalMB\n100\t200', /table-name column/i)
  })

  it('rejects a single-column paste, though the message blames the headings', () => {
    // Only one heading is recognised, and two are needed to call it a header row,
    // so the user is told the headings are missing rather than the volume column.
    // Imprecise, but an error rather than a wrong number.
    throwsWithHint('TableName\nSecurityEvent', /column headings/i)
  })

  it('keeps a literal "null" table name rather than inventing a table', () => {
    const r = parseUsagePaste('TableName\tPlan\tBillableMB\nnull\tAnalytics\t100', 31)
    expect(r.rows[0].tableName).toBe('null')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. What the silent defects cost downstream
// ─────────────────────────────────────────────────────────────────────────────

describe('a blank cell among good rows warns instead of failing', () => {
  it('keeps the readable rows, drops the unreadable one, and says spend is understated', () => {
    const r = parseUsagePaste([
      'TableName\tPlan\tTotalMB\tBillableMB',
      'SecurityEvent\tAnalytics\t310000\t310000',
      'AzureActivity\tAnalytics\t190000\t',
    ].join('\n'), 31)
    expect(r.rows.map(x => x.tableName)).toEqual(['SecurityEvent'])
    expect(r.warnings.some(w => /unreadable billable volume/i.test(w))).toBe(true)
    expect(r.warnings.some(w => /real spend is higher/i.test(w))).toBe(true)
  })
})

describe('downstream impact of the silent defects', () => {
  it('prices a correctly-parsed free table at nothing and claims no saving', () => {
    const a = analyseUsage(parseUsagePaste(tsv('AzureActivity\tAnalytics\t190000\t0'), 31))
    const t = a.tables.find(x => x.tableName === 'AzureActivity')!
    expect(t.monthlyCostUsd).toBe(0)
    expect(t.potentialSavingUsd).toBe(0)
  })

  /**
   * DEFECT 2, monetised. With the billable cell blank, AzureActivity — a table
   * Microsoft never charges for — is read as 190 GB of billable Analytics volume.
   * The engine then sees billable volume on an always-free table, labels it
   * 'should-be-free' and offers its entire cost back as a saving: $1,003.73 a
   * month of current spend and $1,003.73 of "addressable saving", both invented
   * from a blank cell. This is precisely the confidently wrong savings advice
   * CLAUDE.md forbids.
   */
  it('FIXED: a blank billable cell no longer fabricates a costed savings recommendation', () => {
    // Previously this produced ~$1,004/mo of spend and an identical
    // "addressable saving", both invented from one blank cell. The parse now
    // refuses rather than fabricating a costed recommendation.
    expect(() => analyseUsage(parseUsagePaste(tsv('AzureActivity\tAnalytics\t190000\t'), 31)))
      .toThrow(/unreadable billable volume/i)
  })
})

describe('a header narrower than its data rows', () => {
  // Regression. The arity check originally compared each row against the HEADER
  // width, so a heading row missing a column — an Excel round-trip that adds an
  // unnamed column, or a heading that did not copy across in full — made every
  // row overshoot at once. All of them were dropped and the parse then failed
  // with "Found the headings but no usable rows", which sent the reader looking
  // for empty results or currency symbols. Comparing against the modal data
  // width instead isolates rows that disagree with their neighbours, which is
  // the only case the check was ever meant to catch.

  const shortHeader = [
    'TableName\tPlan\tTotalMB',
    'A\tAnalytics\t1000\t1000',
    'B\tAnalytics\t2000\t2000',
    'C\tAnalytics\t3000\t3000',
  ].join('\n')

  it('reads every row rather than condemning the whole paste', () => {
    const r = parseUsagePaste(shortHeader, 31)
    // Rows come back ordered by volume, so compare as a set.
    expect(r.rows.map(x => x.tableName).sort()).toEqual(['A', 'B', 'C'])
  })

  it('reads the named columns correctly, since leading columns still align', () => {
    const r = parseUsagePaste(shortHeader, 31)
    expect(row(r, 'B').totalGb).toBe(2)
  })

  it('says the heading row is short rather than staying silent', () => {
    const r = parseUsagePaste(shortHeader, 31)
    expect(r.warnings.some(w => /more column/i.test(w) && /heading/i.test(w))).toBe(true)
  })

  it('still excludes a single row that disagrees with its neighbours', () => {
    // The narrower case the check exists for: most rows agree, one does not.
    const r = parseUsagePaste([
      'TableName,Plan,TotalMB,BillableMB',
      'A,Analytics,1000,1000',
      'B,Analytics,1000,1000',
      'C,Analytics,1000,1000',
      'D,Analytics,1000,1000',
      'SecurityEvent,Analytics,1,234.5,1,234.5',
    ].join('\n'), 31)
    expect(r.rows.map(x => x.tableName).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(r.warnings.some(w => /more columns than the heading/i.test(w))).toBe(true)
  })
})

describe('numeric forms deliberately rejected, and why', () => {
  // Called out in review as the stricter-than-necessary edge of the grammar.
  // Neither form is one Azure emits: Kusto aggregates and round() always render
  // a leading digit, and Excel normalises a typed ".5" to "0.5" on commit. They
  // stay rejected so the grammar has one rule rather than a special case — but
  // pinned here so the decision is deliberate and visible if a real export ever
  // produces one, because a false rejection now DROPS the row.
  it('rejects a bare leading or trailing decimal point', () => {
    expect(parseNumber('.5')).toBeNull()
    expect(parseNumber('5.')).toBeNull()
    // The forms Azure actually emits for the same values.
    expect(parseNumber('0.5')).toBe(0.5)
    expect(parseNumber('5')).toBe(5)
    expect(parseNumber('5.0')).toBe(5)
  })
})

describe('when corrupted rows are the MAJORITY', () => {
  // The blind spot in judging rows by width alone, found by attacking the fix
  // that replaced the original header-width check. A workspace full of vendor
  // tables with commas in their names — "Palo Alto, Networks" — makes the
  // CORRUPTED width the modal width. Every corrupted row then looks like the
  // norm and sails through, while its columns are read one place left.
  //
  // Before the alignment check: ten corrupted rows accepted, billable volume
  // understated by half, every table name silently truncated at the comma.

  const paste = [
    'TableName,Plan,TotalMB,BillableMB',
    // Five clean rows first, so the sniffer confidently settles on the comma.
    ...Array.from({ length: 5 }, (_, i) => `Clean${i},Analytics,1000,2000`),
    // Ten corrupted rows — now the majority, and the modal width.
    ...Array.from({ length: 10 }, (_, i) => `Vendor${i}, Suite,Analytics,1000,2000`),
  ].join('\n')

  it('excludes the corrupted majority rather than reading them shifted', () => {
    const r = parseUsagePaste(paste, 31)
    expect(r.rows.filter(x => x.tableName.startsWith('Vendor'))).toHaveLength(0)
  })

  it('keeps the clean minority, read correctly', () => {
    const r = parseUsagePaste(paste, 31)
    const clean = r.rows.filter(x => x.tableName.startsWith('Clean'))
    expect(clean).toHaveLength(5)
    expect(clean[0].totalGb).toBe(1)
    expect(clean[0].billableGb).toBe(2)
  })

  it('says volume is missing rather than reporting a confident wrong total', () => {
    const r = parseUsagePaste(paste, 31)
    expect(r.warnings.some(w => /more columns than the heading/i.test(w))).toBe(true)
  })

  it('still accepts a genuinely short header, where the typed cells do align', () => {
    // The case the alignment check must NOT catch: same width mismatch, but
    // every named column parses, so the heading is merely short.
    const r = parseUsagePaste([
      'TableName\tPlan\tTotalMB',
      ...Array.from({ length: 8 }, (_, i) => `T${i}\tAnalytics\t1000\t1000`),
    ].join('\n'), 31)
    expect(r.rows).toHaveLength(8)
    expect(r.rows[0].totalGb).toBe(1)
  })
})
