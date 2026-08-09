import { useState } from 'react'
import { IngestionSummary } from '../utils/ingestion'
import { TierOption, costAtVolume } from '../utils/tiers'
import { DAYS_PER_MONTH } from '../data/pricing'
import { fmtCurrency } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'

interface Props {
  summary: IngestionSummary
  licenceLabel: string
  defenderSavedMonthlyUsd: number
  defenderEnabled: boolean
  e5SavedMonthlyUsd: number
  commitmentOptions: TierOption[]
  /** Analytics GB/day before licence grants are applied */
  analyticsGrossGbPerDay: number
  /** Analytics GB/day after licence grants — what a commitment tier is sized against */
  analyticsNetGbPerDay: number
  /** Opt-in data lake compute (graph + notebooks), monthly USD. Zero unless enabled. */
  computeMonthlyUsd: number
}

function SavingBadge({ pct }: { pct: number }) {
  if (pct <= 0) return <span className="text-light/60">—</span>
  return (
    <span className="inline-flex items-center gap-0.5 text-primary-text font-semibold text-xs">
      <span aria-hidden="true">▼</span>
      <span className="sr-only">Saving </span>
      {pct.toFixed(1)}%
    </span>
  )
}

function CostCell({ usd, highlight, fxRate, displayCurrency, eurRate }: {
  usd: number; highlight?: boolean; fxRate: number; displayCurrency: 'GBP' | 'USD' | 'EUR'; eurRate: number
}) {
  return (
    <td className={`px-4 py-2.5 text-right font-mono text-sm ${highlight ? 'font-bold text-light' : 'text-light/70'}`}>
      {fmtCurrency(usd, displayCurrency, fxRate, eurRate, 0)}
    </td>
  )
}

function SavingCell({ usd, fxRate, displayCurrency, eurRate }: {
  usd: number; fxRate: number; displayCurrency: 'GBP' | 'USD' | 'EUR'; eurRate: number
}) {
  if (usd <= 0) return <td className="px-4 py-2.5 text-right text-light/60 text-sm">—</td>
  return (
    <td className="px-4 py-2.5 text-right font-mono text-sm text-primary-text font-medium">
      −{fmtCurrency(usd, displayCurrency, fxRate, eurRate, 0)}
    </td>
  )
}

export function CostSummary({
  summary,
  licenceLabel,
  defenderSavedMonthlyUsd,
  defenderEnabled,
  e5SavedMonthlyUsd,
  commitmentOptions,
  analyticsGrossGbPerDay,
  analyticsNetGbPerDay,
  computeMonthlyUsd,
}: Props) {
  const { fxRate, displayCurrency, eurRate } = usePricing()
  const tierOptions = commitmentOptions.filter(o => !o.isPayg)
  const recommendedTier = commitmentOptions.find(o => o.isRecommended && !o.isPayg)

  // Null until the user picks a tier explicitly. A useState initialiser runs
  // only on first render — when nothing is selected and no tier is recommended
  // — so seeding from the recommendation froze the dropdown on the smallest
  // tier for the rest of the session while the ★ marker moved without it.
  const [chosenTierLabel, setChosenTierLabel] = useState<string | null>(null)

  const selectedTier =
    (chosenTierLabel !== null ? tierOptions.find(o => o.label === chosenTierLabel) : undefined)
    ?? recommendedTier
    ?? tierOptions[0]
  const selectedTierLabel = selectedTier?.label ?? ''

  function fmt(usd: number) {
    return fmtCurrency(usd, displayCurrency, fxRate, eurRate, 0)
  }

  // ── Monthly base costs ──────────────────────────────────────────────────
  const analyticsMonthly = summary.analyticsDailyCostUsd * DAYS_PER_MONTH
  const dataLakeMonthly  = summary.dataLakeDailyCostUsd  * DAYS_PER_MONTH
  const retentionMonthly = summary.retentionMonthlyCostUsd
  // Compute is independent of ingestion volume and untouched by commitment
  // tiers or licence grants, so it lands identically in all three scenarios.
  const computeMonthly   = computeMonthlyUsd
  const totalPayg        = analyticsMonthly + dataLakeMonthly + retentionMonthly + computeMonthly

  // ── Savings ─────────────────────────────────────────────────────────────
  const totalSavings = defenderSavedMonthlyUsd + e5SavedMonthlyUsd

  // ── Scenario costs ───────────────────────────────────────────────────────
  // Col 1: pure PAYG, no savings
  const paygTotal = totalPayg

  // Col 2: PAYG + licence credits, valued at the PAYG rate
  const withSavingsTotal = Math.max(0, totalPayg - totalSavings)

  // Col 3: commitment tier.
  //
  // The tier is sized on the NET (post-grant) volume, because a licence grant
  // reduces the gigabytes you are billed for and therefore the commitment you
  // need to buy. That means the grant is already reflected in
  // selectedTier.monthlyCostUsd — subtracting its cash value again, as this
  // once did, credited the customer twice and understated the total by the
  // full value of their licence benefit.
  //
  // To keep all three columns readable as "ingestion → credits → total", the
  // ingestion row shows what this tier would cost at the GROSS volume, and the
  // credit rows show what the grant is actually worth at the tier's discounted
  // rate. Those two are consistent by construction, and the credit is genuinely
  // smaller here than under PAYG — a licence grant is worth less once you are
  // already paying a discounted rate, which is worth showing rather than hiding.
  const commitmentGrossMonthly = selectedTier
    ? costAtVolume(selectedTier.tier!, analyticsGrossGbPerDay) * DAYS_PER_MONTH
    : analyticsMonthly
  const commitmentNetMonthly = selectedTier ? selectedTier.monthlyCostUsd : analyticsMonthly
  const commitmentCreditMonthly = Math.max(0, commitmentGrossMonthly - commitmentNetMonthly)

  // Split the tier-rate credit between the two grants in proportion to the
  // gigabytes each contributed, so the rows still add up.
  const grantedGbPerDay = Math.max(0, analyticsGrossGbPerDay - analyticsNetGbPerDay)
  const e5Share = totalSavings > 0 ? e5SavedMonthlyUsd / totalSavings : 0
  const commitmentE5Credit = grantedGbPerDay > 0 ? commitmentCreditMonthly * e5Share : 0
  const commitmentDefenderCredit = grantedGbPerDay > 0 ? commitmentCreditMonthly * (1 - e5Share) : 0

  const commitmentAnalyticsSaving = analyticsMonthly - commitmentGrossMonthly
  const commitmentOptimisedTotal = Math.max(
    0, commitmentNetMonthly + dataLakeMonthly + retentionMonthly + computeMonthly,
  )

  // ── vs-PAYG percentages ──────────────────────────────────────────────────
  const savingsPct    = paygTotal > 0 ? ((paygTotal - withSavingsTotal)    / paygTotal) * 100 : 0
  const optimisedPct  = paygTotal > 0 ? ((paygTotal - commitmentOptimisedTotal) / paygTotal) * 100 : 0

  const isEmpty = summary.rows.length === 0

  if (isEmpty) {
    return (
      <div className="bg-surface rounded-xl border border-white/10 shadow-sm px-6 py-10 text-center">
        <p className="text-sm text-light/60">Select log sources above to see your total cost summary.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-light">Total Monthly Cost Summary</h2>
          <p className="text-sm text-light/50 mt-0.5">
            Compare PAYG baseline against your active savings and commitment tier options.
          </p>
        </div>

        {/* Commitment tier selector */}
        {tierOptions.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label htmlFor="summary-tier-select" className="text-xs text-light/50 whitespace-nowrap">
              Compare tier:
            </label>
            <select
              id="summary-tier-select"
              value={selectedTierLabel}
              onChange={e => setChosenTierLabel(e.target.value)}
              className="text-sm border border-white/15 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-light"
            >
              {tierOptions.map(o => (
                <option key={o.label} value={o.label}>
                  {o.label}{o.isRecommended ? ' ★ Recommended' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Monthly cost scenario comparison">
          <thead>
            <tr className="bg-dark text-xs uppercase tracking-wide text-light/50">
              <th className="px-4 py-3 text-left font-medium">Cost component</th>
              <th className="px-4 py-3 text-right font-medium">PAYG</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="hidden sm:inline">With </span>savings
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {selectedTier ? selectedTier.tier!.gbPerDay.toLocaleString() + ' GB/day' : '—'}
                <span className="hidden sm:inline"> + savings</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">

            {/* Analytics ingestion */}
            <tr>
              <td className="px-4 py-2.5 text-light/70">Analytics ingestion</td>
              <CostCell usd={analyticsMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <CostCell usd={analyticsMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <td className="px-4 py-2.5 text-right font-mono text-sm text-light/70">
                {selectedTier
                  ? <span className="text-primary-text">{fmt(commitmentGrossMonthly)}</span>
                  : fmt(analyticsMonthly)}
                {commitmentAnalyticsSaving > 0 && (
                  <span className="block text-[10px] text-primary-text/70 font-normal">
                    −{fmt(commitmentAnalyticsSaving)} committed
                  </span>
                )}
              </td>
            </tr>

            {/* Data Lake ingestion */}
            <tr>
              <td className="px-4 py-2.5 text-light/70">Data Lake ingestion</td>
              <CostCell usd={dataLakeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <CostCell usd={dataLakeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <CostCell usd={dataLakeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
            </tr>

            {/* Extended retention — three conditional rows */}
            {summary.analyticsExtendedRetentionMonthlyCostUsd > 0 && (
              <tr>
                <td className="px-4 py-2.5 text-light/70">Analytics extended retention</td>
                <CostCell usd={summary.analyticsExtendedRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.analyticsExtendedRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.analyticsExtendedRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              </tr>
            )}
            {summary.dataLakeMirrorRetentionMonthlyCostUsd > 0 && (
              <tr>
                <td className="px-4 py-2.5 text-light/70">Data Lake mirror retention</td>
                <CostCell usd={summary.dataLakeMirrorRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.dataLakeMirrorRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.dataLakeMirrorRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              </tr>
            )}
            {summary.dataLakeNativeRetentionMonthlyCostUsd > 0 && (
              <tr>
                <td className="px-4 py-2.5 text-light/70">Data Lake long-term retention</td>
                <CostCell usd={summary.dataLakeNativeRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.dataLakeNativeRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={summary.dataLakeNativeRetentionMonthlyCostUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              </tr>
            )}

            {/* Opt-in compute — only shown when a meter is actually enabled */}
            {computeMonthly > 0 && (
              <tr>
                <td className="px-4 py-2.5 text-light/70">
                  Data Lake compute
                  <span className="ml-1.5 text-[10px] text-light/60">(opt-in)</span>
                </td>
                <CostCell usd={computeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={computeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
                <CostCell usd={computeMonthly} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              </tr>
            )}

            {/* Divider row — savings */}
            <tr className="bg-dark">
              <td colSpan={4} className="px-4 py-1.5 text-[10px] font-semibold text-light/60 uppercase tracking-wider">
                Savings applied
              </td>
            </tr>

            {/* Defender for Servers saving */}
            <tr>
              <td className="px-4 py-2.5 text-light/70">
                Defender for Servers P2
                {!defenderEnabled && (
                  <span className="ml-1.5 text-[10px] text-light/60">(not enabled)</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-light/60 text-sm">—</td>
              <SavingCell usd={defenderSavedMonthlyUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <SavingCell usd={commitmentDefenderCredit} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
            </tr>

            {/* M365 E5 data grant saving */}
            <tr>
              <td className="px-4 py-2.5 text-light/70">
                M365 E5 data grant (Entra ID &amp; Defender)
                {e5SavedMonthlyUsd === 0 && (
                  <span className="ml-1.5 text-[10px] text-light/60">
                    {licenceLabel === 'None / M365 E1' || licenceLabel === 'Microsoft 365 E3'
                      ? '(no qualifying licence)'
                      : '(no eligible sources)'}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-light/60 text-sm">—</td>
              <SavingCell usd={e5SavedMonthlyUsd} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
              <SavingCell usd={commitmentE5Credit} fxRate={fxRate} displayCurrency={displayCurrency} eurRate={eurRate} />
            </tr>

            {/* Total rows */}
            <tr className="border-t-2 border-white/10 bg-surface-raised">
              <td className="px-4 py-4 font-semibold text-light/50 text-xs uppercase tracking-widest">Monthly total</td>
              <td className="px-4 py-4 text-right">
                <span className="text-2xl font-bold font-mono text-light">{fmt(paygTotal)}</span>
              </td>
              <td className="px-4 py-4 text-right">
                <span className={`text-2xl font-bold font-mono ${totalSavings > 0 ? 'text-primary-text' : 'text-light'}`}>
                  {fmt(withSavingsTotal)}
                </span>
              </td>
              <td className="px-4 py-4 text-right">
                <span className={`text-2xl font-bold font-mono ${optimisedPct > 0 ? 'text-primary-text' : 'text-light'}`}>
                  {fmt(commitmentOptimisedTotal)}
                </span>
                {optimisedPct > 0 && (
                  <span className="ml-2 inline-block bg-accent text-dark text-xs font-bold px-1.5 py-0.5 rounded">
                    ▼ {optimisedPct.toFixed(0)}%
                  </span>
                )}
              </td>
            </tr>

            {/* vs PAYG row */}
            <tr>
              <td className="px-4 py-2 text-xs text-light/60">vs PAYG</td>
              <td className="px-4 py-2 text-right text-xs text-light/60">baseline</td>
              <td className="px-4 py-2 text-right"><SavingBadge pct={savingsPct} /></td>
              <td className="px-4 py-2 text-right"><SavingBadge pct={optimisedPct} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <div className="px-6 py-3 border-t border-white/10 text-[11px] text-light/60 leading-relaxed">
        Licence benefits (E5 data grant and Defender for Servers) are billing credits — all data is still ingested.
        In the PAYG columns they are valued at the PAYG rate; in the commitment column at that tier's discounted rate,
        which is why the credit is smaller there. Each credit is applied once.
        Data Lake and retention costs are unchanged by commitment tier or licence benefits.
        Retention shown as a monthly charge; all other costs derived from daily estimates × {DAYS_PER_MONTH} days.
        These are planning estimates based on public list pricing, not a quote.
      </div>
    </div>
  )
}
