import { useState } from 'react'
import { PricingProvider, usePricing } from './contexts/PricingContext'
import { IngestionEstimator } from './components/IngestionEstimator'
import { RegionSelector } from './components/RegionSelector'
import { CompliancePresetId } from './data/compliancePresets'

function AppShell() {
  const { region, onRegionChange, fxRate, onFxRateChange, isLoading, isLive, lastFetched, onRefresh } = usePricing()
  const [activePresetId, setActivePresetId] = useState<CompliancePresetId>('custom')

  return (
    <div className="min-h-screen bg-dark text-light">
      <header className="relative overflow-hidden bg-dark text-light" style={{ borderBottom: '1px solid rgba(162,24,255,0.25)' }}>
        {/* Dot-grid texture */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          aria-hidden="true"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        {/* Gradient overlay */}
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{ background: 'linear-gradient(135deg, rgba(162,24,255,0.18) 0%, rgba(255,35,113,0.10) 60%)' }}
        />

        <div className="relative max-w-5xl mx-auto px-6 py-6 space-y-4">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-light/50 mb-1">
                Cloud Security Insider
              </p>
              <h1 className="text-3xl font-bold tracking-tight">Sentinel Cost Calculator</h1>
              <p className="text-sm text-light/70 mt-1.5 max-w-md">
                Model your Microsoft Sentinel deployment costs — ingestion, tiers, retention,
                and XDR overlap — before you commit.
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-light/40 uppercase tracking-widest">Microsoft Sentinel</p>
              <p className="text-xs text-light/40">UK mid-market · 100–2,000 users</p>
            </div>
          </div>

          {/* Region + FX controls */}
          <RegionSelector
            region={region}
            onRegionChange={onRegionChange}
            fxRate={fxRate}
            onFxRateChange={onFxRateChange}
            isLoading={isLoading}
            isLive={isLive}
            lastFetched={lastFetched}
            onRefresh={onRefresh}
            activePresetId={activePresetId}
          />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        {/* Loading overlay wrapper */}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-surface/60 z-20 flex items-center justify-center rounded-xl pointer-events-none">
              <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          <IngestionEstimator onPresetChange={setActivePresetId} />
        </div>
      </main>
    </div>
  )
}

function App() {
  return (
    <PricingProvider>
      <AppShell />
    </PricingProvider>
  )
}

export default App
