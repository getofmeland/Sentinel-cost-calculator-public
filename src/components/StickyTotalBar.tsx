import { fmtGbp } from '../utils/currency'

interface Props {
  paygMonthly: number
  withSavingsMonthly: number
  optimisedMonthly: number
  isEmpty: boolean
}

export function StickyTotalBar({ paygMonthly, withSavingsMonthly, optimisedMonthly, isEmpty }: Props) {
  const savingsPct = paygMonthly > 0
    ? Math.round(((paygMonthly - optimisedMonthly) / paygMonthly) * 100)
    : 0

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 shadow-2xl"
      style={{ background: '#191c26' }}
    >
      <div className="max-w-5xl mx-auto px-6 py-3">
        {isEmpty ? (
          <p className="text-center text-sm text-light/30 py-0.5">
            Select log sources above to see your cost estimate
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-0">

            {/* PAYG */}
            <div className="flex-1 flex flex-col items-center sm:items-start">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/40">
                PAYG baseline
              </span>
              <span className="text-xl font-bold font-mono text-light/60">
                {fmtGbp(paygMonthly, 0)}
                <span className="text-xs font-normal text-light/30 ml-1">/mo</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="hidden sm:flex items-center px-3 text-light/20 text-lg" aria-hidden="true">›</div>

            {/* After savings */}
            <div className="flex-1 flex flex-col items-center">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/40">
                After savings
              </span>
              <span className={`text-xl font-bold font-mono ${withSavingsMonthly < paygMonthly ? 'text-primary' : 'text-light/60'}`}>
                {fmtGbp(withSavingsMonthly, 0)}
                <span className="text-xs font-normal text-light/30 ml-1">/mo</span>
              </span>
            </div>

            {/* Arrow */}
            <div className="hidden sm:flex items-center px-3 text-light/20 text-lg" aria-hidden="true">›</div>

            {/* Optimised */}
            <div className="flex-1 flex flex-col items-center sm:items-end">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-light/40">
                Best case
              </span>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-bold font-mono ${optimisedMonthly < paygMonthly ? 'text-accent' : 'text-light/60'}`}>
                  {fmtGbp(optimisedMonthly, 0)}
                  <span className="text-xs font-normal text-light/30 ml-1">/mo</span>
                </span>
                {savingsPct > 0 && (
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-accent text-dark">
                    ▼ {savingsPct}%
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
