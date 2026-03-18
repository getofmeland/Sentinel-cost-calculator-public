import {
  M365Licence,
  E5_DATA_GRANT_GB_PER_USER_PER_DAY,
  E5_GRANT_ELIGIBLE_SOURCE_IDS,
  E5_QUALIFYING_LICENCES,
  DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY,
} from '../data/licenceBenefits'
import { SourceEstimateRow } from './ingestion'
import {
  DAYS_PER_MONTH,
  PricingBundle,
  STATIC_PRICING_BUNDLE,
} from '../data/pricing'

export interface LicenceBenefitResult {
  // E5 Data Grant
  /** Analytics-tier GB/day from Entra ID + MDCA sources */
  e5EligibleAnalyticsGbPerDay: number
  /** userCount × 5 MB/day allowance */
  e5AllowanceGbPerDay: number
  /** min(allowance, eligible) billing credit — 0 when licence is not E5/E5-Security */
  e5GrantGbPerDay: number
  e5SavedMonthlyUsd: number
  e5IsActive: boolean

  // Defender for Servers P2
  /** Analytics-tier GB/day from Windows Security + Linux Syslog (non-free sources) */
  defenderServersEligibleGbPerDay: number
  /** enrolledServers × 500 MB/day allowance */
  defenderServersAllowanceGbPerDay: number
  /** min(allowance, eligible) billing credit — 0 when Defender is not enabled */
  defenderServersGrantGbPerDay: number
  defenderServersSavedMonthlyUsd: number
  defenderServersIsActive: boolean

  // Totals
  totalGrantGbPerDay: number
  /** max(0, analyticsGbPerDay - totalGrantGbPerDay) */
  billableAnalyticsGbPerDay: number
  totalSavedMonthlyUsd: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeLicenceBenefits(
  rows: SourceEstimateRow[],
  analyticsGbPerDay: number,
  licence: M365Licence,
  userCount: number,
  defenderServersEnabled: boolean,
  totalEnrolledServers: number,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
): LicenceBenefitResult {
  // ── E5 Data Grant ────────────────────────────────────────────────────────
  const e5IsActive = E5_QUALIFYING_LICENCES.has(licence)

  const e5EligibleAnalyticsGbPerDay = round2(
    rows
      .filter(
        r =>
          r.logTier === 'analytics' &&
          E5_GRANT_ELIGIBLE_SOURCE_IDS.has(r.source.id) &&
          !r.source.isFree,
      )
      .reduce((s, r) => s + r.gbPerDay, 0),
  )

  const e5AllowanceGbPerDay = round2(userCount * E5_DATA_GRANT_GB_PER_USER_PER_DAY)

  const e5GrantGbPerDay = e5IsActive
    ? round2(Math.min(e5AllowanceGbPerDay, e5EligibleAnalyticsGbPerDay))
    : 0

  const e5SavedMonthlyUsd = round2(e5GrantGbPerDay * DAYS_PER_MONTH * pricing.paygRateUsd)

  // ── Defender for Servers P2 ──────────────────────────────────────────────
  const defenderServersIsActive = defenderServersEnabled

  const defenderServersEligibleGbPerDay = round2(
    rows
      .filter(
        r =>
          r.logTier === 'analytics' &&
          r.source.p2Eligible === true,
      )
      .reduce((s, r) => s + r.gbPerDay, 0),
  )

  const defenderServersAllowanceGbPerDay = round2(
    totalEnrolledServers * DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY,
  )

  const defenderServersGrantGbPerDay = defenderServersIsActive
    ? round2(Math.min(defenderServersAllowanceGbPerDay, defenderServersEligibleGbPerDay))
    : 0

  const defenderServersSavedMonthlyUsd = round2(
    defenderServersGrantGbPerDay * DAYS_PER_MONTH * pricing.paygRateUsd,
  )

  // ── Totals ───────────────────────────────────────────────────────────────
  const totalGrantGbPerDay = round2(e5GrantGbPerDay + defenderServersGrantGbPerDay)

  const billableAnalyticsGbPerDay = round2(
    Math.max(0, analyticsGbPerDay - totalGrantGbPerDay),
  )

  const totalSavedMonthlyUsd = round2(e5SavedMonthlyUsd + defenderServersSavedMonthlyUsd)

  return {
    e5EligibleAnalyticsGbPerDay,
    e5AllowanceGbPerDay,
    e5GrantGbPerDay,
    e5SavedMonthlyUsd,
    e5IsActive,

    defenderServersEligibleGbPerDay,
    defenderServersAllowanceGbPerDay,
    defenderServersGrantGbPerDay,
    defenderServersSavedMonthlyUsd,
    defenderServersIsActive,

    totalGrantGbPerDay,
    billableAnalyticsGbPerDay,
    totalSavedMonthlyUsd,
  }
}
