import { EXCHANGE_RATE_USD_TO_GBP, EXCHANGE_RATE_USD_TO_EUR } from '../data/pricing'

export type CurrencyCode = 'GBP' | 'USD' | 'EUR'

/** Format USD as GBP only: "£1,234.56" */
export function fmtGbp(usd: number, decimals = 2, fxRate = EXCHANGE_RATE_USD_TO_GBP): string {
  const gbp = usd * fxRate
  return `£${gbp.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/** Format USD as "£X.XX ($X.XX)" — GBP primary, USD secondary */
export function fmtBoth(usd: number, decimals = 2, fxRate = EXCHANGE_RATE_USD_TO_GBP): string {
  return `${fmtGbp(usd, decimals, fxRate)} ($${usd.toFixed(decimals)})`
}

/**
 * Format a USD amount in the specified display currency.
 * @param usd - Amount in USD
 * @param currency - Target display currency
 * @param fxRateGbp - USD→GBP exchange rate; defaults to the constant in pricing.ts
 * @param fxRateEur - USD→EUR exchange rate; defaults to the constant in pricing.ts
 * @param decimals - Number of decimal places
 */
export function fmtCurrency(
  usd: number,
  currency: CurrencyCode,
  fxRateGbp = EXCHANGE_RATE_USD_TO_GBP,
  fxRateEur = EXCHANGE_RATE_USD_TO_EUR,
  decimals = 0,
): string {
  if (currency === 'GBP') {
    const gbp = usd * fxRateGbp
    return `£${gbp.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  }
  if (currency === 'EUR') {
    const eur = usd * fxRateEur
    return `€${eur.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
  }
  // USD
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
