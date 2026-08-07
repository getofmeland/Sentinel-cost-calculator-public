import { useMemo, useState } from 'react'
import { QueryPanel } from './analyse/QueryPanel'
import { UsagePasteBox } from './analyse/UsagePasteBox'
import { SavingsReport } from './analyse/SavingsReport'
import { analyseUsage } from '../utils/analysis'
import { usePricing } from '../contexts/PricingContext'
import type { ParsedUsage } from '../utils/usageParser'

/**
 * Analyse mode: measure an existing deployment and find savings, as opposed to
 * Estimate mode which prices a deployment that does not exist yet.
 *
 * Everything happens in the browser. Nothing pasted here is transmitted, which
 * matters for an audience who reasonably will not put workspace data into a
 * website.
 */
export function AnalyseMode() {
  const { pricing } = usePricing()
  const [parsed, setParsed] = useState<ParsedUsage | null>(null)

  const result = useMemo(
    () => (parsed ? analyseUsage(parsed, pricing) : null),
    [parsed, pricing],
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-light">Analyse existing ingestion</h2>
        <p className="text-sm text-light/60 mt-0.5 max-w-2xl">
          Measure what you are actually ingesting today and find what it would cost to run it
          better. Your data stays in this browser.
        </p>
      </div>

      <QueryPanel />
      <UsagePasteBox parsed={parsed} onParsed={setParsed} />

      {result
        ? <SavingsReport result={result} />
        : (
          <div className="bg-surface rounded-xl border border-white/10 border-dashed px-6 py-10 text-center">
            <p className="text-sm text-light/60">
              Paste your query results above to see where the money is going.
            </p>
          </div>
        )}
    </div>
  )
}
