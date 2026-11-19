import { computeTierOptions, defenderIsocMonthlyUsd } from '../utils/tiers'
import { BILLING_RULES, DAYS_PER_MONTH, type AnalyticsBillingMode } from '../data/pricing'
import { usePricing } from '../contexts/PricingContext'
import { REGIONAL_RATE_FALLBACK_NOTE } from '../services/azurePricing'
import { TierTable } from './TierTable'
import { BreakevenChart } from './BreakevenChart'
import { formatUkDate } from '../utils/dates'
import { fmtCurrency } from '../utils/currency'

interface Props {
  /** Analytics GB after licence grants. Commitment tiers are sized on this. */
  analyticsGbPerDay: number
  /**
   * Analytics GB before licence grants. Defender ISOC is priced on this:
   * the grants are Sentinel credits and are not applied to the ISOC meter.
   */
  analyticsGrossGbPerDay: number
  /** Data Lake GB/day — excluded from commitment tier pricing */
  dataLakeGbPerDay?: number
  analyticsBilling: AnalyticsBillingMode
  onAnalyticsBillingChange: (mode: AnalyticsBillingMode) => void
}

export function TierComparison({
  analyticsGbPerDay,
  analyticsGrossGbPerDay,
  dataLakeGbPerDay = 0,
  analyticsBilling,
  onAnalyticsBillingChange,
}: Props) {
  const { pricing, fxRate, displayCurrency, eurRate, defenderIsocRateIsFallback } = usePricing()
  const options = computeTierOptions(analyticsGbPerDay, pricing, fxRate)
  const isocDaily = analyticsGrossGbPerDay * pricing.defenderIsocRateUsd
  const isocMonthly = defenderIsocMonthlyUsd(analyticsGrossGbPerDay, pricing.defenderIsocRateUsd)
  const paygMonthly = analyticsGrossGbPerDay * pricing.paygRateUsd * DAYS_PER_MONTH
  const isocSavingPct = paygMonthly > 0 ? ((paygMonthly - isocMonthly) / paygMonthly) * 100 : 0

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
          <label className={`flex gap-3 rounded-lg border px-3 py-3 cursor-pointer ${analyticsBilling === 'defender-isoc' ? 'border-primary bg-primary/10' : 'border-white/15'}`}>
            <input
              type="radio"
              name="analytics-billing"
              className="mt-0.5 accent-primary"
              checked={analyticsBilling === 'defender-isoc'}
              onChange={() => onAnalyticsBillingChange('defender-isoc')}
            />
            <span>
              <span className="block text-sm font-medium text-light">Defender ISOC</span>
              <span className="block text-xs text-light/60 mt-1">
                {fmt(pricing.defenderIsocRateUsd)}/GB, flat. No commitment tiers.
                {analyticsGrossGbPerDay > 0 && (
                  <> {fmt(isocDaily, 0)}/day · {fmt(isocMonthly, 0)}/month
                    {isocSavingPct > 0 && <> · {isocSavingPct.toFixed(0)}% under Sentinel pay-as-you-go</>}
                  </>
                )}
                {defenderIsocRateIsFallback && (
                  <span className="block mt-1">{REGIONAL_RATE_FALLBACK_NOTE}</span>
                )}
              </span>
            </span>
          </label>
        </div>
        <p className="text-xs text-light/60 mt-3 leading-relaxed">
          Defender ISOC is an opt-in from {formatUkDate(BILLING_RULES.defenderIsocOptInDate)} for customers
          with Microsoft 365 E5, Microsoft 365 E7, or Microsoft Defender Suite. The meter prices additional
          Microsoft and non-Microsoft data ingested through an ISOC workspace. Included Microsoft Defender
          data is a separate benefit. Licence grants stay on the classic Sentinel columns: they are Sentinel
          billing credits, and this estimate prices Analytics volume before those grants at the ISOC meter on its own.
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
