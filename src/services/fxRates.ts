import { EXCHANGE_RATE_USD_TO_GBP, EXCHANGE_RATE_USD_TO_EUR } from '../data/pricing'

export interface FxRates {
  gbp: number
  eur: number
  /** Date the rates were published, if the provider reported one */
  date: string | null
  /** False when the static fallback constants were used */
  isLive: boolean
}

export const STATIC_FX_RATES: FxRates = {
  gbp: EXCHANGE_RATE_USD_TO_GBP,
  eur: EXCHANGE_RATE_USD_TO_EUR,
  date: null,
  isLive: false,
}

// Dev goes through the Vite proxy; production through the Functions app.
// Mirrors the arrangement in azurePricing.ts.
const BASE_URL = import.meta.env.DEV ? '/fx-rates' : '/api/fx-rates'

const FETCH_TIMEOUT_MS = 5000

function isPlausible(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0.1 && rate < 5
}

/**
 * Accepts either the normalised shape returned by our Functions proxy
 * ({ gbp, eur }) or the provider's raw shape ({ rates: { GBP, EUR } }), which
 * is what the Vite dev proxy passes through untouched. Returns null if neither
 * yields a plausible pair — a bad rate silently rescales every figure on the
 * page, so it is better to fall back to the static constants.
 */
function parseRates(data: unknown): { gbp: number; eur: number; date: string | null } | null {
  const d = data as { gbp?: unknown; eur?: unknown; date?: unknown; rates?: Record<string, unknown> }
  const gbp = d?.gbp ?? d?.rates?.GBP
  const eur = d?.eur ?? d?.rates?.EUR
  if (!isPlausible(gbp) || !isPlausible(eur)) return null
  return { gbp, eur, date: typeof d?.date === 'string' ? d.date : null }
}

/**
 * Fetch current USD→GBP and USD→EUR rates, falling back to the static
 * constants on any failure. Never throws — a currency lookup should not be
 * able to take the calculator down.
 */
export async function fetchFxRates(): Promise<FxRates> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(BASE_URL, { signal: controller.signal })
    if (!res.ok) throw new Error(`FX API ${res.status}`)

    const parsed = parseRates(await res.json())
    if (!parsed) throw new Error('FX API returned unusable rates')

    return { ...parsed, isLive: true }
  } catch (err) {
    console.warn('[fxRates] Falling back to static exchange rates:', err)
    return STATIC_FX_RATES
  } finally {
    clearTimeout(timeout)
  }
}
