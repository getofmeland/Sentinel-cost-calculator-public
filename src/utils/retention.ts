/**
 * Formats a day count as a human-readable retention period.
 * e.g. 30 → "30 days", 365 → "1 year", 1825 → "5 years"
 */
export function fmtRetentionDays(days: number): string {
  if (days < 365) return `${days} days`
  const years = days / 365
  const rounded = Math.round(years * 10) / 10
  return `${rounded === Math.floor(rounded) ? Math.floor(rounded) : rounded} ${rounded === 1 ? 'year' : 'years'}`
}

/**
 * Option label shown in the retention dropdown.
 * e.g. 90 → "90 days (included)", 1825 → "5 years"
 */
export function fmtRetentionOption(days: number, freeRetentionDays: number): string {
  const label = fmtRetentionDays(days)
  return days === freeRetentionDays ? `${label} (included)` : label
}
