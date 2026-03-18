import { LogSource, RetentionStrategy, DATA_LAKE_MIRROR_RETENTION_OPTIONS } from '../data/pricing'
import { LogTierKey, getTierDefinition } from '../data/logTiers'
import { fmtGbp } from '../utils/currency'
import { fmtRetentionOption } from '../utils/retention'
import { TshirtSize, TSHIRT_SIZES } from '../data/tshirtSizes'
import { TableInfoPopover } from './TableInfoPopover'

interface SourceRowProps {
  source: LogSource
  isSelected: boolean
  gbPerDay: number
  deviceCount: number
  logTier: LogTierKey
  retentionDays: number
  retentionMonthlyCostUsd: number
  retentionStrategy: RetentionStrategy
  selectedVariantId?: string
  manualGbValue?: number
  size: TshirtSize
  globalSize: TshirtSize
  onToggle: (id: string) => void
  onDeviceCountChange: (id: string, count: number) => void
  /** Kept for compatibility — tier changes are handled in TierPlacementTab */
  onLogTierChange?: (id: string, tier: LogTierKey) => void
  onRetentionChange: (id: string, days: number) => void
  onVariantChange: (id: string, variantId: string) => void
  onManualGbChange: (id: string, value: number) => void
  onSizeChange: (id: string, size: TshirtSize) => void
}

export function SourceRow({
  source,
  isSelected,
  gbPerDay,
  deviceCount,
  logTier,
  retentionDays,
  retentionMonthlyCostUsd,
  retentionStrategy,
  selectedVariantId,
  manualGbValue,
  size,
  globalSize,
  onToggle,
  onDeviceCountChange,
  onRetentionChange,
  onVariantChange,
  onManualGbChange,
  onSizeChange,
}: SourceRowProps) {
  const checkboxId = `source-${source.id}`
  const tierDef = getTierDefinition(logTier)
  const activeVariantId = selectedVariantId ?? source.defaultVariantId

  const retentionOptions =
    logTier === 'analytics' && retentionStrategy === 'data-lake-mirror'
      ? DATA_LAKE_MIRROR_RETENTION_OPTIONS
      : tierDef.retentionOptions
  const freeWindowDays = logTier === 'analytics' ? 90 : tierDef.freeRetentionDays

  function handleDeviceInput(raw: string) {
    const parsed = parseInt(raw, 10)
    if (!isNaN(parsed)) {
      onDeviceCountChange(source.id, Math.max(0, parsed))
    }
  }

  function handleManualInput(raw: string) {
    const parsed = parseFloat(raw)
    if (!isNaN(parsed)) {
      onManualGbChange(source.id, Math.max(0, parsed))
    }
  }

  return (
    <li
      className={`transition-colors ${
        isSelected
          ? 'bg-primary/10 border-l-4 border-primary'
          : 'border-l-4 border-transparent'
      }`}
    >
      {/* ── Top row ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-4 pt-3 pb-2">
        <label
          htmlFor={checkboxId}
          className="flex items-start gap-3 cursor-pointer select-none flex-1 min-w-0"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(source.id)}
            className="mt-0.5 h-4 w-4 accent-primary cursor-pointer flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-light">{source.label}</span>
              <TableInfoPopover sourceId={source.id} sourceName={source.label} />
              {size !== globalSize && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                  Custom
                </span>
              )}
              {source.isFree && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                  Free
                </span>
              )}
              {source.coveredByDefenderXdr && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-light font-medium">
                  XDR covered
                </span>
              )}
              {logTier === 'analytics' && retentionStrategy === 'analytics-extended' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">Extended</span>
              )}
            </div>
            {source.notes && (
              <p className="text-xs text-light/50 mt-0.5">{source.notes}</p>
            )}
          </div>
        </label>

        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          {source.scaleBy === 'devices' && (
            <span className="text-xs text-light/40 font-mono">
              {deviceCount} {source.deviceLabel}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`text-sm font-mono ${isSelected ? 'text-light' : 'text-light/40'}`}
          >
            {gbPerDay.toFixed(2)} GB/day
          </span>
        </div>
      </div>

      {/* ── Expanded controls when selected ────────────────────────────────── */}
      {isSelected && (
        <div className="mx-4 mb-3 ml-11 rounded-lg border border-white/10 bg-[#252838] p-3 flex flex-col gap-3">

          {/* Volume profile (S/M/L/XL) */}
          {!source.manualGbPerDay && (
            <div>
              <span className="text-[10px] font-semibold text-light/40 uppercase tracking-widest block mb-1.5">
                Volume profile
              </span>
              <div role="group" aria-label="Volume profile" className="flex gap-0.5">
                {TSHIRT_SIZES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={size === s.id}
                    title={s.description}
                    onClick={() => onSizeChange(source.id, s.id)}
                    className={[
                      'px-2 py-1 text-xs rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      size === s.id
                        ? 'bg-primary text-white border-primary'
                        : 'border-white/15 text-light/60 hover:bg-white/5',
                    ].join(' ')}
                  >
                    {s.id}
                  </button>
                ))}
                <span className="ml-2 text-[11px] text-light/40 self-center">
                  {TSHIRT_SIZES.find(s => s.id === size)?.label}
                </span>
              </div>
            </div>
          )}

          {/* Variant selector — shown when source has presets */}
          {source.variants && source.variants.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-light/40 uppercase tracking-widest block mb-1.5">
                Profile
              </span>
              <div role="group" aria-label="Volume profile" className="flex flex-wrap gap-1.5">
                {source.variants.map(variant => {
                  const isActive = activeVariantId === variant.id
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => onVariantChange(source.id, variant.id)}
                      aria-pressed={isActive}
                      title={variant.description}
                      className={[
                        'px-2.5 py-1 text-xs rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        isActive
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-light/60 border-white/15 hover:bg-white/5',
                      ].join(' ')}
                    >
                      {variant.label}
                      {variant.description && (
                        <span className={`ml-1 text-[10px] ${isActive ? 'opacity-80' : 'text-light/40'}`}>
                          — {variant.description}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Left col: manual GB/day input OR device count stepper */}
          {source.manualGbPerDay ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-light/40 uppercase tracking-widest">
                Daily volume
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={manualGbValue ?? 0}
                  onChange={e => handleManualInput(e.target.value)}
                  aria-label="Daily ingestion in GB"
                  className="w-20 px-2 py-1 text-sm font-mono text-center border border-white/15 rounded bg-surface text-light focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <span className="text-xs text-light/50">GB/day</span>
              </div>
            </div>
          ) : source.scaleBy === 'devices' ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-light/40 uppercase tracking-widest">
                {source.deviceLabel}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onDeviceCountChange(source.id, Math.max(0, deviceCount - 1))}
                  disabled={deviceCount <= 0}
                  aria-label={`Decrease ${source.deviceLabel} count`}
                  className="w-7 h-7 flex items-center justify-center rounded border border-white/15 bg-surface text-light/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={deviceCount}
                  onChange={e => handleDeviceInput(e.target.value)}
                  aria-label={`Number of ${source.deviceLabel}`}
                  className="w-16 px-1 py-1 text-sm font-mono text-center border border-white/15 rounded bg-surface text-light focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => onDeviceCountChange(source.id, deviceCount + 1)}
                  aria-label={`Increase ${source.deviceLabel} count`}
                  className="w-7 h-7 flex items-center justify-center rounded border border-white/15 bg-surface text-light/60 hover:bg-white/10 text-sm leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  +
                </button>
              </div>
            </div>
          ) : null}

          {/* Right col (or full width if no devices/manual): retention */}
          {!source.isFree && (
            <div className={`flex flex-col gap-2 ${!source.manualGbPerDay && source.scaleBy !== 'devices' ? 'sm:col-span-2' : ''}`}>
              {/* Retention */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`retention-${source.id}`}
                  className="text-[10px] font-semibold text-light/40 uppercase tracking-widest whitespace-nowrap"
                >
                  Retention
                </label>
                <select
                  id={`retention-${source.id}`}
                  value={retentionDays}
                  onChange={e => onRetentionChange(source.id, Number(e.target.value))}
                  className="text-xs border border-white/15 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-light/70"
                >
                  {retentionOptions.map(days => (
                    <option key={days} value={days}>
                      {fmtRetentionOption(days, freeWindowDays)}
                    </option>
                  ))}
                </select>
                {retentionMonthlyCostUsd > 0 && (
                  <span className="text-[10px] font-medium text-warning">
                    +{fmtGbp(retentionMonthlyCostUsd, 2)}/mo
                  </span>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </li>
  )
}
