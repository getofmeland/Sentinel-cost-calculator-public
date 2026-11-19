// @vitest-environment node
/**
 * Ignite 2026 pricing behaviour that must stay tied to the published rules:
 * lake-only retention has no free window, Defender ISOC is a flat alternative
 * and does not replace the commitment ladder, and the Microsoft 365 data grant
 * covers the families named on the offer page.
 */

import { describe, it, expect } from 'vitest'

import { getTierDefinition, defaultSelectedRetentionDays } from '../../data/logTiers'
import { summariseIngestion, retentionCostUsd } from '../ingestion'
import {
  BILLING_RULES,
  DATA_LAKE_COMPRESSION_RATIO,
  DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH,
  DAYS_PER_MONTH,
  DEFENDER_ISOC_RATE_USD_PER_GB,
  LOG_SOURCES,
  PAYG_RATE_USD_PER_GB,
  STATIC_PRICING_BUNDLE,
} from '../../data/pricing'
import {
  E5_QUALIFYING_LICENCES,
  SECURITY_COPILOT_LICENCES,
  SECURITY_COPILOT_MONTHLY_CAP_SCUS,
  includedSecurityCopilotScus,
} from '../../data/licenceBenefits'
import { computeLicenceBenefits } from '../licenceBenefits'
import {
  computeTierOptions,
  defenderIsocMonthlyUsd,
  isocAnalyticsBaselineGb,
  isocSavingVersusClassicMonthly,
  promoTierSignupOpen,
  splitIsocAnalyticsGb,
  ukCalendarDate,
} from '../tiers'
import { clampLicensedSeats, coerceAnalyticsBilling } from '../shareState'
import { formatUkDate } from '../dates'
import type { SourceEstimateRow } from '../ingestion'

describe('data lake retention after general availability', () => {
  it('gives lake-only tables no included free window, and leaves Analytics at 90 days', () => {
    expect(getTierDefinition('data-lake').freeRetentionDays).toBe(0)
    expect(getTierDefinition('analytics').freeRetentionDays).toBe(90)
  })

  it('bills a 30-day lake retention for the whole period, on compressed volume', () => {
    const gbPerDay = 6
    const cost = retentionCostUsd(gbPerDay, 30, 'data-lake', 'data-lake-mirror', STATIC_PRICING_BUNDLE)
    const expected = (gbPerDay / DATA_LAKE_COMPRESSION_RATIO) * 30 * DATA_LAKE_RETENTION_RATE_USD_PER_GB_PER_MONTH
    expect(cost).toBeCloseTo(expected, 2)
    expect(cost).toBeGreaterThan(0)
  })

  it('still leaves Analytics data inside 90 days uncharged', () => {
    expect(retentionCostUsd(6, 90, 'analytics', 'data-lake-mirror', STATIC_PRICING_BUNDLE)).toBe(0)
    expect(retentionCostUsd(6, 90, 'analytics', 'analytics-extended', STATIC_PRICING_BUNDLE)).toBe(0)
  })

  it('defaults an unset lake retention to the shortest selectable period', () => {
    expect(defaultSelectedRetentionDays('data-lake')).toBe(30)
    expect(defaultSelectedRetentionDays('analytics')).toBe(90)
  })

  it('charges that default when a lake source has no explicit retention', () => {
    const summary = summariseIngestion(
      new Set(['dns']),
      1000,
      { dns: 2 },
      { dns: 'data-lake' },
      {},
    )
    const row = summary.rows.find(r => r.source.id === 'dns')!
    expect(row.gbPerDay).toBeGreaterThan(0)
    expect(row.retentionDays).toBe(30)
    expect(row.retentionMonthlyCostUsd).toBeGreaterThan(0)
    expect(summary.dataLakeNativeRetentionMonthlyCostUsd).toBeGreaterThan(0)
  })
})

describe('Defender ISOC paid volume', () => {
  it('leaves listed Defender and Entra data off the meter and keeps other Analytics data on it', () => {
    const split = splitIsocAnalyticsGb([
      { source: { id: 'mde', isFree: false }, gbPerDay: 4, logTier: 'analytics' },
      { source: { id: 'entra-id', isFree: false }, gbPerDay: 1, logTier: 'analytics' },
      { source: { id: 'mdca', isFree: false }, gbPerDay: 2.5, logTier: 'analytics' },
      { source: { id: 'dns', isFree: false }, gbPerDay: 6, logTier: 'analytics' },
      { source: { id: 'azure-activity', isFree: true }, gbPerDay: 2, logTier: 'analytics' },
      { source: { id: 'mde', isFree: false }, gbPerDay: 3, logTier: 'data-lake' },
    ])
    expect(split.includedGbPerDay).toBe(5)
    // Defender for Cloud Apps stays paid: Shadow IT is not on the included list.
    expect(split.paidGbPerDay).toBe(8.5)
  })

  it('does not let a Sentinel grant shrink the ISOC charge', () => {
    const additionalGbPerDay = 10
    const grantGbPerDay = 5
    const onTheMeter = defenderIsocMonthlyUsd(additionalGbPerDay, DEFENDER_ISOC_RATE_USD_PER_GB)
    const ifTheGrantWereApplied = defenderIsocMonthlyUsd(additionalGbPerDay - grantGbPerDay, DEFENDER_ISOC_RATE_USD_PER_GB)
    expect(onTheMeter).toBeCloseTo(additionalGbPerDay * DEFENDER_ISOC_RATE_USD_PER_GB * DAYS_PER_MONTH, 6)
    expect(onTheMeter).toBeGreaterThan(ifTheGrantWereApplied)
  })

  it('drops ISOC for an ineligible licence and clamps seats', () => {
    expect(coerceAnalyticsBilling('defender-isoc', 'e5')).toBe('defender-isoc')
    expect(coerceAnalyticsBilling('defender-isoc', 'e7')).toBe('defender-isoc')
    expect(coerceAnalyticsBilling('defender-isoc', 'e5-security')).toBe('classic')
    expect(coerceAnalyticsBilling('defender-isoc', 'e3')).toBe('classic')
    expect(clampLicensedSeats(800, 500)).toBe(500)
    expect(clampLicensedSeats(-3, 500)).toBe(0)
    expect(clampLicensedSeats(null, 500)).toBeNull()
  })
})

describe('Defender ISOC billing', () => {
  it('prices Analytics volume at the flat UK South fallback and stays off the commitment ladder', () => {
    const monthly = defenderIsocMonthlyUsd(10, DEFENDER_ISOC_RATE_USD_PER_GB)
    expect(monthly).toBeCloseTo(10 * DEFENDER_ISOC_RATE_USD_PER_GB * DAYS_PER_MONTH, 6)
    expect(DEFENDER_ISOC_RATE_USD_PER_GB).toBe(2.88)
    expect(DEFENDER_ISOC_RATE_USD_PER_GB).toBeLessThan(PAYG_RATE_USD_PER_GB)
    expect(PAYG_RATE_USD_PER_GB).toBe(5.38)

    const options = computeTierOptions(100, STATIC_PRICING_BUNDLE)
    expect(options.some(o => /isoc/i.test(o.label))).toBe(false)
    expect(options.filter(o => o.isRecommended)).toHaveLength(1)
  })

  it('keeps the 50 GB tier on the ladder but does not recommend it for a new estimate after sign-ups close', () => {
    const during = computeTierOptions(40, STATIC_PRICING_BUNDLE, 1, new Date('2026-12-31T12:00:00Z'), true)
    const after = computeTierOptions(40, STATIC_PRICING_BUNDLE, 1, new Date('2027-01-01T12:00:00Z'), false)
    expect(during.some(o => o.tier?.gbPerDay === 50)).toBe(true)
    expect(during.find(o => o.isRecommended)?.tier?.gbPerDay).toBe(50)
    expect(after.some(o => o.tier?.gbPerDay === 50)).toBe(true)
    expect(after.find(o => o.isRecommended)?.tier?.gbPerDay).not.toBe(50)
  })

  it('uses the UK civil date for the promo deadline, including during British Summer Time', () => {
    // 31 July 2026 23:30 UTC is 1 August in London (BST, UTC+1), not 31 July.
    expect(ukCalendarDate(new Date('2026-07-31T23:30:00Z'))).toBe('2026-08-01')
    // 31 December 2026 23:30 UTC is still 31 December in London, so sign-ups are open.
    expect(ukCalendarDate(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31')
    expect(promoTierSignupOpen(new Date('2026-12-31T23:30:00Z'))).toBe(true)
    // 1 January 2027 00:30 UTC is 1 January in London.
    expect(promoTierSignupOpen(new Date('2027-01-01T00:30:00Z'))).toBe(false)
  })

  it('prices an included source moved to the Data Lake at zero in the all-Analytics baseline', () => {
    const rows = [
      { source: { id: 'dns', isFree: false }, gbPerDay: 6, logTier: 'analytics' },
      { source: { id: 'mde', isFree: false }, gbPerDay: 4, logTier: 'data-lake' },
      { source: { id: 'firewall', isFree: false }, gbPerDay: 3, logTier: 'data-lake' },
    ]
    const split = splitIsocAnalyticsGb(rows)
    expect(isocAnalyticsBaselineGb(rows, split.paidGbPerDay)).toBe(9)
  })

  it('compares ISOC with the classic Analytics month even when additional volume is zero', () => {
    expect(isocSavingVersusClassicMonthly(120, 0)).toBe(120)
    expect(isocSavingVersusClassicMonthly(40, 90)).toBe(-50)
  })
})

describe('Microsoft 365 data grant families', () => {
  const entra = LOG_SOURCES.find(s => s.id === 'entra-id')!
  const rows: SourceEstimateRow[] = [{
    source: entra,
    gbPerDay: 10,
    logTier: 'analytics',
    retentionStrategy: 'data-lake-mirror',
    dailyCostUsd: 0,
    retentionDays: 90,
    retentionMonthlyCostUsd: 0,
  }]

  it('gives E7, A5, F5 and G5 the same grant as E5', () => {
    const e5 = computeLicenceBenefits(rows, 10, 'e5', 1000, false, 0)
    for (const licence of ['e7', 'a5', 'f5', 'g5'] as const) {
      expect(E5_QUALIFYING_LICENCES.has(licence)).toBe(true)
      const result = computeLicenceBenefits(rows, 10, licence, 1000, false, 0)
      expect(result.e5IsActive).toBe(true)
      expect(result.e5GrantGbPerDay).toBe(e5.e5GrantGbPerDay)
      expect(result.e5GrantGbPerDay).toBeGreaterThan(0)
    }
  })

  it('does not grant E3', () => {
    expect(computeLicenceBenefits(rows, 10, 'e3', 1000, false, 0).e5GrantGbPerDay).toBe(0)
  })
})

describe('Security Copilot inclusion', () => {
  it('uses licensed seats rather than headcount', () => {
    expect(includedSecurityCopilotScus(400)).toBe(160)
    expect(includedSecurityCopilotScus(1000)).toBe(400)
  })

  it('matches the published examples and the monthly cap', () => {
    expect(includedSecurityCopilotScus(400)).toBe(160)
    expect(includedSecurityCopilotScus(4000)).toBe(1600)
    expect(includedSecurityCopilotScus(1000)).toBe(400)
    expect(includedSecurityCopilotScus(30000)).toBe(SECURITY_COPILOT_MONTHLY_CAP_SCUS)
    expect(includedSecurityCopilotScus(0)).toBe(0)
    expect(includedSecurityCopilotScus(Number.NaN)).toBe(0)
  })

  it('is limited to the E5 and E7 licences the inclusion article names', () => {
    expect([...SECURITY_COPILOT_LICENCES].sort()).toEqual(['e5', 'e7'])
  })
})

describe('published dates', () => {
  it('keeps the sign-up deadline distinct from the price lock, in UK form', () => {
    expect(BILLING_RULES.promoTierSignupDeadline).toBe('2026-12-31')
    expect(BILLING_RULES.promoTierExpiryDate).toBe('2027-03-31')
    expect(BILLING_RULES.defenderIsocOptInDate).toBe('2026-11-17')
    expect(BILLING_RULES.azurePortalRetirementDate).toBe('2027-03-31')
    expect(formatUkDate('2026-12-31')).toBe('31 December 2026')
    expect(formatUkDate('2026-11-17')).toBe('17 November 2026')
    expect(formatUkDate('2027-03-31')).toBe('31 March 2027')
  })
})
