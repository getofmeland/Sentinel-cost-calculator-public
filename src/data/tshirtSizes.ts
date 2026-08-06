export type TshirtSize = 'S' | 'M' | 'L' | 'XL'

export interface TshirtSizeDefinition {
  id: TshirtSize
  label: string
  description: string
  /** Position within [min, max]: 0 = min, 1 = max */
  multiplier: number
}

export const TSHIRT_SIZES: TshirtSizeDefinition[] = [
  // Multipliers span the declared range. S used to start at 0.30, which made the
  // documented minimum of every range unreachable — a source declared [5, 50]
  // could never produce less than 18.5 GB/day, so "Light" was not light.
  {
    id: 'S',
    label: 'Light',
    description: 'Minimal audit policies, low user activity, basic security monitoring. Typical: small office, creative/media firms.',
    multiplier: 0.05,
  },
  {
    id: 'M',
    label: 'Standard',
    description: 'Default audit policies, moderate activity. Typical: professional services, general mid-market.',
    multiplier: 0.50,
  },
  {
    id: 'L',
    label: 'Active',
    description: 'Enhanced audit policies, high user activity, multiple security tools. Typical: financial services, legal, healthcare.',
    multiplier: 0.75,
  },
  {
    id: 'XL',
    label: 'Verbose',
    description: 'Maximum audit logging, compliance-driven, high transaction volumes. Typical: FCA-regulated, PCI scope, high-security environments.',
    multiplier: 0.95,
  },
]

export const DEFAULT_TSHIRT_SIZE: TshirtSize = 'M'

/**
 * Interpolate within a [min, max] range using a size multiplier (0 = min, 1 = max).
 *
 * Geometric rather than linear. Ingestion volumes are roughly log-normal, so the
 * typical value in a wide band sits near the geometric mean, not the arithmetic
 * one. On a [5, 50] range the linear midpoint is 27.5 against a geometric mean
 * of 15.8 — a 74% overstatement, and worse on wider bands: third-party firewall
 * [1, 20] was overstated by 135%.
 *
 * Narrow ranges are barely affected — the server workload bands, which are
 * typically under 2x, move by a few percent — so this corrects the wide,
 * uncertain sources without disturbing the well-calibrated ones.
 *
 * Falls back to linear when either endpoint is non-positive, since the
 * geometric form is undefined there.
 */
export function interpolateRange(min: number, max: number, multiplier: number): number {
  if (min <= 0 || max <= 0) return min + (max - min) * multiplier
  return min * Math.pow(max / min, multiplier)
}

export function getSizeMultiplier(size: TshirtSize): number {
  return TSHIRT_SIZES.find(s => s.id === size)!.multiplier
}
