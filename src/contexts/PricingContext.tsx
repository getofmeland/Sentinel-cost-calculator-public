import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { PricingBundle, STATIC_PRICING_BUNDLE, EXCHANGE_RATE_USD_TO_GBP, EXCHANGE_RATE_USD_TO_EUR } from '../data/pricing'
import {
  fetchSentinelPricing,
  clearRegionCache,
  getRegionLabel,
  FAILURE_CACHE_TTL_MS,
  REGIONAL_RATE_RETRY_NOTE,
  REGIONAL_RATE_UNPUBLISHED_NOTE,
} from '../services/azurePricing'
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
  /** Null when the ISOC meter came back live. Otherwise the sentence to show beside the rate. */
  defenderIsocRateNote: string | null
  /** Null when extended Analytics retention came back live. */
  analyticsRetentionRateNote: string | null
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
  const [defenderIsocRateNote, setDefenderIsocRateNote] = useState<string | null>(null)
  const [analyticsRetentionRateNote, setAnalyticsRetentionRateNote] = useState<string | null>(null)
  // Drops a result that belongs to an earlier region change or a Strict Mode
  // double-invoke, so a fallback is not counted twice.
  const loadGeneration = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isocMisses = useRef(new Map<string, number>())
  const retentionMisses = useRef(new Map<string, number>())

  const loadPricing = useCallback(async (arm: string) => {
    const generation = ++loadGeneration.current
    setIsLoading(true)
    try {
      const result = await fetchSentinelPricing(arm)
      if (generation !== loadGeneration.current) return
      setPricing(result.bundle)
      setIsLive(result.isLive)
      const d = new Date(result.fetchedAt)
      setLastFetched(
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      )

      const noteFor = (failed: boolean, misses: Map<string, number>) => {
        if (!result.isLive || !failed) {
          misses.delete(arm)
          return null
        }
        const n = (misses.get(arm) ?? 0) + 1
        misses.set(arm, n)
        // One automatic refetch. A second miss means the region published no meter.
        return n >= 2 ? REGIONAL_RATE_UNPUBLISHED_NOTE : REGIONAL_RATE_RETRY_NOTE
      }
      const isocNote = noteFor(result.defenderIsocRateIsFallback, isocMisses.current)
      const retentionNote = noteFor(result.analyticsRetentionRateIsFallback, retentionMisses.current)
      setDefenderIsocRateNote(isocNote)
      setAnalyticsRetentionRateNote(retentionNote)

      const retrying = isocNote === REGIONAL_RATE_RETRY_NOTE || retentionNote === REGIONAL_RATE_RETRY_NOTE
      if (retryTimer.current) clearTimeout(retryTimer.current)
      if (retrying) {
        retryTimer.current = setTimeout(() => {
          clearRegionCache(arm)
          void loadPricing(arm)
        }, FAILURE_CACHE_TTL_MS)
      }
      // isLive=false means every figure on the page comes from static defaults
      // rather than current Azure pricing. That is not an error, but it is worth
      // surfacing — RegionSelector shows it as a warning badge.
    } catch {
      if (generation !== loadGeneration.current) return
      setIsLive(false)
      setDefenderIsocRateNote(null)
      setAnalyticsRetentionRateNote(null)
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPricing(region)
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
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
    isocMisses.current.delete(region)
    retentionMisses.current.delete(region)
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
    defenderIsocRateNote,
    analyticsRetentionRateNote,
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
