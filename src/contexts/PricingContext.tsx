import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { PricingBundle, STATIC_PRICING_BUNDLE, EXCHANGE_RATE_USD_TO_GBP, EXCHANGE_RATE_USD_TO_EUR } from '../data/pricing'
import { fetchSentinelPricing, clearRegionCache, getRegionLabel } from '../services/azurePricing'
import { fetchFxRates } from '../services/fxRates'
import { CurrencyCode } from '../utils/currency'
import brand from '../config/brand'

interface PricingContextValue {
  region: string
  regionDisplayName: string
  onRegionChange: (arm: string) => void
  fxRate: number
  onFxRateChange: (rate: number) => void
  displayCurrency: CurrencyCode
  onCurrencyChange: (currency: CurrencyCode) => void
  eurRate: number
  onEurRateChange: (rate: number) => void
  isLoading: boolean
  isLive: boolean
  lastFetched: string | null
  onRefresh: () => void
  pricing: PricingBundle
  /** True when the displayed FX rates came from the live provider rather than the static fallback */
  fxIsLive: boolean
  /** Publication date of the live rates, when the provider reported one */
  fxDate: string | null
}

const PricingContext = createContext<PricingContextValue | null>(null)

export function PricingProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegion] = useState(brand.defaults.region)
  const [fxRate, setFxRate] = useState(EXCHANGE_RATE_USD_TO_GBP)
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>(brand.defaults.currency)
  const [eurRate, setEurRate] = useState(EXCHANGE_RATE_USD_TO_EUR)
  const [pricing, setPricing] = useState<PricingBundle>(STATIC_PRICING_BUNDLE)
  const [isLoading, setIsLoading] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const [fxIsLive, setFxIsLive] = useState(false)
  const [fxDate, setFxDate] = useState<string | null>(null)
  // Once the user edits a rate by hand their value wins, and a later live
  // fetch must not silently overwrite it.
  const [fxOverridden, setFxOverridden] = useState(false)

  const loadPricing = useCallback(async (arm: string) => {
    setIsLoading(true)
    try {
      const result = await fetchSentinelPricing(arm)
      setPricing(result.bundle)
      setIsLive(result.isLive)
      const d = new Date(result.fetchedAt)
      setLastFetched(
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      )
      // isLive=false just means we're using static defaults — not an error worth surfacing
    } catch {
      setIsLive(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPricing(region)
  }, [region, loadPricing])

  // Exchange rates are global, not per-region, so this runs once on mount.
  useEffect(() => {
    let cancelled = false
    fetchFxRates().then(rates => {
      if (cancelled || fxOverridden) return
      setFxRate(rates.gbp)
      setEurRate(rates.eur)
      setFxIsLive(rates.isLive)
      setFxDate(rates.date)
    })
    return () => { cancelled = true }
    // fxOverridden is deliberately not a dependency: this should fire once,
    // and the guard inside covers the race where the user edits mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRegionChange(arm: string) {
    setRegion(arm)
  }

  function handleFxRateChange(rate: number) {
    setFxRate(rate)
    setFxOverridden(true)
    setFxIsLive(false)
  }

  function handleEurRateChange(rate: number) {
    setEurRate(rate)
    setFxOverridden(true)
    setFxIsLive(false)
  }

  function handleRefresh() {
    clearRegionCache(region)
    loadPricing(region)
  }

  const value: PricingContextValue = {
    region,
    regionDisplayName: getRegionLabel(region),
    onRegionChange: handleRegionChange,
    fxRate,
    onFxRateChange: handleFxRateChange,
    displayCurrency,
    onCurrencyChange: setDisplayCurrency,
    eurRate,
    onEurRateChange: handleEurRateChange,
    isLoading,
    isLive,
    lastFetched,
    onRefresh: handleRefresh,
    pricing,
    fxIsLive,
    fxDate,
  }

  return (
    <PricingContext.Provider value={value}>
      {children}
    </PricingContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePricing(): PricingContextValue {
  const ctx = useContext(PricingContext)
  if (!ctx) throw new Error('usePricing must be used within PricingProvider')
  return ctx
}
