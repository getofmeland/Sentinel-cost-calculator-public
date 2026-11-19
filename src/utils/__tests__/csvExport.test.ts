// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { buildEstimateCsv, csvField, toCsv } from '../csvExport'
import type { IngestionSummary } from '../ingestion'
import { DAYS_PER_MONTH } from '../../data/pricing'

describe('csvField', () => {
  it('leaves an ordinary value untouched', () => {
    expect(csvField('Entra ID')).toBe('Entra ID')
    expect(csvField(42)).toBe('42')
  })

  it('quotes a value containing a comma', () => {
    expect(csvField('Palo Alto, Fortinet')).toBe('"Palo Alto, Fortinet"')
  })

  it('doubles embedded quotes', () => {
    expect(csvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('quotes a value containing a newline', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('neutralises a leading = so spreadsheets do not execute it', () => {
    // A CSV that runs a formula when opened is a poor thing to email a client.
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    )
  })

  it('neutralises the other formula-trigger prefixes', () => {
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1+1')).toBe("'-1+1")
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('does not mangle a negative number written as a number', () => {
    // Numbers arrive already formatted by the caller; only strings are guarded.
    expect(csvField(-12.5)).toBe("'-12.5")
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF, as RFC 4180 expects', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('renders an empty row as a blank line for visual spacing', () => {
    expect(toCsv([['a'], [], ['b']])).toBe('a\r\n\r\nb')
  })
})

const summary = {
  rows: [{
    source: { id: 'entra-id', label: 'Entra ID', isFree: false },
    gbPerDay: 10,
    logTier: 'analytics',
    dailyCostUsd: 53.8,
    retentionDays: 90,
    retentionMonthlyCostUsd: 0,
  }],
  totalGbPerDay: 10,
  freeGbPerDay: 0,
  analyticsGbPerDay: 10,
  dataLakeGbPerDay: 0,
} as unknown as IngestionSummary

describe('buildEstimateCsv', () => {
  const base = {
    summary,
    currency: 'USD' as const,
    fxRate: 1,
    paygMonthlyUsd: 100,
    withSavingsMonthlyUsd: 80,
    optimisedMonthlyUsd: 70,
    recommendedTierLabel: '100 GB/day',
    userCount: 500,
    region: 'UK South',
  }

  it('labels a classic estimate with its commitment tier', () => {
    const csv = buildEstimateCsv(base)
    expect(csv).toContain('Commitment tier (100 GB/day)')
    expect(csv).not.toContain('Defender ISOC')
  })

  it('prices Analytics rows at the ISOC rate and does not call that total a commitment tier', () => {
    const csv = buildEstimateCsv({
      ...base,
      analyticsBilling: 'defender-isoc',
      defenderIsocRateUsd: 2.88,
      optimisedMonthlyUsd: 10 * 2.88 * DAYS_PER_MONTH,
    })
    expect(csv).toContain('Defender ISOC (flat, licence grants not applied)')
    expect(csv).not.toContain('Commitment tier')
    expect(csv).toContain((10 * 2.88 * DAYS_PER_MONTH).toFixed(2))
  })
})
