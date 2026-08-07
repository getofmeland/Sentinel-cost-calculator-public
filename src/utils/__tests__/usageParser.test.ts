// @vitest-environment node
/**
 * The byte-level shape of a portal export is undocumented — Microsoft says which
 * menu item to click and nothing more. So these tests exercise the messy shapes
 * a real paste can take rather than one idealised format, and check that
 * anything ambiguous is rejected rather than guessed at.
 */

import { describe, it, expect } from 'vitest'

import {
  parseUsagePaste,
  splitDelimited,
  sniffDelimiter,
  parseNumber,
  UsageParseError,
} from '../usageParser'
import { MB_PER_GB_BILLING } from '../../data/usageQuery'

// Tab-separated with headers — the typical clipboard copy.
const TSV = [
  'TableName\tPlan\tTotalMB\tBillableMB',
  'CommonSecurityLog\tAnalytics\t1240000\t1240000',
  'SecurityEvent\tAnalytics\t890000\t890000',
  'OfficeActivity\tAnalytics\t190000\t0',
  'ContainerLogV2\tBasic\t450000\t450000',
].join('\n')

// Comma-separated, fully quoted, BOM-prefixed, CRLF — the typical CSV export.
const CSV = '\uFEFF' + [
  '"TableName","Plan","TotalMB","BillableMB"',
  '"CommonSecurityLog","Analytics","1240000","1240000"',
  '"SecurityEvent","Analytics","890000","890000"',
].join('\r\n')

describe('the billing divisor', () => {
  it('is 1000, not 1024 — Azure bills in GB of 10^9 bytes', () => {
    // Microsoft's own Usage sample page ships /1024 in two places. Using it
    // overstates volume by 2.4%, enough to pick the wrong commitment tier.
    expect(MB_PER_GB_BILLING).toBe(1000)
  })

  it('converts megabytes using that divisor', () => {
    const r = parseUsagePaste(TSV, 31)
    const cs = r.rows.find(x => x.tableName === 'CommonSecurityLog')!
    expect(cs.billableGb).toBeCloseTo(1240000 / 1000, 5)
    // The 1024 reading would give 1210.9 — measurably different.
    expect(cs.billableGb).not.toBeCloseTo(1240000 / 1024, 1)
  })
})

describe('format sniffing', () => {
  it('reads tab-separated clipboard output', () => {
    expect(parseUsagePaste(TSV).rows).toHaveLength(4)
  })

  it('reads quoted, BOM-prefixed, CRLF CSV export', () => {
    const r = parseUsagePaste(CSV)
    expect(r.rows).toHaveLength(2)
    // A surviving BOM would corrupt the first column name.
    expect(r.rows.map(x => x.tableName)).toContain('CommonSecurityLog')
  })

  it('sniffs the delimiter rather than assuming one', () => {
    expect(sniffDelimiter(['a\tb\tc', 'd\te\tf'])).toBe('\t')
    expect(sniffDelimiter(['a,b,c', 'd,e,f'])).toBe(',')
    expect(sniffDelimiter(['a;b;c', 'd;e;f'])).toBe(';')
  })

  it('honours RFC 4180 doubled quotes', () => {
    expect(splitDelimited('"a","say ""hi""","c"', ',')).toEqual(['a', 'say "hi"', 'c'])
  })

  it('keeps a delimiter that appears inside a quoted field', () => {
    expect(splitDelimited('"Palo Alto, Fortinet","x"', ',')).toEqual(['Palo Alto, Fortinet', 'x'])
  })
})

describe('number handling', () => {
  it('strips thousands separators the grid may have added', () => {
    expect(parseNumber('1,240,000')).toBe(1240000)
  })

  it('accepts exponential notation', () => {
    expect(parseNumber('1.24E6')).toBeCloseTo(1240000, 0)
  })

  it('rejects negatives and non-numbers rather than coercing them', () => {
    expect(parseNumber('-5')).toBeNull()
    expect(parseNumber('n/a')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
})

describe('table plans', () => {
  it('separates Analytics from Basic, since commitment tiers apply only to Analytics', () => {
    const r = parseUsagePaste(TSV, 31)
    // Feeding the combined total to tier selection would be wrong: Basic and
    // Auxiliary are billed at flat rates and get no tier discount.
    expect(r.analyticsBillableGbPerDay).toBeCloseTo((1240000 + 890000 + 0) / 1000 / 31, 4)
    expect(r.basicBillableGbPerDay).toBeCloseTo(450000 / 1000 / 31, 4)
    expect(r.analyticsBillableGbPerDay).not.toBeCloseTo(r.totalBillableGbPerDay, 2)
  })

  it('recognises the Auxiliary plan under its newer "Lake" labelling', () => {
    const paste = 'TableName\tPlan\tBillableMB\nSyslog\tAuxiliary / Lake\t1000'
    expect(parseUsagePaste(paste).rows[0].plan).toBe('Auxiliary')
  })

  it('assumes Analytics when Plan is missing, and says so', () => {
    // Rows before mid-May 2026 have no Plan column at all.
    const paste = 'TableName\tBillableMB\nSecurityEvent\t890000'
    const r = parseUsagePaste(paste)
    expect(r.rows[0].plan).toBe('Analytics')
    expect(r.planAssumedRowCount).toBe(1)
    expect(r.warnings.join(' ')).toMatch(/no Plan column/i)
  })
})

describe('free versus billable', () => {
  it('flags a table reporting volume with nothing billable', () => {
    const r = parseUsagePaste(TSV, 31)
    expect(r.rows.find(x => x.tableName === 'OfficeActivity')!.isFree).toBe(true)
    expect(r.rows.find(x => x.tableName === 'SecurityEvent')!.isFree).toBe(false)
  })

  it('keeps total and billable separate so the free split is visible', () => {
    const r = parseUsagePaste(TSV, 31)
    expect(r.totalGbPerDay).toBeGreaterThan(r.totalBillableGbPerDay)
  })
})

describe('rejects bad input loudly', () => {
  it('rejects an empty paste', () => {
    expect(() => parseUsagePaste('')).toThrow(UsageParseError)
    expect(() => parseUsagePaste('   \n  ')).toThrow(UsageParseError)
  })

  it('rejects a paste with no recognisable headings', () => {
    // Without headers we cannot know which column is which — guessing here
    // would silently produce wrong costs.
    expect(() => parseUsagePaste('foo\tbar\nbaz\tqux')).toThrow(/column headings/i)
  })

  it('rejects results that have a table name but no volume column', () => {
    expect(() => parseUsagePaste('TableName\tPlan\nSecurityEvent\tAnalytics'))
      .toThrow(/volume column/i)
  })

  it('rejects a volume column with no table name', () => {
    expect(() => parseUsagePaste('BillableMB\tTotalMB\n100\t200')).toThrow(UsageParseError)
  })

  it('rejects raw log records rather than trying to summarise them', () => {
    const huge = ['TableName\tBillableMB', ...Array.from({ length: 6000 }, (_, i) => `T${i}\t1`)].join('\n')
    expect(() => parseUsagePaste(huge)).toThrow(/more than this expects/i)
  })

  it('carries a hint explaining how to fix the input', () => {
    try {
      parseUsagePaste('nonsense')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UsageParseError)
      expect((e as UsageParseError).hint).toBeTruthy()
    }
  })
})

describe('tolerates real-world mess', () => {
  it('accepts DataType as the table column, as Microsoft samples emit', () => {
    const paste = 'DataType\tBillableMB\nSigninLogs\t310000'
    expect(parseUsagePaste(paste).rows[0].tableName).toBe('SigninLogs')
  })

  it('accepts GB columns when the user kept the divisor in their query', () => {
    const paste = 'TableName\tBillableGB\nSigninLogs\t310'
    expect(parseUsagePaste(paste).rows[0].billableGb).toBeCloseTo(310, 5)
  })

  it('ignores blank lines and trailing whitespace', () => {
    const messy = '\n\nTableName\tBillableMB   \n\nSecurityEvent\t890000\n\n\n'
    expect(parseUsagePaste(messy).rows).toHaveLength(1)
  })

  it('skips unreadable rows and reports how many', () => {
    const paste = 'TableName\tBillableMB\nGood\t100\nBad\tn/a\n\tOrphan'
    const r = parseUsagePaste(paste)
    expect(r.rows).toHaveLength(1)
    expect(r.warnings.join(' ')).toMatch(/could not be read/i)
  })

  it('de-duplicates a table repeated within the same plan', () => {
    const paste = 'TableName\tPlan\tBillableMB\nSecurityEvent\tAnalytics\t100\nSecurityEvent\tAnalytics\t100'
    expect(parseUsagePaste(paste).rows).toHaveLength(1)
  })

  it('orders rows by billable volume, biggest cost drivers first', () => {
    const r = parseUsagePaste(TSV)
    const vols = r.rows.map(x => x.billableGbPerDay)
    expect(vols).toEqual([...vols].sort((a, b) => b - a))
  })

  it('divides by the lookback window to get a daily rate', () => {
    const r = parseUsagePaste('TableName\tBillableMB\nX\t31000', 31)
    expect(r.rows[0].billableGbPerDay).toBeCloseTo(1, 5)
  })
})
