import { useState } from 'react'
import { PricingProvider, usePricing } from './contexts/PricingContext'
import { IngestionEstimator } from './components/IngestionEstimator'
import { AnalyseMode } from './components/AnalyseMode'
import { RegionSelector } from './components/RegionSelector'
import { FeatureRequestButton } from './components/FeatureRequestButton'
import { FeatureRequestModal } from './components/FeatureRequestModal'
import { CompliancePresetId } from './data/compliancePresets'
import brand from './config/brand'

type Mode = 'estimate' | 'analyse'

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'estimate', label: 'Estimate', hint: 'plan a new deployment' },
  { id: 'analyse', label: 'Analyse', hint: 'optimise an existing one' },
]

function AppShell() {
  const [mode, setMode] = useState<Mode>('estimate')
  const {
    region, onRegionChange,
    fxRate, onFxRateChange,
    displayCurrency, onCurrencyChange,
    eurRate, onEurRateChange,
    isLoading, isLive, lastFetched, onRefresh,
  } = usePricing()
  const [activePresetId, setActivePresetId] = useState<CompliancePresetId>('custom')
  const [modalOpen, setModalOpen] = useState(false)

  // Hex alpha helpers for inline styles derived from brand colours
  const primaryAlpha25 = `${brand.colours.primary}40`
  const primaryAlpha18 = `${brand.colours.primary}2e`
  const accentAlpha10 = `${brand.colours.accent}1a`

  return (
    <div className="min-h-screen bg-dark text-light">
      <header className="relative overflow-hidden bg-dark text-light" style={{ borderBottom: `1px solid ${primaryAlpha25}` }}>
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
          style={{ background: `linear-gradient(135deg, ${primaryAlpha18} 0%, ${accentAlpha10} 60%)` }}
        />

        <div className="relative max-w-5xl mx-auto px-6 py-6 space-y-4">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              {brand.websiteUrl && (
                <a
                  href={brand.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold tracking-[0.2em] uppercase text-light/50 hover:text-light/80 transition-colors mb-1 inline-block"
                >
                  Cloud Security Insider ↗
                </a>
              )}
              <h1 className="text-3xl font-bold tracking-tight">
                {brand.websiteUrl ? (
                  <a href={brand.websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                    {brand.logoUrl ? (
                      <img src={brand.logoUrl} alt={brand.name} className="h-8 inline-block" />
                    ) : (
                      brand.name
                    )}
                  </a>
                ) : brand.logoUrl ? (
                  <img src={brand.logoUrl} alt={brand.name} className="h-8 inline-block" />
                ) : (
                  brand.name
                )}
              </h1>
              {brand.tagline && (
                <p className="text-sm text-light/70 mt-1.5 max-w-md">{brand.tagline}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-light/60 uppercase tracking-widest">Microsoft Sentinel</p>
              <p className="text-xs text-light/60">UK mid-market · up to 50,000 users</p>
            </div>
          </div>

          {/* Region + FX + Currency controls */}
          <RegionSelector
            region={region}
            onRegionChange={onRegionChange}
            fxRate={fxRate}
            onFxRateChange={onFxRateChange}
            displayCurrency={displayCurrency}
            onCurrencyChange={onCurrencyChange}
            eurRate={eurRate}
            onEurRateChange={onEurRateChange}
            isLoading={isLoading}
            isLive={isLive}
            lastFetched={lastFetched}
            onRefresh={onRefresh}
            activePresetId={activePresetId}
          />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 pb-28">
        {/* Mode switch. Two different jobs — pricing a deployment that does not
            exist yet, versus optimising one that does — sharing one engine. */}
        <div
          role="tablist"
          aria-label="Calculator mode"
          className="inline-flex rounded-lg border border-white/15 p-1 mb-6 bg-surface"
        >
          {MODES.map(m => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              aria-controls={`mode-panel-${m.id}`}
              id={`mode-tab-${m.id}`}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                mode === m.id
                  ? 'bg-primary text-white font-semibold'
                  : 'text-light/70 hover:text-light hover:bg-white/5'
              }`}
            >
              {m.label}
              <span className="sr-only"> — {m.hint}</span>
            </button>
          ))}
        </div>

        {/* Loading overlay wrapper */}
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-surface/60 z-20 flex items-center justify-center rounded-xl pointer-events-none">
              <svg className="animate-spin h-6 w-6 text-primary-text" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          {/* Both panels stay mounted so switching modes does not discard a
              part-built estimate or a pasted analysis. */}
          <div id="mode-panel-estimate" role="tabpanel" aria-labelledby="mode-tab-estimate" hidden={mode !== 'estimate'}>
            <IngestionEstimator onPresetChange={setActivePresetId} />
          </div>
          <div id="mode-panel-analyse" role="tabpanel" aria-labelledby="mode-tab-analyse" hidden={mode !== 'analyse'}>
            <AnalyseMode />
          </div>
        </div>
      </main>

      <footer className="border-t border-white/8 mt-4 pb-16">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-center gap-1.5 text-xs text-light/60">
          <span>Built by</span>
          {brand.websiteUrl ? (
            <a
              href={brand.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-light/50 hover:text-light/80 transition-colors"
            >
              Cloud Security Insider
            </a>
          ) : (
            <span className="text-light/50">Cloud Security Insider</span>
          )}
        </div>
      </footer>

      {brand.featureRequests.enabled && (
        <>
          <FeatureRequestButton hidden={modalOpen} onClick={() => setModalOpen(true)} />
          <FeatureRequestModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </>
      )}
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
