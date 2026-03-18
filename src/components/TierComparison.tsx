import { computeTierOptions } from '../utils/tiers'
import { BILLING_RULES } from '../data/pricing'
import { usePricing } from '../contexts/PricingContext'
import { TierTable } from './TierTable'
import { BreakevenChart } from './BreakevenChart'

interface Props {
  /** Only Analytics-tier GB — Basic and Auxiliary logs are not eligible for commitment tiers */
  analyticsGbPerDay: number
  /** Data Lake GB/day — excluded from commitment tier pricing */
  dataLakeGbPerDay?: number
}

export function TierComparison({ analyticsGbPerDay, dataLakeGbPerDay = 0 }: Props) {
  const { pricing, fxRate } = usePricing()
  const options = computeTierOptions(analyticsGbPerDay, pricing, fxRate)

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
          <p className="text-xs text-light/40 mt-1">
            <span className="font-medium">{dataLakeGbPerDay.toFixed(1)} GB/day</span> routed to Data Lake at ${pricing.dataLakeRateUsd.toFixed(2)}/GB — excluded from commitment tier pricing.
          </p>
        )}
      </div>

      <TierTable options={options} billableGbPerDay={analyticsGbPerDay} />

      <div className="border-t border-white/10" />

      {/* Chart section */}
      <div className="px-6 py-4">
        <h3 className="text-sm font-semibold text-light mb-3">Cost vs. Volume</h3>
        <BreakevenChart billableGbPerDay={analyticsGbPerDay} dataLakeGbPerDay={dataLakeGbPerDay} />
      </div>

      {/* Footer note */}
      <div className="px-6 pb-5 text-xs text-light/40 space-y-1">
        <p>
          * The 50 GB/day preview tier ({BILLING_RULES.promoTierExpiryDate.replace(/-/g, '\u2011')} expiry) is available
          during the preview period; the minimum commitment tier thereafter is{' '}
          {BILLING_RULES.minimumTierWithoutPromoGbPerDay} GB/day.
        </p>
        <p>
          ** Commitment tier changes require a {BILLING_RULES.downgradeWaitDays}-day wait before downgrading.
          Overage above a committed tier is billed at the same discounted tier rate.
        </p>
      </div>
    </div>
  )
}
