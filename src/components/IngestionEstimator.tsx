import { useState } from 'react'
import { LOG_SOURCES, LogSourceGroup, DAYS_PER_MONTH, RetentionStrategy } from '../data/pricing'
import { LogTierKey, DEFAULT_LOG_TIER, getTierDefinition } from '../data/logTiers'
import { M365Licence, LICENCES } from '../data/licenceBenefits'
import { summariseIngestion, estimateSourceGbPerDay } from '../utils/ingestion'
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
import { CostSummary } from './CostSummary'
import { StickyTotalBar } from './StickyTotalBar'
import { TabNav } from './TabNav'
import { CompliancePresetBanner } from './CompliancePresetBanner'
import { RetentionStrategyPanel } from './RetentionStrategyPanel'

const GROUP_LABELS: Record<LogSourceGroup, string> = {
  'identity': 'Identity & Entra',
  'microsoft-defender': 'Microsoft Defender',
  'microsoft-365': 'Microsoft 365',
  'azure-platform': 'Azure Platform',
  'network': 'Network',
  'infrastructure': 'Server Workloads',
  'third-party': 'Third-party & Custom',
}

const GROUP_ORDER: LogSourceGroup[] = [
  'identity',
  'microsoft-defender',
  'microsoft-365',
  'azure-platform',
  'network',
  'infrastructure',
  'third-party',
]

type TabId = 'ingestion' | 'placement' | 'optimisation' | 'summary'

const TABS = [
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'placement', label: 'Tier Placement' },
  { id: 'optimisation', label: 'Optimisation' },
  { id: 'summary', label: 'Summary' },
] satisfies { id: TabId; label: string }[]

const MIN_USERS = 100
const MAX_USERS = 2000
const STEP = 50

interface Props {
  onPresetChange?: (id: CompliancePresetId) => void
}

export function IngestionEstimator({ onPresetChange }: Props) {
  const { pricing, fxRate } = usePricing()
  const [activeTab, setActiveTab] = useState<TabId>('ingestion')

  // ── Ingestion state ────────────────────────────────────────────────────
  const [userCount, setUserCount] = useState<number>(500)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [inputDisplayValue, setInputDisplayValue] = useState<string>('500')
  const [deviceCounts, setDeviceCounts] = useState<Record<string, number>>({})
  const [logTiers, setLogTiers] = useState<Record<string, LogTierKey>>({})
  const [retentionDays, setRetentionDays] = useState<Record<string, number>>({})
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({})
  const [manualGbValues, setManualGbValues] = useState<Record<string, number>>({})

  // ── T-shirt sizing state ───────────────────────────────────────────────
  const [globalSize, setGlobalSize] = useState<TshirtSize>(DEFAULT_TSHIRT_SIZE)
  const [sourceSizeOverrides, setSourceSizeOverrides] = useState<Record<string, TshirtSize>>({})

  // ── Server workload state ──────────────────────────────────────────────
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({})
  const [serverLevels, setServerLevels] = useState<Record<string, string>>({})
  const [serverSizeOverrides, setServerSizeOverrides] = useState<Record<string, TshirtSize>>({})
  const [serverLogTiers] = useState<Record<string, LogTierKey>>({})
  const [serverRetentionDays] = useState<Record<string, number>>({})

  // ── Compliance preset state ────────────────────────────────────────────
  const [activePresetId, setActivePresetId] = useState<CompliancePresetId>('custom')
  const [mifidExtended, setMifidExtended] = useState(false)

  // ── Retention strategy state ───────────────────────────────────────────
  const [globalRetentionStrategy, setGlobalRetentionStrategy] = useState<RetentionStrategy>('data-lake-mirror')
  const [retentionStrategies, setRetentionStrategies] = useState<Record<string, RetentionStrategy>>({})

  // ── Savings state (lifted so CostSummary can access them) ──────────────
  const [licence, setLicence] = useState<M365Licence>('none')
  const [defenderEnabled, setDefenderEnabled] = useState(false)

  // ── Derived values ─────────────────────────────────────────────────────

  // Build per-source size multipliers for regular log sources
  const sourceSizeMultipliers: Record<string, number> = {}
  for (const source of LOG_SOURCES) {
    const sz = sourceSizeOverrides[source.id] ?? globalSize
    sourceSizeMultipliers[source.id] = getSizeMultiplier(sz)
  }

  // Compute server workload rows
  const serverRows = computeServerWorkloadRows(
    SERVER_WORKLOADS,
    serverCounts,
    serverLevels,
    serverSizeOverrides,
    globalSize,
    serverLogTiers,
    serverRetentionDays,
    pricing,
    fxRate,
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

  // ── Sticky bar values ──────────────────────────────────────────────────
  const paygMonthly = summary.totalDailyCostUsd * DAYS_PER_MONTH + summary.retentionMonthlyCostUsd
  const totalSavings = licenceBenefits.totalSavedMonthlyUsd
  const withSavingsMonthly = Math.max(0, paygMonthly - totalSavings)
  const recommendedOption = commitmentOptions.find(o => o.isRecommended && !o.isPayg)
  const analyticsCommitmentMonthly = recommendedOption
    ? recommendedOption.monthlyCostUsd
    : summary.analyticsDailyCostUsd * DAYS_PER_MONTH
  const optimisedMonthly = Math.max(
    0,
    analyticsCommitmentMonthly
      + summary.dataLakeDailyCostUsd * DAYS_PER_MONTH
      + summary.retentionMonthlyCostUsd
      - totalSavings,
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
    const clamped = Math.min(MAX_USERS, Math.max(MIN_USERS, parsed))
    const snapped = Math.round(clamped / STEP) * STEP
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
        if (defaultTier !== 'free') {
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

  // Ingestion tab content (source list + summary bar)
  const ingestionTabContent = (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      {/* User count section */}
      <div className="px-6 py-4 border-b border-white/10 bg-dark">
        <label htmlFor="user-count-slider" className="block text-sm font-medium text-light mb-3">
          User count: <span className="text-primary font-semibold">{userCount.toLocaleString()}</span>
        </label>
        <div className="flex items-center gap-4">
          <input
            id="user-count-slider"
            type="range"
            min={MIN_USERS}
            max={MAX_USERS}
            step={STEP}
            value={userCount}
            onChange={handleSliderChange}
            className="flex-1 accent-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
          />
          <input
            type="number"
            min={MIN_USERS}
            max={MAX_USERS}
            step={STEP}
            value={inputDisplayValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            aria-label="Number of users (type a value)"
            className="w-24 px-2 py-1.5 text-sm border border-white/15 rounded-md text-center font-mono bg-[#252838] text-light focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        <div className="flex justify-between text-xs text-light/40 mt-1">
          <span>{MIN_USERS.toLocaleString()}</span>
          <span>{MAX_USERS.toLocaleString()}</span>
        </div>
      </div>

      {/* Environment Profile */}
      <div className="px-6 py-4 border-b border-white/10">
        <p id="profile-label" className="text-[11px] font-semibold text-light/40 uppercase tracking-widest mb-2">
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
              <div className={`text-xs font-bold ${globalSize === sz.id ? 'text-primary' : 'text-light'}`}>
                {sz.id} — {sz.label}
              </div>
              <div className="text-[10px] text-light/40 mt-0.5 leading-snug line-clamp-2">
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
              className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
            className="text-xs px-2.5 py-1 rounded border border-primary text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
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
                <span className="text-[10px] font-semibold text-light/40 uppercase tracking-[0.12em]">
                  {GROUP_LABELS[group]}
                </span>
              </div>
              <ul className="divide-y divide-white/10">
                {groupSources.map(source => {
                  const row = summary.rows.find(r => r.source.id === source.id)
                  const deviceCount = deviceCounts[source.id] ?? source.defaultDeviceCount ?? 0
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

      <TabNav tabs={TABS} activeTab={activeTab} onChange={id => setActiveTab(id as TabId)} />

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
