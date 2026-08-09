// @vitest-environment node
/**
 * Runtime plan-support guards, exercised with deliberately poisoned data.
 *
 * An adversarial review proved these guards were dead code under test: the
 * catalogue tests forbid the very data (a 'basic' or 'data-lake' recommendation
 * on a table that cannot use the plan) that would make the engine-level checks
 * fire, so replacing either check with `true` passed the entire suite. That is
 * the exact failure shape of the sixteen impossible Lake recommendations that
 * shipped — a safety check that reads correct but never actually runs. These
 * tests inject the poisoned TableMatch the real data can no longer produce.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../data/tableIndex', async importOriginal => {
  const real = await importOriginal<typeof import('../../data/tableIndex')>()
  const poisoned = (name: string, recommendation: 'basic' | 'data-lake') => ({
    table: name.toLowerCase(),
    sourceIds: [],
    // The poison: a cheaper-plan recommendation on a table that supports
    // neither cheaper plan. The catalogue can never say this; the engine must
    // still refuse it.
    lakeCapable: false,
    basicCapable: false,
    recommendation,
    category: null,
    caveat: null,
    description: null,
    ambiguousButAgreed: false,
    needsUserInput: false,
    reason: null,
    isFree: false,
    connectors: [],
  })
  // Capable of the cheaper plan, so the plan guard passes and the GRANT guard
  // is the only thing left standing between a granted gigabyte and being
  // offered back as a saving.
  const capable = (name: string, recommendation: 'basic' | 'data-lake') => ({
    ...poisoned(name, recommendation),
    lakeCapable: true,
    basicCapable: true,
  })
  return {
    ...real,
    matchTable: (n: string) => {
      const key = n.trim().toLowerCase()
      if (key === 'poisonedbasictable') return poisoned(n, 'basic')
      if (key === 'poisonedlaketable') return poisoned(n, 'data-lake')
      // SecurityEvent is genuinely P2-eligible, so a server count can cover it.
      if (key === 'securityevent') return capable(n, 'data-lake')
      // DeviceProcessEvents is genuinely E5-eligible.
      if (key === 'deviceprocessevents') return capable(n, 'basic')
      return real.matchTable(n)
    },
  }
})

import { analyseUsage, type LicensingInput } from '../analysis'
import { parseUsagePaste } from '../usageParser'
import { STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../../data/pricing'

const analyse = (paste: string, licensing?: LicensingInput) =>
  analyseUsage(parseUsagePaste(paste, 31), STATIC_PRICING_BUNDLE, undefined, licensing)
const mb = (gbPerDay: number) => gbPerDay * 1000 * 31

describe('engine refuses a recommendation the table cannot follow, even from its own catalogue', () => {
  it('does not offer Basic when basicCapable is false, whatever the recommendation says', () => {
    const paste = `TableName\tPlan\tBillableMB\nPoisonedBasicTable\tAnalytics\t${50 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.tables[0].status).toBe('ok')
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.opportunities.find(o => o.kind === 'basic-plan')).toBeUndefined()
  })

  it('does not offer the Lake tier when lakeCapable is false, whatever the recommendation says', () => {
    const paste = `TableName\tPlan\tBillableMB\nPoisonedLakeTable\tAnalytics\t${50 * 1000 * 31}`
    const r = analyse(paste)
    expect(r.tables[0].status).toBe('ok')
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.opportunities.find(o => o.kind === 'tier-placement')).toBeUndefined()
  })
})

describe('a granted gigabyte is never offered back as a saving', () => {
  // Review proved this guard was dead code: removing `netBillableGbPerDay > 0`
  // from the move-to-lake branch passed all 393 tests, because no grant-eligible
  // table in the real catalogue happens to recommend a cheaper plan. That is a
  // coincidence in the DATA, not a property of the code, and it would evaporate
  // the day someone catalogues a high-volume XDR table as a Lake candidate.
  //
  // So the match is poisoned to claim a cheaper plan IS available, on tables
  // that genuinely qualify for a grant. The plan guard then passes and the
  // grant guard is the only thing left.

  const P2: LicensingInput = {
    licence: 'none', licensedSeats: 0, defenderServersP2Enabled: true, serverCount: 100,
  }
  const E5: LicensingInput = {
    licence: 'e5', licensedSeats: 2000, defenderServersP2Enabled: false, serverCount: 0,
  }

  it('offers no Lake move on volume the P2 grant already covers', () => {
    // 100 servers = 50 GB/day of allowance against 10 GB/day of SecurityEvent.
    const r = analyse(`TableName\tPlan\tBillableMB\nSecurityEvent\tAnalytics\t${mb(10)}`, P2)
    expect(r.tables[0].grantedGbPerDay).toBeCloseTo(10, 2)
    expect(r.tables[0].status).toBe('ok')
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.opportunities.find(o => o.kind === 'tier-placement')).toBeUndefined()
  })

  it('offers no Basic move on volume the E5 grant already covers', () => {
    // 2,000 seats = 10 GB/day of allowance against 4 GB/day of DeviceProcessEvents.
    const r = analyse(`TableName\tPlan\tBillableMB\nDeviceProcessEvents\tAnalytics\t${mb(4)}`, E5)
    expect(r.tables[0].grantedGbPerDay).toBeCloseTo(4, 2)
    expect(r.tables[0].status).toBe('ok')
    expect(r.opportunities.find(o => o.kind === 'basic-plan')).toBeUndefined()
  })

  it('prices a PARTIAL grant on the remainder, not the gross volume', () => {
    // The subtler half. 4 servers = 2 GB/day of allowance against 10 GB/day, so
    // 8 GB/day is still billed and genuinely could move. The saving must be
    // measured on those 8, not on all 10.
    const partial: LicensingInput = { ...P2, serverCount: 4 }
    const r = analyse(`TableName\tPlan\tBillableMB\nSecurityEvent\tAnalytics\t${mb(10)}`, partial)
    expect(r.tables[0].grantedGbPerDay).toBeCloseTo(2, 2)
    expect(r.tables[0].status).toBe('move-to-lake')
    expect(r.tables[0].potentialSavingUsd).toBeCloseTo(
      8 * (STATIC_PRICING_BUNDLE.paygRateUsd - STATIC_PRICING_BUNDLE.dataLakeRateUsd) * DAYS_PER_MONTH,
      0,
    )
  })

  it('still offers the move when no grant applies at all', () => {
    // Guards against the fix being over-broad: without licensing the table is
    // fully billed and the move is real.
    const r = analyse(`TableName\tPlan\tBillableMB\nSecurityEvent\tAnalytics\t${mb(10)}`)
    expect(r.tables[0].grantedGbPerDay).toBe(0)
    expect(r.tables[0].status).toBe('move-to-lake')
    expect(r.tables[0].potentialSavingUsd).toBeGreaterThan(0)
  })
})
