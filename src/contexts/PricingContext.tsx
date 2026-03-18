import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { PricingBundle, STATIC_PRICING_BUNDLE, EXCHANGE_RATE_USD_TO_GBP } from '../data/pricing'
import { fetchSentinelPricing, clearRegionCache, DEFAULT_REGION, getRegionLabel } from '../services/azurePricing'

interface PricingContextValue {
  region: string
  regionDisplayName: string
  onRegionChange: (arm: string) => void
  fxRate: number
  onFxRateChange: (rate: number) => void
  isLoading: boolean
  isLive: boolean
  lastFetched: string | null
  onRefresh: () => void
  pricing: PricingBundle
}

const PricingContext = createContext<PricingContextValue | null>(null)

export function PricingProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegion] = useState(DEFAULT_REGION)
  const [fxRate, setFxRate] = useState(EXCHANGE_RATE_USD_TO_GBP)
  const [pricing, setPricing] = useState<PricingBundle>(STATIC_PRICING_BUNDLE)
  const [isLoading, setIsLoading] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

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

  function handleRegionChange(arm: string) {
    setRegion(arm)
  }

  function handleFxRateChange(rate: number) {
    setFxRate(rate)
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
    isLoading,
    isLive,
    lastFetched,
    onRefresh: handleRefresh,
    pricing,
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
