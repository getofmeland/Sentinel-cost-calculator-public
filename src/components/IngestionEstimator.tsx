import { useState, useEffect, useMemo } from 'react'
import { LOG_SOURCES, DAYS_PER_MONTH, RetentionStrategy } from '../data/pricing'
import { GROUP_LABELS, GROUP_ORDER } from '../data/sourceGroups'
import { LogTierKey, DEFAULT_LOG_TIER, getTierDefinition } from '../data/logTiers'
import { M365Licence, LICENCES } from '../data/licenceBenefits'
import { summariseIngestion, estimateSourceGbPerDay, scaledDeviceCount } from '../utils/ingestion'
import { computeLicenceBenefits } from '../utils/licenceBenefits'
import { computeTierOptions } from '../utils/tiers'
import { getDefaultTier } from '../data/tierPlacement'
import { CompliancePresetId, getPreset } from '../data/compliancePresets'
import { TshirtSize, TSHIRT_SIZES, DEFAULT_TSHIRT_SIZE, getSizeMultiplier } from '../data/tshirtSizes'
import { SERVER_WORKLOADS } from '../data/serverWorkloads'
import { computeServerWorkloadRows } from '../utils/serverWorkloads'
import { usePricing } from '../contexts/PricingContext'
import { SourceRow } from './SourceRow'
import { ServerWorkloads } from './ServerWorkloads'
import { IngestionSummaryBar } from './IngestionSummaryBar'
import { TierComparison } from './TierComparison'
import { TierPlacementTab } from './TierPlacementTab'
import { LicenceBenefits } from './LicenceBenefits'
import {
  SEGMENTS, MIN_USERS, MAX_USERS, MXDR_DEFAULT_SOURCE_IDS, segmentForUserCount,
} from '../data/segments'
import { CostSummary } from './CostSummary'
import { StickyTotalBar } from './StickyTotalBar'
import { TabNav } from './TabNav'
import { CompliancePresetBanner } from './CompliancePresetBanner'
import { RetentionStrategyPanel } from './RetentionStrategyPanel'
import { ShareBar } from './ShareBar'
import {
  loadInitialState,
  saveToStorage,
  type ShareableState,
} from '../utils/shareState'
import { buildEstimateCsv, downloadCsv } from '../utils/csvExport'
import { ComputeCostPanel } from './ComputeCostPanel'
import { computeComputeCosts, DEFAULT_COMPUTE_CONFIG, type ComputeConfig } from '../utils/compute'

type TabId = 'ingestion' | 'placement' | 'optimisation' | 'summary'

const TABS = [
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'placement', label: 'Tier Placement' },
  { id: 'optimisation', label: 'Optimisation' },
  { id: 'summary', label: 'Summary' },
] satisfies { id: TabId; label: string }[]

// Range and granularity now come from the selected segment. The absolute bounds
// stay here for validating a typed or restored value against both segments.

interface Props {
  onPresetChange?: (id: CompliancePresetId) => void
}

export function IngestionEstimator({ onPresetChange }: Props) {
  const {
    pricing, fxRate, eurRate, region, regionDisplayName,
    onRegionChange, displayCurrency, onCurrencyChange,
  } = usePricing()
  const [activeTab, setActiveTab] = useState<TabId>('ingestion')

  // A shared link, else the last autosaved estimate, else nothing. Read once on
  // mount so later edits are not fighting the restore.
  const [restored] = useState(() => loadInitialState(window.location.search))

  // ── Ingestion state ────────────────────────────────────────────────────
  const [userCount, setUserCount] = useState<number>(restored?.userCount ?? 500)
  // A first visit opens on the MXDR stack rather than an empty form; a restored
  // link or saved estimate keeps exactly what it carried, including nothing.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(restored?.selectedIds ?? MXDR_DEFAULT_SOURCE_IDS),
  )
  const [inputDisplayValue, setInputDisplayValue] = useState<string>(String(restored?.userCount ?? 500))
  // Derived, not stored — see segments.ts. One figure, one source of truth.
  const activeSegment = segmentForUserCount(userCount)
  const [deviceCounts, setDeviceCounts] = useState<Record<string, number>>(restored?.deviceCounts ?? {})
  const [logTiers, setLogTiers] = useState<Record<string, LogTierKey>>(restored?.logTiers ?? {})
  const [retentionDays, setRetentionDays] = useState<Record<string, number>>(restored?.retentionDays ?? {})
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>(restored?.selectedVariants ?? {})
  const [manualGbValues, setManualGbValues] = useState<Record<string, number>>(restored?.manualGbValues ?? {})

  // ── T-shirt sizing state ───────────────────────────────────────────────
  const [globalSize, setGlobalSize] = useState<TshirtSize>(restored?.globalSize ?? DEFAULT_TSHIRT_SIZE)
  const [sourceSizeOverrides, setSourceSizeOverrides] = useState<Record<string, TshirtSize>>(restored?.sizeOverrides ?? {})

  // ── Server workload state ──────────────────────────────────────────────
  const [serverCounts, setServerCounts] = useState<Record<string, number>>(restored?.serverCounts ?? {})
  const [serverLevels, setServerLevels] = useState<Record<string, string>>(restored?.serverLevels ?? {})
  const [serverSizeOverrides, setServerSizeOverrides] = useState<Record<string, TshirtSize>>({})

  // ── Compliance preset state ────────────────────────────────────────────
  const [activePresetId, setActivePresetId] = useState<CompliancePresetId>(restored?.activePresetId ?? 'custom')
  const [mifidExtended, setMifidExtended] = useState(restored?.mifidExtended ?? false)

  // ── Retention strategy state ───────────────────────────────────────────
  const [globalRetentionStrategy, setGlobalRetentionStrategy] = useState<RetentionStrategy>(
    restored?.globalRetentionStrategy ?? 'data-lake-mirror',
  )
  const [retentionStrategies, setRetentionStrategies] = useState<Record<string, RetentionStrategy>>(
    restored?.retentionStrategies ?? {},
  )

  // ── Savings state (lifted so CostSummary can access them) ──────────────
  const [licence, setLicence] = useState<M365Licence>(restored?.licence ?? 'none')
  const [defenderEnabled, setDefenderEnabled] = useState(restored?.defenderEnabled ?? false)

  // ── Opt-in data lake compute (graph + notebooks) ───────────────────────
  const [computeConfig, setComputeConfig] = useState<ComputeConfig>(
    restored?.compute ?? DEFAULT_COMPUTE_CONFIG,
  )

  // Region and currency live in PricingContext, so push the restored values up
  // once rather than duplicating that state here.
  useEffect(() => {
    if (!restored) return
    if (restored.region !== region) onRegionChange(restored.region)
    if (restored.displayCurrency !== displayCurrency) onCurrencyChange(restored.displayCurrency)
    // Mount-only: this restores a link, it is not a two-way binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Shareable state ────────────────────────────────────────────────────

  const shareableState: ShareableState = useMemo(() => ({
    userCount,
    selectedIds: [...selectedIds],
    globalSize,
    activePresetId,
    mifidExtended,
    globalRetentionStrategy,
    licence,
    defenderEnabled,
    region,
    displayCurrency,
    serverCounts,
    serverLevels,
    deviceCounts,
    logTiers,
    retentionDays,
    selectedVariants,
    manualGbValues,
    sizeOverrides: sourceSizeOverrides,
    retentionStrategies,
    compute: computeConfig,
  }), [
    userCount, selectedIds, globalSize, activePresetId, mifidExtended,
    globalRetentionStrategy, licence, defenderEnabled, region, displayCurrency,
    serverCounts, serverLevels, deviceCounts, logTiers, retentionDays,
    selectedVariants, manualGbValues, sourceSizeOverrides, retentionStrategies,
    computeConfig,
  ])

  // Autosave, debounced so dragging the user slider does not thrash storage.
  useEffect(() => {
    const id = setTimeout(() => saveToStorage(shareableState), 400)
    return () => clearTimeout(id)
  }, [shareableState])

  // ── Derived values ─────────────────────────────────────────────────────

  // Build per-source size multipliers for regular log sources
  const sourceSizeMultipliers: Record<string, number> = {}
  for (const source of LOG_SOURCES) {
    const sz = sourceSizeOverrides[source.id] ?? globalSize
    sourceSizeMultipliers[source.id] = getSizeMultiplier(sz)
  }

  // Compute server workload rows
  // Server workloads share the log sources' tier, retention and strategy state.
  // Their ids (ws-*, lx-*) never collide with LOG_SOURCES ids, so one record
  // covers both — and the Tier Placement tab, which edits these, now actually
  // moves a server workload between tiers instead of writing to state that
  // nothing read.
  const serverRows = computeServerWorkloadRows(
    SERVER_WORKLOADS,
    serverCounts,
    serverLevels,
    serverSizeOverrides,
    globalSize,
    logTiers,
    retentionDays,
    pricing,
    retentionStrategies,
  )

  const summary = summariseIngestion(
    selectedIds, userCount, deviceCounts, logTiers, retentionDays,
    retentionStrategies, selectedVariants, manualGbValues, pricing, fxRate,
    sourceSizeMultipliers,
    serverRows,
  )

  // Total enrolled servers (Windows + Linux) for P2 allowance calculation
  const totalEnrolledServers = SERVER_WORKLOADS.reduce((s, w) => s + (serverCounts[w.id] ?? 0), 0)

  // GB/day breakdown for LicenceBenefits display
  const windowsServerGbPerDay = serverRows
    .filter(r => r.source.p2Eligible === true)
    .reduce((s, r) => s + r.gbPerDay, 0)
  const linuxServerGbPerDay = serverRows
    .filter(r => r.source.p2Eligible === false)
    .reduce((s, r) => s + r.gbPerDay, 0)

  const licenceBenefits = computeLicenceBenefits(
    summary.rows, summary.analyticsGbPerDay, licence,
    userCount, defenderEnabled, totalEnrolledServers, pricing,
  )
  const commitmentOptions = computeTierOptions(licenceBenefits.billableAnalyticsGbPerDay, pricing, fxRate)

  const hasCustomPerSource = Object.keys(retentionStrategies).length > 0

  const analyticsCapWarning =
    activePresetId !== 'custom' &&
    summary.rows.some(
      r => r.logTier === 'analytics' &&
           r.retentionStrategy === 'analytics-extended' &&
           r.retentionDays >= 730
    )

  const licenceLabel = LICENCES.find(l => l.id === licence)?.label ?? licence
  const recommendedAnalyticsRateUsd = commitmentOptions.find(o => o.isRecommended && !o.isPayg)?.tier?.effectiveRateUsd ?? pricing.paygRateUsd

  // Opt-in compute is independent of ingestion volume and of commitment tiers,
  // so it is added identically to every scenario rather than being discounted.
  const computeCosts = computeComputeCosts(computeConfig, pricing)
  const computeMonthly = computeCosts.totalMonthlyUsd

  // ── Sticky bar values ──────────────────────────────────────────────────
  const paygMonthly =
    summary.totalDailyCostUsd * DAYS_PER_MONTH + summary.retentionMonthlyCostUsd + computeMonthly
  const totalSavings = licenceBenefits.totalSavedMonthlyUsd
  const withSavingsMonthly = Math.max(0, paygMonthly - totalSavings)
  const recommendedOption = commitmentOptions.find(o => o.isRecommended && !o.isPayg)

  // computeTierOptions was given billableAnalyticsGbPerDay, which already has
  // the E5 and Defender grants removed, so the commitment cost below reflects
  // them once. Subtracting totalSavings again — as this did — charged the
  // customer's licence benefit to them twice in their favour, understating the
  // headline figure by the full value of the grant.
  const analyticsCommitmentMonthly = recommendedOption
    ? recommendedOption.monthlyCostUsd
    : licenceBenefits.billableAnalyticsGbPerDay * pricing.paygRateUsd * DAYS_PER_MONTH
  const optimisedMonthly = Math.max(
    0,
    analyticsCommitmentMonthly
      + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
      + summary.retentionMonthlyCostUsd
      + computeMonthly,
  )

  // ── Handlers ───────────────────────────────────────────────────────────
  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    setUserCount(val)
    setInputDisplayValue(String(val))
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputDisplayValue(e.target.value)
  }

  function handleInputBlur() {
    const parsed = parseInt(inputDisplayValue, 10)
    if (isNaN(parsed)) {
      setInputDisplayValue(String(userCount))
      return
    }
    // Typed values are clamped to the WHOLE range, not the active segment, so
    // typing 20,000 while on mid-market moves you to enterprise rather than
    // silently truncating to 5,000. Snapping uses the step of whichever segment
    // the value lands in.
    const clamped = Math.min(MAX_USERS, Math.max(MIN_USERS, parsed))
    const target = segmentForUserCount(clamped)
    const snapped = Math.round(clamped / target.step) * target.step
    setUserCount(snapped)
    setInputDisplayValue(String(snapped))
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  function handleGlobalSizeChange(size: TshirtSize) {
    setGlobalSize(size)
    setSourceSizeOverrides({})
    setServerSizeOverrides({})
  }

  function handleSourceSizeChange(id: string, size: TshirtSize) {
    if (size === globalSize) {
      setSourceSizeOverrides(prev => { const next = { ...prev }; delete next[id]; return next })
    } else {
      setSourceSizeOverrides(prev => ({ ...prev, [id]: size }))
    }
  }

  function handleToggle(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        const defaultTier = getDefaultTier(id)
        // The estimator models two paid tiers; 'basic' exists only for
        // Analyse-mode catalogue entries and no estimator source recommends it.
        if (defaultTier === 'analytics' || defaultTier === 'data-lake') {
          setLogTiers(p => ({ ...p, [id]: defaultTier }))
        }
        if (activePresetId !== 'custom') {
          const preset = getPreset(activePresetId)
          const effectiveDays = (activePresetId === 'fca-mifid2' && mifidExtended) ? 2555 : null
          const tier = defaultTier === 'data-lake' ? 'data-lake' : 'analytics'
          const overrides = preset.perSourceStrategyOverrides ?? {}
          const srcOverride = overrides[id]
          if (srcOverride && srcOverride !== globalRetentionStrategy) {
            setRetentionStrategies(p => ({ ...p, [id]: srcOverride }))
          }
          const srcStrategy = srcOverride ?? preset.analyticsRetentionStrategy
          const rawDays = effectiveDays ?? (tier === 'data-lake' ? preset.dataLakeRetentionDays : preset.analyticsRetentionDays)
          const cap = tier === 'data-lake' ? 4380 : (srcStrategy === 'analytics-extended' ? 730 : 4380)
          setRetentionDays(p => ({ ...p, [id]: Math.min(rawDays, cap) }))
        }
      }
      return next
    })
  }

  function handleSelectAll() {
    setSelectedIds(new Set(LOG_SOURCES.map(s => s.id)))
  }

  function handleClearAll() {
    setSelectedIds(new Set())
  }

  function handleDeviceCountChange(id: string, count: number) {
    setDeviceCounts(prev => ({ ...prev, [id]: Math.max(0, count) }))
  }

  function handleLogTierChange(id: string, tier: LogTierKey) {
    setLogTiers(prev => ({ ...prev, [id]: tier }))
    const tierDef = getTierDefinition(tier)
    setRetentionDays(prev => ({ ...prev, [id]: tierDef.freeRetentionDays }))
  }

  function handleRetentionChange(id: string, days: number) {
    setRetentionDays(prev => ({ ...prev, [id]: days }))
    setActivePresetId('custom')
  }

  function handlePresetChange(id: CompliancePresetId) {
    setActivePresetId(id)
    onPresetChange?.(id)
    setMifidExtended(false)
    if (id === 'custom') return

    const preset = getPreset(id)
    const dataLakeTierDef = getTierDefinition('data-lake')

    setGlobalRetentionStrategy(preset.analyticsRetentionStrategy)
    const overrides = preset.perSourceStrategyOverrides ?? {}
    setRetentionStrategies(overrides as Record<string, RetentionStrategy>)

    setRetentionDays(prev => {
      const next = { ...prev }
      for (const sourceId of selectedIds) {
        const tier = (logTiers[sourceId] as LogTierKey | undefined) ?? 'analytics'
        if (tier === 'data-lake') {
          next[sourceId] = Math.min(preset.dataLakeRetentionDays, Math.max(...dataLakeTierDef.retentionOptions))
        } else {
          const srcStrategy = overrides[sourceId] ?? preset.analyticsRetentionStrategy
          const cap = srcStrategy === 'analytics-extended' ? 730 : Math.max(...dataLakeTierDef.retentionOptions)
          next[sourceId] = Math.min(preset.analyticsRetentionDays, cap)
        }
      }
      return next
    })
  }

  function handleMifidExtensionToggle() {
    setMifidExtended(prev => {
      const extended = !prev
      const retentionDaysValue = extended ? 2555 : 1825
      setRetentionDays(prev2 => {
        const next = { ...prev2 }
        for (const sourceId of selectedIds) {
          const tier = (logTiers[sourceId] as LogTierKey | undefined) ?? 'analytics'
          if (tier === 'data-lake') {
            next[sourceId] = retentionDaysValue
          } else {
            const srcStrategy = retentionStrategies[sourceId] ?? globalRetentionStrategy
            if (srcStrategy === 'analytics-extended') {
              next[sourceId] = Math.min(retentionDaysValue, 730)
            } else {
              next[sourceId] = retentionDaysValue
            }
          }
        }
        return next
      })
      return extended
    })
  }

  function handleGlobalStrategyChange(strategy: RetentionStrategy) {
    setGlobalRetentionStrategy(strategy)
    setRetentionStrategies({})
    if (strategy === 'analytics-extended') {
      setRetentionDays(prev => {
        const next = { ...prev }
        for (const id of selectedIds) {
          const tier = (logTiers[id] as LogTierKey | undefined) ?? 'analytics'
          if (tier === 'analytics' && (next[id] ?? 90) > 730) next[id] = 730
        }
        return next
      })
    }
  }

  function handleSourceStrategyChange(id: string, strategy: RetentionStrategy) {
    setRetentionStrategies(prev => ({ ...prev, [id]: strategy }))
    if (strategy === 'analytics-extended') {
      setRetentionDays(prev => {
        const current = prev[id] ?? 90
        return current > 730 ? { ...prev, [id]: 730 } : prev
      })
    }
  }

  function handleVariantChange(id: string, variantId: string) {
    setSelectedVariants(prev => ({ ...prev, [id]: variantId }))
  }

  function handleManualGbChange(id: string, value: number) {
    setManualGbValues(prev => ({ ...prev, [id]: value }))
  }

  const isEmpty = summary.rows.length === 0

  function handleExportCsv() {
    const csv = buildEstimateCsv({
      summary,
      currency: displayCurrency,
      fxRate: displayCurrency === 'GBP' ? fxRate : displayCurrency === 'EUR' ? eurRate : 1,
      paygMonthlyUsd: paygMonthly,
      withSavingsMonthlyUsd: withSavingsMonthly,
      optimisedMonthlyUsd: optimisedMonthly,
      recommendedTierLabel: recommendedOption?.label ?? 'Pay-as-you-go',
      userCount,
      region: regionDisplayName,
      compute: computeCosts,
    })
    downloadCsv(`sentinel-estimate-${userCount}-users.csv`, csv)
  }

  // Ingestion tab content (source list + summary bar)
  const ingestionTabContent = (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      {/* User count section */}
      <div className="px-6 py-4 border-b border-white/10 bg-dark">
        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <label htmlFor="user-count-slider" className="text-sm font-medium text-light">
            User count: <span className="text-primary-text font-semibold">{userCount.toLocaleString()}</span>
          </label>
          {/* Choosing a segment moves the slider to that segment's default. It
              deliberately does not touch the selected sources: a size change
              should not silently discard the estate someone has built up. */}
          <div className="flex rounded-lg border border-white/15 overflow-hidden" role="group" aria-label="Organisation size">
            {SEGMENTS.map(s => {
              const active = s.id === activeSegment.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return
                    setUserCount(s.defaultUsers)
                    setInputDisplayValue(String(s.defaultUsers))
                  }}
                  className={`px-3 py-1.5 text-xs font-medium ${
                    active ? 'bg-primary text-white' : 'bg-surface-raised text-light/70 hover:text-light'
                  }`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input
            id="user-count-slider"
            type="range"
            min={activeSegment.minUsers}
            max={activeSegment.maxUsers}
            step={activeSegment.step}
            value={userCount}
            onChange={handleSliderChange}
            className="flex-1 accent-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
          />
          <input
            type="number"
            min={MIN_USERS}
            max={MAX_USERS}
            step={activeSegment.step}
            value={inputDisplayValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            aria-label="Number of users (type a value)"
            className="w-24 px-2 py-1.5 text-sm border border-white/15 rounded-md text-center font-mono bg-surface-raised text-light focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        <div className="flex justify-between text-xs text-light/60 mt-1">
          <span>{activeSegment.minUsers.toLocaleString()}</span>
          <span>
            {activeSegment.maxUsers.toLocaleString()}
            {activeSegment.id === 'mid-market' && (
              <span className="text-light/60"> — type a larger number for enterprise</span>
            )}
          </span>
        </div>
      </div>

      {/* Environment Profile */}
      <div className="px-6 py-4 border-b border-white/10">
        <p id="profile-label" className="text-[11px] font-semibold text-light/60 uppercase tracking-widest mb-2">
          Environment Profile
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-labelledby="profile-label">
          {TSHIRT_SIZES.map(sz => (
            <button
              key={sz.id}
              type="button"
              aria-pressed={globalSize === sz.id}
              onClick={() => handleGlobalSizeChange(sz.id)}
              className={[
                'text-left px-3 py-2.5 rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                globalSize === sz.id
                  ? 'border-primary bg-primary/[0.06]'
                  : 'border-white/10 bg-surface hover:border-white/20',
              ].join(' ')}
            >
              <div className={`text-xs font-bold ${globalSize === sz.id ? 'text-primary-text' : 'text-light'}`}>
                {sz.id} — {sz.label}
              </div>
              <div className="text-[10px] text-light/60 mt-0.5 leading-snug line-clamp-2">
                {sz.description}
              </div>
            </button>
          ))}
        </div>
        {Object.keys(sourceSizeOverrides).length > 0 && (
          <button
            type="button"
            onClick={() => { setSourceSizeOverrides({}); setServerSizeOverrides({}) }}
            className="mt-2 text-[11px] text-light/50 hover:text-light/70 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
          >
            Reset all sources to {TSHIRT_SIZES.find(s => s.id === globalSize)!.label}
          </button>
        )}

        {/* FCA/PCI profile suggestion */}
        {(activePresetId === 'fca-general' || activePresetId === 'fca-mifid2' || activePresetId === 'pci-dss') &&
          globalSize !== 'L' && globalSize !== 'XL' && (
          <div className="mt-3 px-3 py-2.5 rounded-lg border border-accent/30 bg-accent/5 flex items-center justify-between gap-3">
            <p className="text-[11px] text-light/70 leading-snug">
              FCA-regulated environments typically have enhanced audit policies — consider Active (L) or Verbose (XL).
            </p>
            <button
              type="button"
              onClick={() => handleGlobalSizeChange('L')}
              className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded border border-accent/50 text-accent-text hover:bg-accent/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Apply Active
            </button>
          </div>
        )}
      </div>

      {/* Compliance preset */}
      <div className="px-6 py-3 border-b border-white/10">
        <CompliancePresetBanner
          activePresetId={activePresetId}
          mifidExtended={mifidExtended}
          onPresetChange={handlePresetChange}
          onMifidExtensionToggle={handleMifidExtensionToggle}
          analyticsCapWarning={analyticsCapWarning}
        />
      </div>

      {/* Retention strategy panel */}
      <div className="px-6 py-3 border-b border-white/10">
        <RetentionStrategyPanel
          globalStrategy={globalRetentionStrategy}
          perSourceStrategies={retentionStrategies}
          analyticsRows={summary.rows.filter(r => r.logTier === 'analytics')}
          onGlobalStrategyChange={handleGlobalStrategyChange}
          onSourceStrategyChange={handleSourceStrategyChange}
          onRetentionChange={handleRetentionChange}
          retentionDays={retentionDays}
          hasCustomPerSource={hasCustomPerSource}
        />
      </div>

      {/* Source list */}
      <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-sm font-medium text-light">Log sources</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSelectAll}
            className="text-xs px-2.5 py-1 rounded border border-primary text-primary-text hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs px-2.5 py-1 rounded border border-white/15 text-light/50 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light/40 focus-visible:ring-offset-1"
          >
            Clear all
          </button>
        </div>
      </div>

      <div>
        {GROUP_ORDER.map(group => {
          // Infrastructure group is replaced by the ServerWorkloads component
          if (group === 'infrastructure') {
            return (
              <ServerWorkloads
                key={group}
                workloads={SERVER_WORKLOADS}
                counts={serverCounts}
                levels={serverLevels}
                sizeOverrides={serverSizeOverrides}
                globalSize={globalSize}
                rows={serverRows}
                onCountChange={(id, n) => setServerCounts(prev => ({ ...prev, [id]: Math.max(0, n) }))}
                onLevelChange={(id, level) => setServerLevels(prev => ({ ...prev, [id]: level }))}
                onSizeChange={(id, sz) => {
                  if (sz === globalSize) {
                    setServerSizeOverrides(prev => { const next = { ...prev }; delete next[id]; return next })
                  } else {
                    setServerSizeOverrides(prev => ({ ...prev, [id]: sz }))
                  }
                }}
              />
            )
          }

          const groupSources = LOG_SOURCES.filter(s => s.group === group)
          if (groupSources.length === 0) return null
          return (
            <div key={group}>
              <div className="px-6 py-1.5 bg-dark border-y border-white/10 sticky top-0 z-10">
                <span className="text-[10px] font-semibold text-light/60 uppercase tracking-[0.12em]">
                  {GROUP_LABELS[group]}
                </span>
              </div>
              <ul className="divide-y divide-white/10">
                {groupSources.map(source => {
                  const row = summary.rows.find(r => r.source.id === source.id)
                  // Seeded from user count so the displayed number matches what
                  // the estimate actually uses; an explicit edit still wins.
                  const deviceCount = deviceCounts[source.id] ?? scaledDeviceCount(source, userCount)
                  const variantId = selectedVariants[source.id] ?? source.defaultVariantId
                  const logTier = (logTiers[source.id] as LogTierKey | undefined) ?? DEFAULT_LOG_TIER
                  const tierDef = getTierDefinition(logTier)
                  const retention = retentionDays[source.id] ?? tierDef.freeRetentionDays
                  const effectiveStrategy: RetentionStrategy =
                    (retentionStrategies[source.id] as RetentionStrategy | undefined) ?? globalRetentionStrategy
                  const sz = sourceSizeOverrides[source.id] ?? globalSize
                  return (
                    <SourceRow
                      key={source.id}
                      source={source}
                      isSelected={selectedIds.has(source.id)}
                      gbPerDay={row?.gbPerDay ?? estimateSourceGbPerDay(source, userCount, deviceCount, variantId, manualGbValues[source.id], getSizeMultiplier(sz))}
                      deviceCount={deviceCount}
                      logTier={logTier}
                      retentionDays={retention}
                      retentionMonthlyCostUsd={row?.retentionMonthlyCostUsd ?? 0}
                      retentionStrategy={effectiveStrategy}
                      selectedVariantId={variantId}
                      manualGbValue={manualGbValues[source.id]}
                      size={sz}
                      globalSize={globalSize}
                      onToggle={handleToggle}
                      onDeviceCountChange={handleDeviceCountChange}
                      onLogTierChange={handleLogTierChange}
                      onRetentionChange={handleRetentionChange}
                      onVariantChange={handleVariantChange}
                      onManualGbChange={handleManualGbChange}
                      onSizeChange={handleSourceSizeChange}
                    />
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Summary bar */}
      <div className="px-6 pb-6">
        <IngestionSummaryBar summary={summary} />
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-light">Log Source Ingestion Estimator</h2>
        <p className="text-sm text-light/50 mt-0.5">
          Estimate your daily ingestion volume, configure tier placement, and optimise costs.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <TabNav tabs={TABS} activeTab={activeTab} onChange={id => setActiveTab(id as TabId)} />
        <ShareBar state={shareableState} onExportCsv={handleExportCsv} isEmpty={isEmpty} />
      </div>

      <div id="panel-ingestion" role="tabpanel" aria-labelledby="tab-ingestion" hidden={activeTab !== 'ingestion'}>
        {ingestionTabContent}
      </div>

      <div id="panel-placement" role="tabpanel" aria-labelledby="tab-placement" hidden={activeTab !== 'placement'}>
        <TierPlacementTab
          rows={summary.rows}
          logTiers={logTiers}
          onLogTierChange={handleLogTierChange}
          analyticsGbPerDay={summary.analyticsGbPerDay}
          dataLakeGbPerDay={summary.dataLakeGbPerDay}
          analyticsDailyCostUsd={summary.analyticsDailyCostUsd}
          dataLakeDailyCostUsd={summary.dataLakeDailyCostUsd}
          recommendedAnalyticsRateUsd={recommendedAnalyticsRateUsd}
        />
      </div>

      <div id="panel-optimisation" role="tabpanel" aria-labelledby="tab-optimisation" hidden={activeTab !== 'optimisation'} className="space-y-6">
        <LicenceBenefits
          rows={summary.rows}
          analyticsGbPerDay={summary.analyticsGbPerDay}
          userCount={userCount}
          licence={licence}
          onLicenceChange={setLicence}
          defenderEnabled={defenderEnabled}
          onDefenderEnabledChange={setDefenderEnabled}
          totalEnrolledServers={totalEnrolledServers}
          windowsServerGbPerDay={windowsServerGbPerDay}
          linuxServerGbPerDay={linuxServerGbPerDay}
        />
        <ComputeCostPanel config={computeConfig} onChange={setComputeConfig} />
        <TierComparison
          analyticsGbPerDay={licenceBenefits.billableAnalyticsGbPerDay}
          dataLakeGbPerDay={summary.dataLakeGbPerDay}
        />
      </div>

      <div id="panel-summary" role="tabpanel" aria-labelledby="tab-summary" hidden={activeTab !== 'summary'}>
        <CostSummary
          summary={summary}
          licenceLabel={licenceLabel}
          defenderSavedMonthlyUsd={licenceBenefits.defenderServersSavedMonthlyUsd}
          defenderEnabled={defenderEnabled}
          e5SavedMonthlyUsd={licenceBenefits.e5SavedMonthlyUsd}
          commitmentOptions={commitmentOptions}
          analyticsGrossGbPerDay={summary.analyticsGbPerDay}
          analyticsNetGbPerDay={licenceBenefits.billableAnalyticsGbPerDay}
          computeMonthlyUsd={computeMonthly}
        />
      </div>

      <StickyTotalBar
        paygMonthly={paygMonthly}
        withSavingsMonthly={withSavingsMonthly}
        optimisedMonthly={optimisedMonthly}
        isEmpty={isEmpty}
      />
    </div>
  )
}
