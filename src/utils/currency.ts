import { EXCHANGE_RATE_USD_TO_GBP } from '../data/pricing'

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
