import { AZURE_REGION_GROUPS } from '../services/azurePricing'

interface Props {
  region: string
  onRegionChange: (arm: string) => void
  fxRate: number
  onFxRateChange: (rate: number) => void
  isLoading: boolean
  isLive: boolean
  lastFetched: string | null
  onRefresh: () => void
  activePresetId: string
}

const UK_RESIDENCY_PRESETS = new Set(['fca-general', 'fca-mifid2', 'nhs-dspt'])
const UK_REGIONS = new Set(['uksouth', 'ukwest'])

export function RegionSelector({
  region,
  onRegionChange,
  fxRate,
  onFxRateChange,
  isLoading,
  isLive,
  lastFetched,
  onRefresh,
  activePresetId,
}: Props) {
  const showResidencyWarning = UK_RESIDENCY_PRESETS.has(activePresetId) && !UK_REGIONS.has(region)

  const selectedGroup = AZURE_REGION_GROUPS.find(g => g.regions.some(r => r.arm === region))
  const selectedLabel = selectedGroup?.regions.find(r => r.arm === region)?.label ?? region

  return (
    <div className="flex flex-col gap-2">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Region selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="region-select" className="text-xs text-light/70 whitespace-nowrap">
            Region:
          </label>
          <select
            id="region-select"
            value={region}
            onChange={e => onRegionChange(e.target.value)}
            disabled={isLoading}
            className="bg-white/10 border border-white/20 text-light rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60"
          >
            {AZURE_REGION_GROUPS.map(({ group, regions }) => (
              <optgroup key={group} label={group}>
                {regions.map(r => (
                  <option key={r.arm} value={r.arm} className="text-dark bg-surface">
                    {r.label} ({r.arm})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh pricing data"
            title="Refresh live pricing"
            className="w-7 h-7 flex items-center justify-center rounded-md bg-white/10 border border-white/20 text-light hover:bg-white/20 disabled:opacity-40 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {isLoading ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
          </button>
        </div>

        {/* FX rate */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="fx-rate-input" className="text-xs text-light/70 whitespace-nowrap">
            £ GBP rate:
          </label>
          <input
            id="fx-rate-input"
            type="number"
            step={0.01}
            min={0.1}
            max={5}
            value={fxRate}
            onChange={e => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val) && val >= 0.1 && val <= 5) onFxRateChange(val)
            }}
            className="w-20 bg-white/10 border border-white/20 text-light rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
          />
        </div>
      </div>

      {/* Status line */}
      <div className="text-[11px] text-light/60">
        {isLoading ? (
          <span>Fetching live rates for {selectedLabel}…</span>
        ) : isLive && lastFetched ? (
          <span className="text-light/80">Live · Updated {lastFetched}</span>
        ) : (
          <span className="text-accent/80">Using cached rates</span>
        )}
      </div>

      {/* Data residency warning */}
      {showResidencyWarning && (
        <div className="bg-accent/20 border border-accent/40 text-light text-xs px-3 py-2 rounded-md">
          ⚠ Your compliance preset may require UK data residency. Consider UK South or UK West.
        </div>
      )}

      {/* Info note */}
      <p className="text-[10px] text-light/40 max-w-sm">
        Region determines where your Log Analytics workspace and Sentinel data reside. For UK data residency, use UK South or UK West.
      </p>
    </div>
  )
}
