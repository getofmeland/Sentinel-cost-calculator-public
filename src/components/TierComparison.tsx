import { computeTierOptions, defenderIsocMonthlyUsd } from '../utils/tiers'
import { BILLING_RULES, DAYS_PER_MONTH, type AnalyticsBillingMode } from '../data/pricing'
import { isocBillingAllowed, type M365Licence } from '../data/licenceBenefits'
import { usePricing } from '../contexts/PricingContext'
import { TierTable } from './TierTable'
import { BreakevenChart } from './BreakevenChart'
import { formatUkDate } from '../utils/dates'
import { fmtCurrency } from '../utils/currency'

interface Props {
  /** Analytics GB after licence grants. Commitment tiers are sized on this. */
  analyticsGbPerDay: number
  /** Additional Analytics GB billed on the ISOC meter. Included Defender and Entra data is already removed. */
  isocPaidGbPerDay: number
  /** GB/day left off the ISOC meter because Microsoft lists it as included benefit data */
  isocIncludedGbPerDay: number
  /** Recommended classic Analytics cost for the month, net of grants and the best commitment tier */
  classicAnalyticsMonthlyUsd: number
  /** Data Lake GB/day — excluded from commitment tier pricing */
  dataLakeGbPerDay?: number
  analyticsBilling: AnalyticsBillingMode
  onAnalyticsBillingChange: (mode: AnalyticsBillingMode) => void
  licence: M365Licence
}

export function TierComparison({
  analyticsGbPerDay,
  isocPaidGbPerDay,
  isocIncludedGbPerDay,
  classicAnalyticsMonthlyUsd,
  dataLakeGbPerDay = 0,
  analyticsBilling,
  onAnalyticsBillingChange,
  licence,
}: Props) {
  const { pricing, fxRate, displayCurrency, eurRate, defenderIsocRateNote } = usePricing()
  const isocEligible = isocBillingAllowed(licence)
  const options = computeTierOptions(analyticsGbPerDay, pricing, fxRate)
  const isocDaily = isocPaidGbPerDay * pricing.defenderIsocRateUsd
  const isocMonthly = defenderIsocMonthlyUsd(isocPaidGbPerDay, pricing.defenderIsocRateUsd)
  const paygMonthly = isocPaidGbPerDay * pricing.paygRateUsd * DAYS_PER_MONTH
  const vsPaygPct = paygMonthly > 0 ? ((paygMonthly - isocMonthly) / paygMonthly) * 100 : 0
  const vsClassic = classicAnalyticsMonthlyUsd - isocMonthly

  function fmt(usd: number, decimals = 2) {
    return fmtCurrency(usd, displayCurrency, fxRate, eurRate, decimals)
  }

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-light">Commitment Tier Comparison</h2>
        <p className="text-sm text-light/50 mt-0.5">
          Compare PAYG and commitment tiers for your Analytics-tier ingestion volume.
          Data Lake logs are priced separately at a flat rate.
        </p>
        {dataLakeGbPerDay > 0 && (
          <p className="text-xs text-light/60 mt-1">
            <span className="font-medium">{dataLakeGbPerDay.toFixed(1)} GB/day</span> routed to Data Lake at ${pricing.dataLakeRateUsd.toFixed(2)}/GB — excluded from commitment tier pricing.
          </p>
        )}
      </div>

      <fieldset className="px-6 py-4 border-b border-white/10 bg-dark/40">
        <legend className="text-[11px] font-semibold text-light/60 uppercase tracking-widest">
          Analytics billing
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={`flex gap-3 rounded-lg border px-3 py-3 cursor-pointer ${analyticsBilling === 'classic' ? 'border-primary bg-primary/10' : 'border-white/15'}`}>
            <input
              type="radio"
              name="analytics-billing"
              className="mt-0.5 accent-primary"
              checked={analyticsBilling === 'classic'}
              onChange={() => onAnalyticsBillingChange('classic')}
            />
            <span>
              <span className="block text-sm font-medium text-light">Sentinel pay-as-you-go and commitment tiers</span>
              <span className="block text-xs text-light/60 mt-1">
                {fmt(pricing.paygRateUsd)}/GB pay-as-you-go. Commitment tiers below apply to Analytics volume only.
              </span>
            </span>
          </label>
          <label className={`flex gap-3 rounded-lg border px-3 py-3 ${isocEligible ? 'cursor-pointer' : 'opacity-60'} ${analyticsBilling === 'defender-isoc' ? 'border-primary bg-primary/10' : 'border-white/15'}`}>
            <input
              type="radio"
              name="analytics-billing"
              className="mt-0.5 accent-primary"
              checked={analyticsBilling === 'defender-isoc'}
              disabled={!isocEligible}
              onChange={() => { if (isocEligible) onAnalyticsBillingChange('defender-isoc') }}
            />
            <span>
              <span className="block text-sm font-medium text-light">Defender ISOC</span>
              <span className="block text-xs text-light/60 mt-1">
                {fmt(pricing.defenderIsocRateUsd)}/GB, flat. No commitment tiers.
                {isocEligible && isocPaidGbPerDay > 0 && (
                  <> {fmt(isocDaily, 0)}/day · {fmt(isocMonthly, 0)}/month on additional data.</>
                )}
              </span>
              {isocEligible && isocPaidGbPerDay > 0 && (
                <span className="block text-xs text-light/60 mt-1">
                  {fmt(Math.abs(vsClassic), 0)}/month {vsClassic >= 0 ? 'under' : 'above'} the recommended classic Analytics cost
                  {vsPaygPct > 0 && <> · flat rate is {vsPaygPct.toFixed(0)}% under pay-as-you-go on that additional volume</>}.
                </span>
              )}
              {defenderIsocRateNote && (
                <span className="block text-xs text-light/60 mt-1">{defenderIsocRateNote}</span>
              )}
            </span>
          </label>
        </div>
        <p className="text-xs text-light/60 mt-3 leading-relaxed">
          {isocEligible
            ? `Defender ISOC is an opt-in from ${formatUkDate(BILLING_RULES.defenderIsocOptInDate)} for Microsoft 365 E5 and E7. Microsoft Defender Suite is also named in the announcement; this calculator has no separate Defender Suite licence. The meter prices additional data only. ${isocIncludedGbPerDay.toFixed(2)} GB/day of listed Defender for Endpoint, Identity, Office 365, Cloud Apps and Entra data is left off the charge. Defender for Cloud Apps here also models Shadow IT discovery, which that page does not list. Anything else stays on the meter, so the total is an upper bound where the list is silent.`
            : `Defender ISOC is available from ${formatUkDate(BILLING_RULES.defenderIsocOptInDate)} with Microsoft 365 E5 or E7. Select one of those licences to use this rate.`}
        </p>
      </fieldset>

      <TierTable options={options} billableGbPerDay={analyticsGbPerDay} />

      <div className="border-t border-white/10" />

      {/* Chart section */}
      <div className="px-6 py-4">
        <h3 className="text-sm font-semibold text-light mb-3">Cost vs. Volume</h3>
        <BreakevenChart billableGbPerDay={analyticsGbPerDay} dataLakeGbPerDay={dataLakeGbPerDay} />
      </div>

      {/* Footer note */}
      <div className="px-6 pb-5 text-xs text-light/60 space-y-1">
        <p>
          * The 50 GB/day tier is a public preview promotion. New sign-ups close on{' '}
          {formatUkDate(BILLING_RULES.promoTierSignupDeadline)}. Customers who sign up by then keep the
          promotional price until {formatUkDate(BILLING_RULES.promoTierExpiryDate)}. After that, the minimum
          commitment tier is {BILLING_RULES.minimumTierWithoutPromoGbPerDay} GB/day.
        </p>
        <p>
          ** Commitment tier changes require a {BILLING_RULES.downgradeWaitDays}-day wait before downgrading.
          Overage above a committed tier is billed at the same discounted tier rate.
        </p>
      </div>
    </div>
  )
}
