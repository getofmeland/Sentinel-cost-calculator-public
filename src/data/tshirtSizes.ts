export type TshirtSize = 'S' | 'M' | 'L' | 'XL'

export interface TshirtSizeDefinition {
  id: TshirtSize
  label: string
  description: string
  /** Position within [min, max]: 0 = min, 1 = max */
  multiplier: number
}

export const TSHIRT_SIZES: TshirtSizeDefinition[] = [
  {
    id: 'S',
    label: 'Light',
    description: 'Minimal audit policies, low user activity, basic security monitoring. Typical: small office, creative/media firms.',
    multiplier: 0.30,
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

/** Interpolate within a [min, max] range using a size multiplier (0 = min, 1 = max) */
export function interpolateRange(min: number, max: number, multiplier: number): number {
  return min + (max - min) * multiplier
}

export function getSizeMultiplier(size: TshirtSize): number {
  return TSHIRT_SIZES.find(s => s.id === size)!.multiplier
}
