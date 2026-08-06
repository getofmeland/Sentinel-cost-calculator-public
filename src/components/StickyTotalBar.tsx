import { fmtCurrency } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'
import brand from '../config/brand'

interface Props {
  paygMonthly: number
  withSavingsMonthly: number
  optimisedMonthly: number
  isEmpty: boolean
}

export function StickyTotalBar({ paygMonthly, withSavingsMonthly, optimisedMonthly, isEmpty }: Props) {
  const { displayCurrency, fxRate, eurRate } = usePricing()
  const savingsPct = paygMonthly > 0
    ? Math.round(((paygMonthly - optimisedMonthly) / paygMonthly) * 100)
    : 0

  function fmt(usd: number) {
    return fmtCurrency(usd, displayCurrency, fxRate, eurRate, 0)
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 shadow-2xl"
      style={{ background: brand.colours.dark }}
    >
      <div className="max-w-5xl mx-auto px-6 py-3">
        {isEmpty ? (
          <p className="text-center text-sm text-light/60 py-0.5">
            Select log sources above to see your cost estimate
          </p>
        ) : (
          // Announced politely so a screen-reader user hears the totals change
          // when they adjust an input, rather than having to navigate back to
          // the bar after every interaction.
          <div
            className="flex flex-col sm:flex-row items-center gap-2 sm:gap-0"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >

            {/* PAYG */}
            <div className="flex-1 flex flex-col items-center sm:items-start">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/60">
                PAYG baseline
              </span>
              <span className="text-xl font-bold font-mono text-light/60">
                {fmt(paygMonthly)}
                <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="hidden sm:flex items-center px-3 text-light/20 text-lg" aria-hidden="true">›</div>

            {/* After savings */}
            <div className="flex-1 flex flex-col items-center">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/60">
                After savings
              </span>
              <span className={`text-xl font-bold font-mono ${withSavingsMonthly < paygMonthly ? 'text-primary-text' : 'text-light/60'}`}>
                {fmt(withSavingsMonthly)}
                <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="hidden sm:flex items-center px-3 text-light/20 text-lg" aria-hidden="true">›</div>

            {/* Optimised */}
            <div className="flex-1 flex flex-col items-center sm:items-end">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/60">
                Best case
              </span>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-bold font-mono ${optimisedMonthly < paygMonthly ? 'text-accent-text' : 'text-light/60'}`}>
                  {fmt(optimisedMonthly)}
                  <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
                </span>
                {savingsPct > 0 && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-accent text-dark">
                    <span className="sr-only">Saving </span>
                    <span aria-hidden="true">▼ </span>{savingsPct}%
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {!isEmpty && (
          <p className="mt-1.5 text-center text-[10px] text-light/60">
            Planning estimates based on public Azure list pricing — not a quote. Actual invoices vary
            with negotiated rates, region and real ingestion.
          </p>
        )}
      </div>
    </div>
  )
}
