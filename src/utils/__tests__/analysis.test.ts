// @vitest-environment node
/**
 * These pin the rules that would otherwise produce confidently wrong advice:
 * sizing a commitment tier against volume it does not cover, guessing at a
 * shared table's contents, or quietly dropping volume we cannot classify.
 */

import { describe, it, expect } from 'vitest'

import { analyseUsage } from '../analysis'
import { parseUsagePaste } from '../usageParser'
import { matchTable, ambiguousTables, indexedTableCount, isAlwaysFreeTable } from '../../data/tableIndex'
import { STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../../data/pricing'

const analyse = (paste: string) => analyseUsage(parseUsagePaste(paste, 31))

describe('table reverse index', () => {
  it('indexes the mapped Sentinel tables', () => {
    expect(indexedTableCount()).toBeGreaterThan(40)
  })

  it('resolves a table to its source and recommendation', () => {
    const m = matchTable('SigninLogs')!
    expect(m.sourceIds).toContain('entra-id')
    expect(m.recommendation).toBe('analytics')
  })

  it('is case-insensitive, since pasted casing varies', () => {
    expect(matchTable('signinlogs')).not.toBeNull()
    expect(matchTable('  SIGNINLOGS  ')).not.toBeNull()
  })

  it('returns null for a table it does not know', () => {
    expect(matchTable('MyCustomApp_CL')).toBeNull()
    expect(matchTable('Perf')).toBeNull()
  })

  it('excludes the {TableName}_CL documentation placeholder', () => {
    expect(matchTable('{TableName}_CL')).toBeNull()
  })

  it('resolves shared tables silently when every claimant agrees', () => {
    // CommonSecurityLog carries CEF from firewalls, VPN and email gateways —
    // genuinely many-to-one, but all three point at Data Lake.
    const m = matchTable('CommonSecurityLog')!
    expect(m.sourceIds.length).toBeGreaterThan(1)
    expect(m.ambiguousButAgreed).toBe(true)
    expect(m.needsUserInput).toBe(false)
    expect(m.recommendation).toBe('data-lake')
  })

  it('refuses to recommend when claimants disagree', () => {
    // AzureDiagnostics is a catch-all: Key Vault says Analytics, WAF says Data
    // Lake. The table name genuinely cannot tell you which.
    const m = matchTable('AzureDiagnostics')!
    expect(m.needsUserInput).toBe(true)
    expect(m.recommendation).toBeNull()
  })

  it('has at least one genuinely conflicting table, so the path is exercised', () => {
    expect(ambiguousTables().some(m => m.needsUserInput)).toBe(true)
  })

  it('knows the tables Microsoft never charges for', () => {
    expect(isAlwaysFreeTable('AzureActivity')).toBe(true)
    expect(isAlwaysFreeTable('OfficeActivity')).toBe(true)
    expect(isAlwaysFreeTable('SecurityIncident')).toBe(true)
    expect(isAlwaysFreeTable('SecurityEvent')).toBe(false)
  })
})

describe('commitment tiers apply only to Analytics volume', () => {
  it('excludes Basic and Auxiliary volume from tier sizing', () => {
    // Analytics 60 GB/day, plus a large Basic table that gets no tier discount.
    const paste = [
      'TableName\tPlan\tBillableMB',
      `SecurityEvent\tAnalytics\t${60 * 1000 * 31}`,
      `ContainerLogV2\tBasic\t${500 * 1000 * 31}`,
    ].join('\n')

    const r = analyse(paste)
    const tierOpp = r.opportunities.find(o => o.kind === 'commitment-tier')

    // Sized on 60 GB/day, not 560. Had it used the combined figure it would
    // recommend a far larger tier and promise a saving that cannot exist.
    expect(tierOpp?.detail).toMatch(/60\.0 GB\/day/)
    expect(tierOpp?.detail).not.toMatch(/560/)
  })

  it('prices Basic volume at the flat Basic rate, not the Analytics rate', () => {
    const paste = `TableName\tPlan\tBillableMB\nContainerLogV2\tBasic\t${10 * 1000 * 31}`
    const r = analyse(paste)
    const expected = 10 * STATIC_PRICING_BUNDLE.basicLogsRateUsd * DAYS_PER_MONTH
    expect(r.basicMonthlyUsd).toBeCloseTo(expected, 0)
    // The Analytics rate would be roughly fivefold.
    expect(r.basicMonthlyUsd).toBeLessThan(10 * STATIC_PRICING_BUNDLE.paygRateUsd * DAYS_PER_MONTH)
  })

  it('prices Auxiliary volume at the flat Auxiliary rate', () => {
    const paste = `TableName\tPlan\tBillableMB\nSyslog\tAuxiliary\t${10 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.auxiliaryMonthlyUsd)
      .toBeCloseTo(10 * STATIC_PRICING_BUNDLE.auxiliaryLogsRateUsd * DAYS_PER_MONTH, 0)
  })
})

describe('tier placement savings', () => {
  it('costs moving an investigative table to the Data Lake tier', () => {
    const paste = `TableName\tPlan\tBillableMB\nCommonSecurityLog\tAnalytics\t${40 * 1000 * 31}`
    const r = analyse(paste)
    const opp = r.opportunities.find(o => o.kind === 'tier-placement')!
    const expected =
      40 * (STATIC_PRICING_BUNDLE.paygRateUsd - STATIC_PRICING_BUNDLE.dataLakeRateUsd) * DAYS_PER_MONTH
    expect(opp.monthlySavingUsd).toBeCloseTo(expected, 0)
    expect(opp.tables).toContain('CommonSecurityLog')
  })

  it('leaves detection-critical tables on Analytics', () => {
    const paste = `TableName\tPlan\tBillableMB\nSigninLogs\tAnalytics\t${10 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.opportunities.find(o => o.kind === 'tier-placement')).toBeUndefined()
    expect(r.tables[0].status).toBe('ok')
  })

  it('does not suggest moving a table that is already on a cheaper plan', () => {
    const paste = `TableName\tPlan\tBillableMB\nCommonSecurityLog\tAuxiliary\t${40 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.opportunities.find(o => o.kind === 'tier-placement')).toBeUndefined()
  })

  it('warns that moving reduces query capability', () => {
    const paste = `TableName\tPlan\tBillableMB\nDnsEvents\tAnalytics\t${20 * 1000 * 31}`
    const opp = analyse(paste).opportunities.find(o => o.kind === 'tier-placement')!
    expect(opp.detail).toMatch(/slower|limited/i)
  })
})

describe('misconfiguration detection', () => {
  it('flags a free table that is being billed, and recovers the whole cost', () => {
    const paste = `TableName\tPlan\tBillableMB\nOfficeActivity\tAnalytics\t${6 * 1000 * 31}`
    const r = analyse(paste)
    const opp = r.opportunities.find(o => o.kind === 'billed-but-free')!
    expect(opp.tables).toContain('OfficeActivity')
    // Nothing should be paid for this at all, so the saving is the full cost.
    expect(opp.monthlySavingUsd).toBeCloseTo(r.tables[0].monthlyCostUsd, 2)
  })

  it('does not flag a free table that is correctly costing nothing', () => {
    const paste = 'TableName\tPlan\tTotalMB\tBillableMB\nOfficeActivity\tAnalytics\t190000\t0'
    const r = analyse(paste)
    expect(r.opportunities.find(o => o.kind === 'billed-but-free')).toBeUndefined()
  })
})

describe('honesty about what it cannot advise on', () => {
  it('reports unclassified tables with their cost rather than dropping them', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `SecurityEvent\tAnalytics\t${10 * 1000 * 31}`,
      `Perf\tAnalytics\t${20 * 1000 * 31}`,
      `MyApp_CL\tAnalytics\t${5 * 1000 * 31}`,
    ].join('\n')

    const r = analyse(paste)
    expect(r.unclassifiedTableCount).toBe(2)
    expect(r.unclassifiedGbPerDay).toBeCloseTo(25, 1)
    expect(r.unclassifiedMonthlyUsd).toBeGreaterThan(0)
    // Still counted in the current spend — only excluded from advice.
    expect(r.currentMonthlyUsd).toBeGreaterThan(r.unclassifiedMonthlyUsd)
  })

  it('asks about a conflicting table instead of guessing', () => {
    const paste = `TableName\tPlan\tBillableMB\nAzureDiagnostics\tAnalytics\t${30 * 1000 * 31}`
    const r = analyse(paste)
    const opp = r.opportunities.find(o => o.kind === 'needs-input')!
    expect(opp.needsUserInput).toBe(true)
    // Claims no saving it cannot substantiate.
    expect(opp.monthlySavingUsd).toBe(0)
    expect(r.needsInputGbPerDay).toBeCloseTo(30, 1)
    expect(r.tables[0].status).toBe('needs-input')
  })

  it('excludes unsubstantiated items from the headline saving', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `CommonSecurityLog\tAnalytics\t${40 * 1000 * 31}`,
      `AzureDiagnostics\tAnalytics\t${30 * 1000 * 31}`,
    ].join('\n')

    const r = analyse(paste)
    // The needs-input item contributes nothing it cannot substantiate.
    expect(r.opportunities.find(o => o.kind === 'needs-input')!.monthlySavingUsd).toBe(0)
    const substantiated = r.opportunities
      .filter(o => !o.needsUserInput)
      .reduce((a, o) => a + o.monthlySavingUsd, 0)
    expect(r.totalAddressableSavingUsd).toBeCloseTo(substantiated, 2)
  })
})

describe('opportunities do not double-count the same gigabytes', () => {
  // Moving tables to the Data Lake reduces Analytics volume, which changes the
  // commitment tier worth buying. Summing both savings against today's volume
  // would count the moved gigabytes twice — the same error as crediting a
  // licence grant against a tier already sized net of it.

  it('sizes the commitment tier on the volume that remains after moves', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `CommonSecurityLog\tAnalytics\t${400 * 1000 * 31}`,  // moves to lake
      `SecurityEvent\tAnalytics\t${150 * 1000 * 31}`,      // stays
    ].join('\n')

    const r = analyse(paste)
    expect(r.analyticsGbPerDayAfterMoves).toBeCloseTo(150, 1)

    const tier = r.opportunities.find(o => o.kind === 'commitment-tier')
    if (tier) {
      // Sized on 150, not the 550 they ingest today.
      expect(tier.detail).toMatch(/150\.0 GB\/day/)
      expect(tier.detail).toMatch(/down from 550\.0/)
    }
  })

  it('never claims a saving larger than the current spend', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `CommonSecurityLog\tAnalytics\t${400 * 1000 * 31}`,
      `DnsEvents\tAnalytics\t${200 * 1000 * 31}`,
      `OfficeActivity\tAnalytics\t${10 * 1000 * 31}`,
      `SecurityEvent\tAnalytics\t${150 * 1000 * 31}`,
    ].join('\n')

    const r = analyse(paste)
    // The clearest expression of the invariant: you cannot save more than you spend.
    expect(r.totalAddressableSavingUsd).toBeLessThanOrEqual(r.currentMonthlyUsd)
    expect(r.totalAddressableSavingUsd).toBeGreaterThan(0)
  })

  it('drops the tier recommendation entirely when moves take volume below breakeven', () => {
    // 60 GB/day today, but nearly all of it is movable. Afterwards there is not
    // enough left for any tier to beat pay-as-you-go.
    const paste = [
      'TableName\tPlan\tBillableMB',
      `CommonSecurityLog\tAnalytics\t${58 * 1000 * 31}`,
      `SigninLogs\tAnalytics\t${2 * 1000 * 31}`,
    ].join('\n')

    const r = analyse(paste)
    expect(r.analyticsGbPerDayAfterMoves).toBeCloseTo(2, 1)
    expect(r.opportunities.find(o => o.kind === 'commitment-tier')).toBeUndefined()
  })
})

describe('ranking and totals', () => {
  it('orders opportunities by saving, largest first', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `CommonSecurityLog\tAnalytics\t${120 * 1000 * 31}`,
      `OfficeActivity\tAnalytics\t${2 * 1000 * 31}`,
    ].join('\n')
    const savings = analyse(paste).opportunities.map(o => o.monthlySavingUsd)
    expect(savings).toEqual([...savings].sort((a, b) => b - a))
  })

  it('current spend is the sum of every table, classified or not', () => {
    const paste = [
      'TableName\tPlan\tBillableMB',
      `SecurityEvent\tAnalytics\t${10 * 1000 * 31}`,
      `Perf\tAnalytics\t${10 * 1000 * 31}`,
    ].join('\n')
    const r = analyse(paste)
    expect(r.currentMonthlyUsd).toBeCloseTo(
      r.tables.reduce((a, t) => a + t.monthlyCostUsd, 0), 2,
    )
  })

  it('produces no opportunities and no crash for a tidy workspace', () => {
    const paste = `TableName\tPlan\tBillableMB\nSigninLogs\tAnalytics\t${1 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.totalAddressableSavingUsd).toBe(0)
    expect(Number.isFinite(r.currentMonthlyUsd)).toBe(true)
  })
})
