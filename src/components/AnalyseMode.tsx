import { useMemo, useState } from 'react'
import { QueryPanel } from './analyse/QueryPanel'
import { UsagePasteBox } from './analyse/UsagePasteBox'
import { DailyVolumePanel } from './analyse/DailyVolumePanel'
import { LicensingPanel } from './analyse/LicensingPanel'
import { SavingsReport } from './analyse/SavingsReport'
import { analyseUsage, type LicensingInput } from '../utils/analysis'
import { usePricing } from '../contexts/PricingContext'
import type { ParsedUsage } from '../utils/usageParser'
import type { ParsedDailyVolume } from '../utils/dailyVolumeParser'

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
  const [daily, setDaily] = useState<ParsedDailyVolume | null>(null)
  // Defaults grant nothing, so an untouched analysis shows gross cost and can
  // only ever be corrected downwards by supplying real licensing.
  const [licensing, setLicensing] = useState<LicensingInput>({
    licence: 'none', licensedSeats: 0, defenderServersP2Enabled: false, serverCount: 0,
  })

  const result = useMemo(
    () => (parsed ? analyseUsage(parsed, pricing, daily?.analyticsGbByDay, licensing) : null),
    [parsed, daily, licensing, pricing],
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
      {/* A new per-table paste describes a different measurement, so the daily
          series that went with the old one must not carry over. */}
      <UsagePasteBox
        parsed={parsed}
        onParsed={next => { setParsed(next); setDaily(null) }}
      />
      {/* Offered only once there is something to improve — an optional second
          query in front of a first-time user is just another obstacle. */}
      {parsed && <LicensingPanel value={licensing} onChange={setLicensing} />}
      {parsed && <DailyVolumePanel parsed={daily} onParsed={setDaily} />}

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
