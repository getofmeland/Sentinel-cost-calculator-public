import { Fragment } from 'react'
import { SourceEstimateRow } from '../utils/ingestion'
import { LogTierKey } from '../data/logTiers'
import { TIER_PLACEMENT_DEFAULTS, TierRecommendation } from '../data/tierPlacement'
import { DAYS_PER_MONTH, LogSourceGroup } from '../data/pricing'
import { fmtGbp, fmtBoth } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'

interface Props {
  rows: SourceEstimateRow[]
  logTiers: Record<string, LogTierKey>
  onLogTierChange: (id: string, tier: LogTierKey) => void
  analyticsGbPerDay: number
  dataLakeGbPerDay: number
  analyticsDailyCostUsd: number
  dataLakeDailyCostUsd: number
  recommendedAnalyticsRateUsd: number
}

const GROUP_LABELS: Record<LogSourceGroup, string> = {
  'identity': 'Identity & Entra',
  'microsoft-defender': 'Microsoft Defender',
  'microsoft-365': 'Microsoft 365',
  'azure-platform': 'Azure Platform',
  'network': 'Network',
  'infrastructure': 'Infrastructure',
  'third-party': 'Third-party & Custom',
}

const GROUP_ORDER: LogSourceGroup[] = [
  'identity',
  'microsoft-defender',
  'microsoft-365',
  'azure-platform',
  'network',
  'infrastructure',
  'third-party',
]

const REC_PILL_STYLES: Record<TierRecommendation, string> = {
  analytics: 'bg-primary text-white',
  'data-lake': 'bg-primary/15 text-light',
  free: 'bg-primary/15 text-primary',
}

const REC_LABELS: Record<TierRecommendation, string> = {
  analytics: 'Analytics',
  'data-lake': 'Data Lake',
  free: 'Free',
}

function fmtGbDay(gb: number): string {
  return gb.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function TierPlacementTab({
  rows,
  logTiers,
  onLogTierChange,
  analyticsGbPerDay,
  dataLakeGbPerDay,
  analyticsDailyCostUsd,
  dataLakeDailyCostUsd,
  recommendedAnalyticsRateUsd,
}: Props) {
  const { pricing, fxRate } = usePricing()
  if (rows.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-white/10 shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-light/50">
          Select log sources on the Ingestion tab to see tier placement recommendations.
        </p>
      </div>
    )
  }

  const allAnalyticsCostMonthly = (analyticsGbPerDay + dataLakeGbPerDay) * pricing.paygRateUsd * DAYS_PER_MONTH
  const currentCostMonthly = (analyticsDailyCostUsd + dataLakeDailyCostUsd) * DAYS_PER_MONTH
  const saving = allAnalyticsCostMonthly - currentCostMonthly
  const savingPct = allAnalyticsCostMonthly > 0 ? (saving / allAnalyticsCostMonthly) * 100 : 0

  const analyticsMonthly = analyticsDailyCostUsd * DAYS_PER_MONTH
  const dataLakeMonthly = dataLakeDailyCostUsd * DAYS_PER_MONTH

  // Group rows by source group
  const groupedRows = GROUP_ORDER
    .map(group => ({
      group,
      label: GROUP_LABELS[group],
      rows: rows.filter(r => r.source.group === group),
    }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface rounded-xl border border-white/10 shadow-sm px-5 py-4">
          <p className="text-xs font-semibold text-light/50 uppercase tracking-widest mb-1">Analytics</p>
          <p className="text-lg font-semibold text-light">{fmtGbDay(analyticsGbPerDay)} GB/day</p>
          <p className="text-sm text-light/50">{fmtBoth(analyticsMonthly, 2, fxRate)}/month</p>
        </div>
        <div className="bg-surface rounded-xl border border-white/10 shadow-sm px-5 py-4">
          <p className="text-xs font-semibold text-light/50 uppercase tracking-widest mb-1">Data Lake</p>
          <p className="text-lg font-semibold text-light">{fmtGbDay(dataLakeGbPerDay)} GB/day</p>
          <p className="text-sm text-light/50">{fmtBoth(dataLakeMonthly, 2, fxRate)}/month</p>
        </div>
        <div className="bg-surface rounded-xl border border-white/10 shadow-sm px-5 py-4">
          <p className="text-xs font-semibold text-light/50 uppercase tracking-widest mb-1">Saving vs all-Analytics</p>
          <p className={`text-lg font-semibold ${savingPct > 0 ? 'text-primary' : 'text-light/40'}`}>
            {savingPct > 0
              ? <><span aria-hidden="true">▼ </span><span className="sr-only">Saving of </span>{savingPct.toFixed(0)}%</>
              : <><span aria-hidden="true">—</span><span className="sr-only">No saving</span></>
            }
          </p>
          {savingPct > 0 && (
            <p className="text-sm text-light/50">{fmtGbp(saving, 2, fxRate)}/month saved</p>
          )}
        </div>
      </div>

      {/* Per-source table */}
      <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-light">Tier Placement</h2>
          <p className="text-sm text-light/50 mt-0.5">
            Expert-recommended tiers for each source. Override to suit your environment.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th scope="col" className="text-left px-6 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest">Log Source</th>
                <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest">Rec.</th>
                <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest hidden sm:table-cell">Reason</th>
                <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest">Override</th>
                <th scope="col" className="text-right px-6 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest">GB/day</th>
                <th scope="col" className="text-right px-6 py-2.5 text-[10px] font-semibold text-light/50 uppercase tracking-widest">Daily Cost</th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(({ group, label, rows: groupRows }) => (
                <Fragment key={group}>
                  <tr className="bg-dark border-y border-white/10">
                    <td colSpan={6} className="px-6 py-1.5">
                      <span className="text-[10px] font-semibold text-light/40 uppercase tracking-[0.12em]">
                        {label}
                      </span>
                    </td>
                  </tr>
                  {groupRows.map(row => {
                    const placement = TIER_PLACEMENT_DEFAULTS.find(d => d.sourceId === row.source.id)
                    const recommended: TierRecommendation = placement?.recommendedTier ?? 'analytics'
                    const currentTier = (logTiers[row.source.id] as LogTierKey | undefined) ?? 'analytics'
                    const isOverridden = !row.source.isFree && currentTier !== recommended && recommended !== 'free'

                    let dailyCostDisplay: string
                    if (row.source.isFree) {
                      dailyCostDisplay = 'Free'
                    } else if (currentTier === 'data-lake') {
                      dailyCostDisplay = fmtGbp(row.gbPerDay * pricing.dataLakeRateUsd, 2, fxRate)
                    } else {
                      dailyCostDisplay = fmtGbp(row.gbPerDay * recommendedAnalyticsRateUsd, 2, fxRate)
                    }

                    return (
                      <tr key={row.source.id} className="border-b border-white/10 hover:bg-white/5 transition-colors">
                        <td className="px-6 py-3 font-medium text-light">{row.source.label}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${REC_PILL_STYLES[recommended]}`}
                            title={placement?.reason}
                          >
                            {REC_LABELS[recommended]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-light/50 hidden sm:table-cell max-w-xs">
                          {placement?.reason ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          {row.source.isFree || recommended === 'free' ? (
                            <span className="text-xs text-light/40">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isOverridden && (
                                <span className="text-[10px] font-medium text-light/60 bg-[#2e3245] border border-white/15 rounded px-1 py-0.5">
                                  Modified
                                </span>
                              )}
                              <div
                                role="group"
                                aria-label={`Tier for ${row.source.label}`}
                                className="flex rounded border border-white/15 overflow-hidden text-xs w-fit"
                              >
                                {(['analytics', 'data-lake'] as LogTierKey[]).map(tier => {
                                  const isActive = currentTier === tier
                                  return (
                                    <button
                                      key={tier}
                                      type="button"
                                      onClick={() => onLogTierChange(row.source.id, tier)}
                                      aria-pressed={isActive}
                                      aria-label={`Set ${row.source.label} to ${tier === 'analytics' ? 'Analytics' : 'Data Lake'}`}
                                      className={[
                                        'px-2.5 py-1 border-r border-white/15 last:border-r-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10 focus-visible:ring-primary focus-visible:ring-offset-1',
                                        isActive
                                          ? 'bg-primary text-white border-primary'
                                          : 'bg-surface text-light/60 hover:bg-white/5',
                                      ].join(' ')}
                                    >
                                      <span aria-hidden="true">{tier === 'analytics' ? 'Analytics' : 'Data Lake'}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-light/70">{fmtGbDay(row.gbPerDay)}</td>
                        <td className="px-6 py-3 text-right font-mono text-light/70">{dailyCostDisplay}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Info note */}
        <div className="px-6 py-4 border-t border-white/10 bg-dark space-y-1">
          <p className="text-xs text-light/50">
            <span className="font-medium">Data Lake query cost:</span> ${pricing.dataLakeQueryRateUsd.toFixed(3)}/GB scanned (not included in base estimate)
          </p>
          <p className="text-xs text-light/50">
            <span className="font-medium">Summary Rules</span> can aggregate Data Lake data into Analytics tables for specific detections (e.g. IOC matching, DNS anomalies)
          </p>
        </div>
      </div>
    </div>
  )
}
