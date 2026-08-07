import { useMemo, useState } from 'react'
import { type AnalysedTable, type AnalysisResult, type Opportunity } from '../../utils/analysis'
import { fmtCurrency } from '../../utils/currency'
import { usePricing } from '../../contexts/PricingContext'
import { TableInfoPopover } from '../TableInfoPopover'

interface Props {
  result: AnalysisResult
}

const KIND_LABEL: Record<Opportunity['kind'], string> = {
  'billed-but-free': 'Misconfiguration',
  'tier-placement': 'Tier placement',
  'basic-plan': 'Basic plan',
  'commitment-tier': 'Commitment tier',
  'operational-data': 'Workspace design',
  'needs-input': 'Needs your input',
}

// Keyed on the union so a new status fails the build here instead of silently
// rendering undefined.
const STATUS_LABEL: Record<AnalysedTable['status'], string> = {
  'ok': '',
  'move-to-lake': 'Move to Data Lake',
  'move-to-basic': 'Move to Basic',
  'should-be-free': 'Should be free',
  'needs-input': 'Ambiguous',
  'unclassified': 'Unrecognised',
}

/**
 * Step three: what it found.
 *
 * Two things this deliberately does not do — claim a saving it cannot
 * substantiate, and hide volume it could not classify. Both would make the
 * headline number bigger and the advice worse.
 */
export function SavingsReport({ result }: Props) {
  const { fxRate, eurRate, displayCurrency } = usePricing()
  const [filter, setFilter] = useState('')
  const [unknownOnly, setUnknownOnly] = useState(false)

  const visibleTables = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return result.tables.filter(t => {
      if (unknownOnly && t.status !== 'unclassified') return false
      if (!q) return true
      // Match the table name or the source it resolves to, so searching
      // "firewall" finds CommonSecurityLog.
      return t.tableName.toLowerCase().includes(q)
        || (t.match?.sourceIds ?? []).some(s => s.toLowerCase().includes(q))
    })
  }, [result.tables, filter, unknownOnly])
  const money = (usd: number, decimals = 0) =>
    fmtCurrency(usd, displayCurrency, fxRate, eurRate, decimals)

  const savingPct = result.currentMonthlyUsd > 0
    ? Math.round((result.totalAddressableSavingUsd / result.currentMonthlyUsd) * 100)
    : 0

  const substantiated = result.opportunities.filter(o => !o.needsUserInput)
  const questions = result.opportunities.filter(o => o.needsUserInput)

  return (
    <div className="space-y-6">
      {/* ── Headline ────────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-light">3. What we found</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-light/60 uppercase tracking-widest">Current spend</p>
            <p className="text-2xl font-bold font-mono text-light mt-1">
              {money(result.currentMonthlyUsd)}
              <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
            </p>
            <p className="text-[11px] text-light/60 mt-1">Measured ingestion only</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-light/60 uppercase tracking-widest">Identified saving</p>
            <p className="text-2xl font-bold font-mono text-primary-text mt-1">
              {money(result.totalAddressableSavingUsd)}
              <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
            </p>
            {savingPct > 0 && (
              <p className="text-[11px] text-light/60 mt-1">{savingPct}% of current spend</p>
            )}
          </div>
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-light/60 uppercase tracking-widest">By plan</p>
            <dl className="mt-1 text-xs text-light/70 space-y-0.5">
              <div className="flex justify-between gap-3">
                <dt>Analytics</dt><dd className="font-mono text-light">{money(result.analyticsMonthlyUsd)}</dd>
              </div>
              {result.basicMonthlyUsd > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>Basic</dt><dd className="font-mono text-light">{money(result.basicMonthlyUsd)}</dd>
                </div>
              )}
              {result.auxiliaryMonthlyUsd > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>Auxiliary / Lake</dt><dd className="font-mono text-light">{money(result.auxiliaryMonthlyUsd)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>

      {/* ── Opportunities ───────────────────────────────────────────────── */}
      {substantiated.length > 0 && (
        <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold text-light">
              Opportunities, largest first
            </h3>
            <p className="text-xs text-light/60 mt-0.5">
              Applied in this order. Each is measured against what the previous one leaves, so the
              figures add up rather than counting the same gigabytes twice.
            </p>
          </div>
          <ol className="divide-y divide-white/10">
            {substantiated.map((o, i) => (
              <li key={o.kind} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-light/60">{i + 1}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary-text font-medium uppercase tracking-wide">
                        {KIND_LABEL[o.kind]}
                      </span>
                      <span className="text-sm font-medium text-light">{o.title}</span>
                    </div>
                    <p className="text-xs text-light/60 mt-1.5 max-w-2xl">{o.detail}</p>
                    {o.tables.length > 0 && (
                      <p className="text-[11px] font-mono text-light/60 mt-1.5">
                        {o.tables.slice(0, 6).join(', ')}
                        {o.tables.length > 6 && ` and ${o.tables.length - 6} more`}
                      </p>
                    )}
                  </div>
                  <span className="text-lg font-bold font-mono text-primary-text flex-shrink-0">
                    {money(o.monthlySavingUsd)}
                    <span className="text-[10px] font-normal text-light/60 ml-1">/mo</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Things we will not guess about ──────────────────────────────── */}
      {questions.map(o => (
        <div key={o.kind} className="rounded-xl border border-warning/40 bg-warning/10 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-light">{o.title}</p>
            {o.contextUsd !== undefined && o.contextUsd > 0 && (
              <span className="text-sm font-mono font-semibold text-light flex-shrink-0">
                {money(o.contextUsd)}<span className="text-[10px] font-normal text-light/70 ml-1">/mo at stake</span>
              </span>
            )}
          </div>
          <p className="text-xs text-light/80 mt-1 max-w-2xl">{o.detail}</p>
          <p className="text-[11px] font-mono text-light/70 mt-2">{o.tables.join(', ')}</p>
        </div>
      ))}

      {/* ── Volume excluded from advice ─────────────────────────────────── */}
      {result.unclassifiedTableCount > 0 && (
        <div className="rounded-xl border border-white/10 bg-surface px-6 py-4">
          <p className="text-sm font-medium text-light">
            {result.unclassifiedTableCount} table{result.unclassifiedTableCount === 1 ? '' : 's'} not
            recognised — {money(result.unclassifiedMonthlyUsd)}/mo
          </p>
          <p className="text-xs text-light/60 mt-1 max-w-2xl">
            Custom tables and non-security data the calculator does not model. They are counted in
            your current spend above but excluded from the recommendations, because we have no basis
            for advising on data we cannot identify. That is{' '}
            {result.unclassifiedGbPerDay.toLocaleString('en-GB', { maximumFractionDigits: 1 })} GB/day.
          </p>
        </div>
      )}

      {/* ── Per-table breakdown ─────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
        <div className="px-6 py-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-light">Every table, by cost</h3>
            <p className="text-xs text-light/60 mt-0.5">
              Recognised tables carry an ⓘ explaining what produces them and why they get their
              recommendation.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <label htmlFor="table-filter" className="sr-only">Filter tables</label>
            <input
              id="table-filter"
              type="search"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter tables…"
              className="w-44 bg-surface-raised border border-white/15 text-light rounded-md px-2.5 py-1.5 text-xs placeholder:text-light/60 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setUnknownOnly(v => !v)}
              aria-pressed={unknownOnly}
              className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                unknownOnly
                  ? 'bg-primary text-white border-primary font-medium'
                  : 'border-white/15 text-light/70 hover:bg-white/10'
              }`}
            >
              Unrecognised only
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Ingestion and cost by table">
            <thead>
              <tr className="bg-dark text-xs uppercase tracking-wide text-light/60">
                <th className="px-4 py-2.5 text-left font-medium">Table</th>
                <th className="px-4 py-2.5 text-left font-medium">Plan</th>
                <th className="px-4 py-2.5 text-right font-medium">GB/day</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost/mo</th>
                <th className="px-4 py-2.5 text-left font-medium">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {visibleTables.map(t => (
                <tr key={t.tableName + t.plan}>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-xs text-light">{t.tableName}</span>
                      {/* Reuses the source reference already built for Estimate
                          mode: description, connector, sample KQL and doc link. */}
                      {t.match?.sourceIds[0] && (
                        <TableInfoPopover
                          sourceId={t.match.sourceIds[0]}
                          sourceName={t.tableName}
                        />
                      )}
                    </span>
                    {t.match?.reason && (
                      <p className="text-[10px] text-light/60 mt-0.5 max-w-md">{t.match.reason}</p>
                    )}
                    {t.match?.caveat && (
                      <p className="text-[10px] text-accent-text mt-0.5 max-w-md">⚠ {t.match.caveat}</p>
                    )}
                    {/* Not catalogued. Attribution first — which connector writes
                        the table is documented fact, so it outranks anything
                        inferred from the name. Neither yields a tier. */}
                    {!t.match && t.attribution && t.attribution.connectors.length > 0 && (
                      <p className="text-[10px] text-light/60 mt-0.5 max-w-md">
                        <span className="text-light/80">
                          From {t.attribution.connectors.join(', ')}.
                        </span>{' '}
                        {t.attribution.customSchema
                          ? 'Custom-schema table. We do not hold verified billing or Lake-plan detail for it, so no tier is suggested.'
                          : 'Not yet catalogued, so no tier is suggested.'}
                      </p>
                    )}
                    {!t.match && !t.attribution && t.guess && (
                      <p className="text-[10px] text-light/60 mt-0.5 max-w-md">
                        <span className="text-light/80">Likely {t.guess.label}.</span> {t.guess.note}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-light/70">{t.plan}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-light/70">
                    {t.billableGbPerDay.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-light/70">
                    {money(t.monthlyCostUsd)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {t.status === 'ok' ? (
                      <span className="text-light/60">—</span>
                    ) : (
                      <span
                        className={
                          t.status === 'should-be-free' ? 'text-accent-text font-medium'
                            : t.status === 'move-to-lake' || t.status === 'move-to-basic' ? 'text-primary-text font-medium'
                              : 'text-light/70'
                        }
                      >
                        {t.status === 'unclassified'
                          ? (t.attribution?.connectors[0] ?? t.guess?.label ?? STATUS_LABEL[t.status])
                          : STATUS_LABEL[t.status]}
                        {t.potentialSavingUsd > 0 && ` · ${money(t.potentialSavingUsd)}/mo`}
                        {t.match && !t.match.lakeCapable && t.match.recommendation === 'analytics'
                          && <span className="block text-[10px] text-light/60">Lake plan not supported</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visibleTables.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-light/60">
                    No tables match that filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 border-t border-white/10 text-[11px] text-light/60 leading-relaxed">
          Costs use current list pricing for your selected region, applied to your measured volume.
          Commitment tiers cover Analytics-plan volume only — Basic and Auxiliary are billed at flat
          rates. Savings shown for plan moves are on ingestion only: Basic and Lake queries are
          billed per GB scanned, and that usage — like per-table retention — is not measurable from
          this query, so it is not included here.
        </p>
      </div>
    </div>
  )
}
