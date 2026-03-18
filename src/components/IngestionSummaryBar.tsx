import { IngestionSummary } from '../utils/ingestion'
import { fmtGbp } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'

interface IngestionSummaryBarProps {
  summary: IngestionSummary
}

export function IngestionSummaryBar({ summary }: IngestionSummaryBarProps) {
  const { pricing, fxRate } = usePricing()
  const dataLakeRateGbp = (pricing.dataLakeRateUsd * fxRate).toFixed(2)
  if (summary.rows.length === 0) {
    return (
      <div className="mt-4 p-4 rounded-lg bg-dark border border-white/10">
        <p className="text-sm text-light/50 text-center">
          Select one or more log sources above to see your estimated daily ingestion.
        </p>
      </div>
    )
  }

  const hasDataLake = summary.dataLakeGbPerDay > 0
  const analyticsExtended = summary.analyticsExtendedRetentionMonthlyCostUsd
  const dataLakeMirror = summary.dataLakeMirrorRetentionMonthlyCostUsd
  const dataLakeNative = summary.dataLakeNativeRetentionMonthlyCostUsd
  const hasRetentionCost = analyticsExtended > 0 || dataLakeMirror > 0 || dataLakeNative > 0

  return (
    <div className="mt-4 space-y-3">
      {/* Row 1 — totals */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 rounded-lg px-4 py-4 bg-dark text-light">
          <p className="text-[10px] font-semibold opacity-50 uppercase tracking-widest">Total</p>
          <p className="text-4xl font-bold font-mono mt-1 leading-none">{summary.totalGbPerDay.toFixed(2)}</p>
          <p className="text-xs opacity-50 mt-1">GB/day across all sources</p>
        </div>
        <div className="flex-1 rounded-lg px-4 py-4 bg-primary/10 border border-primary/30">
          <p className="text-[10px] font-semibold text-primary/60 uppercase tracking-widest">Free</p>
          <p className="text-4xl font-bold font-mono mt-1 leading-none text-primary">{summary.freeGbPerDay.toFixed(2)}</p>
          <p className="text-xs text-light/50 mt-1">GB/day no charge</p>
        </div>
        <div className="flex-1 rounded-lg px-4 py-4 bg-[#252838] border border-white/10">
          <p className="text-[10px] font-semibold text-light/40 uppercase tracking-widest">Daily cost</p>
          <p className="text-4xl font-bold font-mono mt-1 leading-none text-light">
            {fmtGbp(summary.totalDailyCostUsd, 0, fxRate)}
          </p>
          <p className="text-xs text-light/40 mt-1">${summary.totalDailyCostUsd.toFixed(0)} USD · PAYG</p>
        </div>
      </div>

      {/* Row 2 — tier breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Analytics */}
        <div className={`rounded-lg px-4 py-4 bg-warning/10 border border-warning/30 ${summary.analyticsGbPerDay === 0 ? 'opacity-40' : ''}`}>
          <p className="text-[10px] font-semibold text-warning/70 uppercase tracking-widest">Analytics</p>
          <p className="text-3xl font-bold font-mono mt-1 leading-none text-warning">{summary.analyticsGbPerDay.toFixed(2)}</p>
          <p className="text-xs text-light/50 mt-1">GB/day</p>
          <p className="text-xs text-light/50 mt-1.5">
            {fmtGbp(summary.analyticsDailyCostUsd, 0, fxRate)}/day
            <span className="text-light/40"> · commitment tiers apply</span>
          </p>
        </div>

        {/* Data Lake */}
        <div className={`rounded-lg px-4 py-4 bg-primary/10 border border-primary/20 ${!hasDataLake ? 'opacity-40' : ''}`}>
          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">Data Lake</p>
          <p className="text-3xl font-bold font-mono mt-1 leading-none text-primary">{summary.dataLakeGbPerDay.toFixed(2)}</p>
          <p className="text-xs text-light/50 mt-1">GB/day</p>
          <p className="text-xs text-light/50 mt-1.5">
            {fmtGbp(summary.dataLakeDailyCostUsd, 0, fxRate)}/day · £{dataLakeRateGbp}/GB · 30-day free retention
          </p>
        </div>
      </div>

      {/* Row 3 — extended retention cost (only shown when non-zero) */}
      {hasRetentionCost && (
        <div className="rounded-lg px-4 py-3 bg-accent/20 border border-accent/40">
          <p className="text-xs font-medium text-light/70 uppercase tracking-wide mb-2">Extended retention</p>
          <div className="flex flex-col gap-2">
            {analyticsExtended > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-light/50">Analytics extended</span>
                <span className="text-sm font-bold font-mono text-light">{fmtGbp(analyticsExtended, 2, fxRate)}/mo</span>
              </div>
            )}
            {dataLakeMirror > 0 && (
              <div className={`flex items-center justify-between ${analyticsExtended > 0 ? 'pt-2 border-t border-accent/40' : ''}`}>
                <span className="text-xs text-light/50">Data Lake mirror</span>
                <span className="text-sm font-bold font-mono text-primary">{fmtGbp(dataLakeMirror, 2, fxRate)}/mo</span>
              </div>
            )}
            {dataLakeNative > 0 && (
              <div className={`flex items-center justify-between ${(analyticsExtended > 0 || dataLakeMirror > 0) ? 'pt-2 border-t border-accent/40' : ''}`}>
                <span className="text-xs text-light/50">Data Lake long-term</span>
                <span className="text-sm font-bold font-mono text-light">{fmtGbp(dataLakeNative, 2, fxRate)}/mo</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
