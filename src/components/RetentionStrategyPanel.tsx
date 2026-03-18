import { useState } from 'react'
import { RetentionStrategy, DATA_LAKE_MIRROR_RETENTION_OPTIONS } from '../data/pricing'
import { getTierDefinition } from '../data/logTiers'
import { SourceEstimateRow } from '../utils/ingestion'
import { fmtGbp } from '../utils/currency'
import { fmtRetentionOption } from '../utils/retention'
import { usePricing } from '../contexts/PricingContext'

interface RetentionStrategyPanelProps {
  globalStrategy: RetentionStrategy
  perSourceStrategies: Record<string, RetentionStrategy>
  analyticsRows: SourceEstimateRow[]
  onGlobalStrategyChange: (s: RetentionStrategy) => void
  onSourceStrategyChange: (id: string, s: RetentionStrategy) => void
  onRetentionChange: (id: string, days: number) => void
  retentionDays: Record<string, number>
  hasCustomPerSource: boolean
}

export function RetentionStrategyPanel({
  globalStrategy,
  perSourceStrategies,
  analyticsRows,
  onGlobalStrategyChange,
  onSourceStrategyChange,
  onRetentionChange,
  retentionDays,
  hasCustomPerSource,
}: RetentionStrategyPanelProps) {
  const { pricing, fxRate } = usePricing()
  const [perSourceOpen, setPerSourceOpen] = useState(false)

  const analyticsTierDef = getTierDefinition('analytics')

  // Cost comparison calculations
  const extendedMonthly = analyticsRows.reduce((s, r) => {
    const extra = Math.max(0, (retentionDays[r.source.id] ?? 90) - 90)
    return s + r.gbPerDay * extra * pricing.analyticsExtendedRetentionRateUsd
  }, 0)
  const mirrorMonthly = analyticsRows.reduce((s, r) => {
    const extra = Math.max(0, (retentionDays[r.source.id] ?? 90) - 90)
    return s + (r.gbPerDay / 6) * extra * pricing.dataLakeRetentionRateUsd
  }, 0)
  const savingPct = extendedMonthly > 0 ? Math.round((1 - mirrorMonthly / extendedMonthly) * 100) : 0
  const maxRetentionDays = Math.max(90, ...analyticsRows.map(r => retentionDays[r.source.id] ?? 90))
  const rampMonths = Math.round(maxRetentionDays / 30.44)

  const showComparisonCard = analyticsRows.some(r => (retentionDays[r.source.id] ?? 90) > 90)

  return (
    <div className="space-y-3">
      {/* Section 1 — Global segmented control */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-light/50 uppercase tracking-widest whitespace-nowrap">
          Retention strategy
        </span>
        <div className="flex rounded-md border border-white/15 overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => onGlobalStrategyChange('data-lake-mirror')}
            className={[
              'px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              globalStrategy === 'data-lake-mirror'
                ? 'bg-primary text-white'
                : 'bg-surface text-light/60 hover:bg-white/5',
            ].join(' ')}
          >
            Mirror to Data Lake
          </button>
          <button
            type="button"
            onClick={() => onGlobalStrategyChange('analytics-extended')}
            className={[
              'px-3 py-1.5 border-l border-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              globalStrategy === 'analytics-extended'
                ? 'bg-primary text-white'
                : 'bg-surface text-light/60 hover:bg-white/5',
            ].join(' ')}
          >
            Analytics Extended
          </button>
        </div>
      </div>

      {/* Section 2 — Info note (mirror only) */}
      {globalStrategy === 'data-lake-mirror' && (
        <p className="text-xs text-light/60">
          Analytics tables are automatically mirrored to the Data Lake after 90 days at no additional
          ingestion cost. Only storage is charged. Query charges of $0.005/GB apply when searching
          mirrored data.
        </p>
      )}

      {/* Section 3 — Cost comparison card */}
      {showComparisonCard && analyticsRows.length > 0 && (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Retention strategy cost comparison">
              <thead>
                <tr className="bg-dark text-[10px] uppercase tracking-wide text-light/50">
                  <th className="px-3 py-2 text-left font-medium">Metric</th>
                  <th className={`px-3 py-2 text-right font-medium ${globalStrategy === 'analytics-extended' ? 'ring-2 ring-inset ring-primary rounded' : ''}`}>
                    Analytics Extended
                  </th>
                  <th className={`px-3 py-2 text-right font-medium ${globalStrategy === 'data-lake-mirror' ? 'ring-2 ring-inset ring-primary rounded' : ''}`}>
                    Data Lake Mirror
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Saving</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                <tr>
                  <td className="px-3 py-2 text-light/60">Monthly retention cost</td>
                  <td className="px-3 py-2 text-right font-mono text-light">{fmtGbp(extendedMonthly, 2, fxRate)}/mo</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-primary">{fmtGbp(mirrorMonthly, 2, fxRate)}/mo</td>
                  <td className="px-3 py-2 text-right font-bold text-accent">
                    {savingPct > 0 ? `${savingPct}%` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-light/60">Max retention</td>
                  <td className="px-3 py-2 text-right text-light">2 years</td>
                  <td className="px-3 py-2 text-right text-primary font-medium">12 years</td>
                  <td className="px-3 py-2 text-right text-light/30">—</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-light/60">Query performance</td>
                  <td className="px-3 py-2 text-right text-light">Full KQL</td>
                  <td className="px-3 py-2 text-right text-light/60">Simple queries</td>
                  <td className="px-3 py-2 text-right text-light/30">—</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-light/60">Query cost</td>
                  <td className="px-3 py-2 text-right text-light">Included</td>
                  <td className="px-3 py-2 text-right text-light/60">£0.004/GB scanned</td>
                  <td className="px-3 py-2 text-right text-light/30">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[10px] text-light/40 border-t border-white/10">
            Costs shown are steady-state (after {rampMonths} months). Actual costs ramp up as data accumulates.
          </p>
        </div>
      )}

      {/* Section 4 — Collapsible per-source table */}
      {analyticsRows.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPerSourceOpen(o => !o)}
            className="text-xs text-light/50 hover:text-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
          >
            {perSourceOpen
              ? hasCustomPerSource
                ? '▴ Per-source: Custom configuration active'
                : '▴ Per-source configuration'
              : 'Configure per source ▾'}
          </button>

          {perSourceOpen && (
            <div className="mt-2 rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-dark text-[10px] uppercase tracking-wide text-light/50">
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">GB/day</th>
                    <th className="px-3 py-2 text-center font-medium">Strategy</th>
                    <th className="px-3 py-2 text-center font-medium">Retention</th>
                    <th className="px-3 py-2 text-right font-medium">Monthly cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {analyticsRows.map(r => {
                    const srcStrategy: RetentionStrategy = perSourceStrategies[r.source.id] ?? globalStrategy
                    const retentionOptions = srcStrategy === 'data-lake-mirror'
                      ? DATA_LAKE_MIRROR_RETENTION_OPTIONS
                      : analyticsTierDef.retentionOptions
                    const currentRetention = retentionDays[r.source.id] ?? 90
                    return (
                      <tr key={r.source.id}>
                        <td className="px-3 py-2 text-light/70 font-medium">{r.source.label}</td>
                        <td className="px-3 py-2 text-right font-mono text-light/60">{r.gbPerDay.toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex justify-center rounded-md border border-white/15 overflow-hidden text-[10px]">
                            <button
                              type="button"
                              onClick={() => onSourceStrategyChange(r.source.id, 'analytics-extended')}
                              className={[
                                'px-2 py-1 transition-colors',
                                srcStrategy === 'analytics-extended'
                                  ? 'bg-primary text-white'
                                  : 'bg-surface text-light/60 hover:bg-white/5',
                              ].join(' ')}
                            >
                              Extended
                            </button>
                            <button
                              type="button"
                              onClick={() => onSourceStrategyChange(r.source.id, 'data-lake-mirror')}
                              className={[
                                'px-2 py-1 border-l border-white/15 transition-colors',
                                srcStrategy === 'data-lake-mirror'
                                  ? 'bg-primary text-white'
                                  : 'bg-surface text-light/60 hover:bg-white/5',
                              ].join(' ')}
                            >
                              Mirror
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <select
                            value={currentRetention}
                            onChange={e => onRetentionChange(r.source.id, Number(e.target.value))}
                            className="text-[10px] border border-white/15 rounded px-1 py-0.5 bg-surface text-light/70 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                          >
                            {retentionOptions.map(days => (
                              <option key={days} value={days}>
                                {fmtRetentionOption(days, 90)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-light/60">
                          {r.retentionMonthlyCostUsd > 0 ? fmtGbp(r.retentionMonthlyCostUsd, 2, fxRate) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
