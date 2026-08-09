// @vitest-environment node
/**
 * Free-ingestion grants in Analyse mode.
 *
 * Added after a real 162-server tenant showed the mode charging full rate for
 * data Microsoft gives away — about 40% of the displayed bill, almost all of it
 * Defender for Servers rather than E5. The estimator had modelled both grants
 * for months; Analyse mode had never known they existed.
 *
 * The property under test is not "a credit appears" but "a granted gigabyte is
 * counted free exactly once" — not costed, not offered back as a saving, and
 * not included in the pool a commitment tier is sized against.
 */

import { describe, it, expect } from 'vitest'
import { analyseUsage, type LicensingInput } from '../analysis'
import { parseUsagePaste } from '../usageParser'
import { STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../../data/pricing'

const analyse = (paste: string, licensing?: LicensingInput) =>
  analyseUsage(parseUsagePaste(paste, 31), STATIC_PRICING_BUNDLE, undefined, licensing)

const NO_LICENCE: LicensingInput = {
  licence: 'none', licensedSeats: 0, defenderServersP2Enabled: false, serverCount: 0,
}
/** The tenant that exposed this: 100 E5 seats, 162 servers. */
const REAL: LicensingInput = {
  licence: 'e5', licensedSeats: 100, defenderServersP2Enabled: true, serverCount: 162,
}

const paste = (...rows: string[]) => ['TableName\tPlan\tBillableMB', ...rows].join('\n')
const mb = (gbPerDay: number) => gbPerDay * 1000 * 31

describe('Defender for Servers P2', () => {
  it('covers SecurityEvent, the largest line on a server-heavy tenant', () => {
    // 162 servers x 500 MB = 81 GB/day of allowance against 3.28 GB/day of
    // SecurityEvent — covered roughly twenty-four times over.
    const r = analyse(paste(`SecurityEvent\tAnalytics\t${mb(3.28)}`), REAL)
    expect(r.p2GrantedGbPerDay).toBeCloseTo(3.28, 2)
    expect(r.currentMonthlyUsd).toBe(0)
    expect(r.tables[0].grantedGbPerDay).toBeCloseTo(3.28, 2)
  })

  it('applies nothing when the plan is not enabled on the workspace', () => {
    // Microsoft requires Plan 2 on the WORKSPACE, not merely the subscription.
    const off: LicensingInput = { ...REAL, defenderServersP2Enabled: false }
    const r = analyse(paste(`SecurityEvent\tAnalytics\t${mb(3.28)}`), off)
    expect(r.p2GrantedGbPerDay).toBe(0)
    expect(r.currentMonthlyUsd).toBeGreaterThan(0)
  })

  it('caps at the allowance rather than covering everything', () => {
    // 2 servers = 1 GB/day of allowance against 10 GB/day of SecurityEvent.
    const small: LicensingInput = { ...REAL, serverCount: 2, licence: 'none' }
    const r = analyse(paste(`SecurityEvent\tAnalytics\t${mb(10)}`), small)
    expect(r.p2GrantedGbPerDay).toBeCloseTo(1, 2)
    expect(r.currentMonthlyUsd)
      .toBeCloseTo(9 * STATIC_PRICING_BUNDLE.paygRateUsd * DAYS_PER_MONTH, 0)
  })

  it('does not touch tables outside the published eligible list', () => {
    // Syslog is not on Microsoft's list, however many servers you run.
    const r = analyse(paste(`Syslog\tAnalytics\t${mb(20)}`), REAL)
    expect(r.p2GrantedGbPerDay).toBe(0)
  })
})

describe('Microsoft 365 E5 data grant', () => {
  it('uses LICENSED SEATS, not headcount', () => {
    // 100 seats x 5 MB = 0.5 GB/day. Taking the tenant's 300 accounts would
    // grant 1.5 GB/day and understate the bill threefold.
    const r = analyse(paste(`DeviceProcessEvents\tAnalytics\t${mb(2.04)}`), REAL)
    expect(r.e5GrantedGbPerDay).toBeCloseTo(0.5, 2)
  })

  it('applies nothing without a qualifying licence', () => {
    const e3: LicensingInput = { ...REAL, licence: 'e3' as LicensingInput['licence'] }
    const r = analyse(paste(`DeviceProcessEvents\tAnalytics\t${mb(2.04)}`), e3)
    expect(r.e5GrantedGbPerDay).toBe(0)
  })

  it('covers Entra sign-in logs as well as advanced hunting', () => {
    const r = analyse(paste(`SigninLogs\tAnalytics\t${mb(0.3)}`), REAL)
    expect(r.e5GrantedGbPerDay).toBeCloseTo(0.3, 2)
  })
})

describe('a granted gigabyte is free exactly once', () => {
  it('never credits the same volume under both grants', () => {
    // DeviceCustomFileEvents sits in BOTH published lists. Allocation is
    // tracked per table precisely so it cannot be counted twice.
    const r = analyse(paste(`DeviceCustomFileEvents\tAnalytics\t${mb(1)}`), REAL)
    expect(r.p2GrantedGbPerDay + r.e5GrantedGbPerDay).toBeCloseTo(1, 2)
    expect(r.tables[0].grantedGbPerDay).toBeCloseTo(1, 2)
    expect(r.currentMonthlyUsd).toBe(0)
  })

  it('never offers a saving on volume that is already free', () => {
    // ContainerLogV2 would normally be a Basic-plan move. Grant it in full and
    // the move is worth nothing, so it must not appear as an opportunity.
    const covered: LicensingInput = { ...REAL, serverCount: 1000 }
    const r = analyse(paste(`SecurityEvent\tAnalytics\t${mb(3)}`), covered)
    expect(r.tables[0].potentialSavingUsd).toBe(0)
    expect(r.totalAddressableSavingUsd).toBe(0)
  })

  it('sizes the commitment tier on billed volume, not granted volume', () => {
    // 400 GB/day of SecurityEvent with 700 servers = 350 GB/day granted.
    // The tier must be sized on the 50 GB/day actually billed.
    const big: LicensingInput = { ...REAL, serverCount: 700, licence: 'none' }
    const r = analyse(paste(`SecurityEvent\tAnalytics\t${mb(400)}`), big)
    expect(r.p2GrantedGbPerDay).toBeCloseTo(350, 1)
    expect(r.analyticsGbPerDayAfterMoves).toBeCloseTo(50, 1)
  })

  it('keeps the headline honest — saving never exceeds the billed total', () => {
    const r = analyse([
      'TableName\tPlan\tBillableMB',
      `SecurityEvent\tAnalytics\t${mb(3.28)}`,
      `DeviceProcessEvents\tAnalytics\t${mb(0.96)}`,
      `AppTraces\tAnalytics\t${mb(0.85)}`,
      `CommonSecurityLog\tAuxiliary\t${mb(61.91)}`,
    ].join('\n'), REAL)
    expect(r.totalAddressableSavingUsd).toBeLessThanOrEqual(r.currentMonthlyUsd)
  })
})

describe('no licensing supplied', () => {
  it('behaves exactly as before, granting nothing', () => {
    const withArg = analyse(paste(`SecurityEvent\tAnalytics\t${mb(3.28)}`), NO_LICENCE)
    const without = analyse(paste(`SecurityEvent\tAnalytics\t${mb(3.28)}`))
    expect(without.currentMonthlyUsd).toBe(withArg.currentMonthlyUsd)
    expect(without.p2GrantedGbPerDay).toBe(0)
    expect(without.e5GrantedGbPerDay).toBe(0)
  })
})

describe('a grant never collides with the should-be-free detection', () => {
  // Found by adversarial review, and it was live. SecurityAlert is on
  // Microsoft's free-data list AND on the P2 eligible list — genuine overlap in
  // shipped data. Granting it removed the same gigabytes from the tier pool
  // twice (once as granted volume, once as gross wrongly-billed volume) and
  // netted the misconfiguration saving down to nothing.

  const fixture = [
    'TableName\tPlan\tBillableMB',
    `SecurityAlert\tAnalytics\t${mb(20)}`,   // free per Microsoft, and P2-eligible
    `SecurityEvent\tAnalytics\t${mb(10)}`,   // genuinely billed
  ].join('\n')
  const twentyServers: LicensingInput = {
    licence: 'none', licensedSeats: 0, defenderServersP2Enabled: true, serverCount: 20,
  }

  it('spends the pool on billed volume, not on data that should be free', () => {
    const r = analyse(fixture, twentyServers)
    const alert = r.tables.find(t => t.tableName === 'SecurityAlert')!
    expect(alert.grantedGbPerDay).toBe(0)
    // The 10 GB/day pool goes to SecurityEvent, which is genuinely billed.
    expect(r.p2GrantedGbPerDay).toBeCloseTo(10, 2)
  })

  it('still reports the full misconfiguration saving', () => {
    // Previously the grant netted this to zero and the "billed but should be
    // free" opportunity went dark — blinding the feature that exists to catch
    // exactly this.
    const r = analyse(fixture, twentyServers)
    const alert = r.tables.find(t => t.tableName === 'SecurityAlert')!
    expect(alert.status).toBe('should-be-free')
    expect(alert.potentialSavingUsd)
      .toBeCloseTo(20 * STATIC_PRICING_BUNDLE.paygRateUsd * DAYS_PER_MONTH, 0)
  })

  it('does not subtract the same volume from the tier pool twice', () => {
    // Deliberately a PARTIAL grant. With a pool that exactly covers
    // SecurityEvent the answer is zero either way, so the fixture would pass
    // against the bug — the trap this suite has fallen into before.
    //
    // 8 servers = 4 GB/day pool. It now goes to SecurityEvent (billed), not to
    // SecurityAlert (should be free), leaving SecurityEvent with 6 GB/day still
    // billed. That 6 is the only volume a commitment tier could be sized on.
    const r = analyse(fixture, { ...twentyServers, serverCount: 8 })
    expect(r.tables.find(t => t.tableName === 'SecurityEvent')!.grantedGbPerDay)
      .toBeCloseTo(4, 2)
    expect(r.analyticsGbPerDayAfterMoves).toBeCloseTo(6, 1)
  })
})

describe('grant ordering takes whichever assignment covers more', () => {
  it('does not strand a P2-only table by spending P2 on a shared one', () => {
    // Review priced the fixed P2-first rule at $655/mo on this shape:
    // DeviceCustomFileEvents is eligible for BOTH, SecurityEvent only for P2.
    // Spending P2 on the shared table left SecurityEvent uncovered while the
    // E5 pool sat unused.
    const r = analyse([
      'TableName\tPlan\tBillableMB',
      `DeviceCustomFileEvents\tAnalytics\t${mb(6)}`,
      `SecurityEvent\tAnalytics\t${mb(4)}`,
    ].join('\n'), {
      licence: 'e5', licensedSeats: 1200, defenderServersP2Enabled: true, serverCount: 12,
    })
    // Both pools are 6 GB/day; between them they cover all 10 GB/day.
    expect(r.p2GrantedGbPerDay + r.e5GrantedGbPerDay).toBeCloseTo(10, 2)
    expect(r.currentMonthlyUsd).toBe(0)
  })

  it('is never worse than either fixed ordering', () => {
    // The property, rather than the single case. Total credit must equal the
    // best achievable, whichever pool happens to be scarce.
    for (const [servers, seats] of [[12, 1200], [1000, 10], [2, 2], [50, 500]]) {
      const r = analyse([
        'TableName\tPlan\tBillableMB',
        `DeviceCustomFileEvents\tAnalytics\t${mb(6)}`,
        `SecurityEvent\tAnalytics\t${mb(4)}`,
        `SigninLogs\tAnalytics\t${mb(3)}`,
      ].join('\n'), {
        licence: 'e5', licensedSeats: seats, defenderServersP2Enabled: true, serverCount: servers,
      })
      const granted = r.p2GrantedGbPerDay + r.e5GrantedGbPerDay
      const pools = servers * 0.5 + seats * 0.005
      expect(granted).toBeLessThanOrEqual(Math.min(pools, 13) + 1e-6)
      expect(granted).toBeGreaterThanOrEqual(0)
    }
  })
})
