import { TierOption } from '../utils/tiers'
import { fmtBoth } from '../utils/currency'

interface Props {
  options: TierOption[]
  billableGbPerDay: number
}

function fmt(usd: number): string {
  return fmtBoth(usd)
}

// C5: Unicode arrows wrapped in aria-hidden; screen-reader text provided via sr-only
function SavingsCell({ pct, isRec }: { pct: number | null; isRec: boolean }) {
  if (pct === null) return <span className={isRec ? 'text-white/50' : 'text-light/40'}>—</span>
  if (pct > 0) {
    return (
      <span className={`font-semibold ${isRec ? 'text-accent' : 'text-primary'}`}>
        <span className="sr-only">Saving </span>
        <span aria-hidden="true">▼ </span>
        {(pct * 100).toFixed(1)}%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-warning/10 rounded text-xs text-light/70 font-medium">
      <span className="sr-only">More expensive than PAYG by </span>
      <span aria-hidden="true">▲ </span>
      {(Math.abs(pct) * 100).toFixed(1)}%
    </span>
  )
}

export function TierTable({ options, billableGbPerDay }: Props) {
  if (billableGbPerDay === 0) {
    return (
      <div className="px-6 py-8 text-center">
        <div className="inline-flex flex-col items-center gap-2 text-light/40">
          <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7h18M3 12h18M3 17h18" />
          </svg>
          <p className="text-sm">Select log sources above to see tier recommendations.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {/* M7: table aria-label so screen readers announce it with context */}
      <table className="w-full text-sm" aria-label="Commitment tier cost comparison">
        <thead>
          <tr className="bg-dark text-xs uppercase tracking-wide text-light/50">
            <th className="px-4 py-3 text-left font-medium">Tier</th>
            <th className="px-4 py-3 text-right font-medium">Committed GB/day</th>
            <th className="px-4 py-3 text-right font-medium">Eff. rate (USD/GB)</th>
            <th className="px-4 py-3 text-right font-medium">Daily cost</th>
            <th className="px-4 py-3 text-right font-medium">Monthly cost</th>
            <th className="px-4 py-3 text-right font-medium">vs PAYG</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {options.map(opt => {
            const isRec = opt.isRecommended

            return (
              <tr
                key={opt.label}
                className={isRec ? 'bg-primary text-white font-semibold' : ''}
              >
                <td className="px-4 py-3">
                  <span className={isRec ? 'text-white' : 'text-light'}>{opt.label}</span>
                  {/* m3: comma separator helps screen readers pause before badge text */}
                  {isRec && (
                    <>
                      <span className="sr-only">, recommended</span>
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-block bg-accent text-dark text-xs px-1.5 py-0.5 rounded font-bold"
                      >
                        Recommended
                      </span>
                    </>
                  )}
                  {opt.tier?.isPreviewPromo && (
                    <>
                      <span className="sr-only">, preview promotion</span>
                      <span
                        aria-hidden="true"
                        className={`ml-2 inline-block text-xs px-1.5 py-0.5 rounded ${isRec ? 'bg-white/20 text-white' : 'bg-accent text-dark'}`}
                      >
                        Promo
                      </span>
                    </>
                  )}
                </td>
                <td className={`px-4 py-3 text-right ${isRec ? 'text-white/80' : 'text-light/60'}`}>
                  {opt.isPayg ? '—' : opt.tier!.gbPerDay.toLocaleString()}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${isRec ? 'text-white/80' : 'text-light/60'}`}>
                  {opt.isPayg
                    ? `$${(5.20).toFixed(2)}`
                    : `$${opt.tier!.effectiveRateUsd.toFixed(2)}`}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${isRec ? 'text-white' : 'text-light/70'}`}>
                  {fmt(opt.dailyCostUsd)}
                </td>
                <td className={`px-4 py-3 text-right font-mono ${isRec ? 'text-white' : 'text-light/70'}`}>
                  {fmt(opt.monthlyCostUsd)}
                </td>
                <td className="px-4 py-3 text-right">
                  <SavingsCell pct={opt.savingsVsPaygPct} isRec={isRec} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
