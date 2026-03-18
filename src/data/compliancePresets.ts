import type { RetentionStrategy } from './pricing'

export type CompliancePresetId =
  | 'custom'
  | 'iso27001'
  | 'nhs-dspt'
  | 'fca-general'
  | 'fca-mifid2'
  | 'pci-dss'

export interface CompliancePreset {
  id: CompliancePresetId
  label: string
  /** Short name for buttons/badges */
  shortLabel: string
  /** Regulatory note displayed below the selector when active */
  note: string
  /**
   * Retention to apply to sources on the Analytics tier.
   * Capped at 730 days (Analytics max) when applying.
   */
  analyticsRetentionDays: number
  /**
   * Retention to apply to sources on the Data Lake tier.
   * Data Lake supports up to 4,380 days (12 years).
   */
  dataLakeRetentionDays: number
  /**
   * When true, a "Extend to 7 years" toggle is shown beside the preset.
   * Applies only to fca-mifid2; bumps both retention values to 2,555 days.
   */
  hasExtensionToggle?: boolean
  /** Default retention strategy for Analytics-tier sources under this preset */
  analyticsRetentionStrategy: RetentionStrategy
  /** Per-source strategy overrides (id → strategy); used by FCA MiFID II hybrid preset */
  perSourceStrategyOverrides?: Partial<Record<string, RetentionStrategy>>
}

export const COMPLIANCE_PRESETS: CompliancePreset[] = [
  {
    id: 'custom',
    label: 'Custom',
    shortLabel: 'Custom',
    note: '',
    analyticsRetentionDays: 0,
    dataLakeRetentionDays: 0,
    analyticsRetentionStrategy: 'data-lake-mirror',
  },
  {
    id: 'iso27001',
    label: 'ISO 27001',
    shortLabel: 'ISO 27001',
    note: 'ISO 27001 mandates no specific retention period. 12 months is the industry-standard minimum to demonstrate adequate incident investigation capability.',
    analyticsRetentionDays: 365,
    dataLakeRetentionDays: 365,
    analyticsRetentionStrategy: 'data-lake-mirror',
  },
  {
    id: 'nhs-dspt',
    label: 'NHS DSPT / NCSC CAF',
    shortLabel: 'NHS DSPT',
    note: 'NHS DSPT requires logs to be retained for a "sufficient period" and to be searchable for malicious activity. NCSC CAF requires sufficient historical data for post-incident analysis. 12 months is the recommended minimum for both frameworks.',
    analyticsRetentionDays: 365,
    dataLakeRetentionDays: 365,
    analyticsRetentionStrategy: 'data-lake-mirror',
  },
  {
    id: 'fca-general',
    label: 'FCA Regulated (General)',
    shortLabel: 'FCA',
    note: 'FCA SYSC 9.1 requires records and audit trails to be retained for five years on durable media with verifiable, unchanged reproduction capability. Data Lake mirroring enables cost-effective 3-year retention beyond the Analytics tier cap. The FCA may extend this requirement to seven years.',
    analyticsRetentionDays: 1095,  // 3yr via mirror (no Analytics cap applies)
    dataLakeRetentionDays: 1825,
    analyticsRetentionStrategy: 'data-lake-mirror',
  },
  {
    id: 'fca-mifid2',
    label: 'FCA MiFID II',
    shortLabel: 'MiFID II',
    note: 'MiFID II Article 25 requires investment firms to retain records for five years (extendable to seven at FCA request). Hybrid approach: Entra ID and M365 Audit logs kept in Analytics extended retention for full KQL; all other sources mirrored to Data Lake for cost-effective 5-year storage.',
    analyticsRetentionDays: 1825,  // 5yr via mirror; overridden sources capped at 730
    dataLakeRetentionDays: 1825,
    hasExtensionToggle: true,
    analyticsRetentionStrategy: 'data-lake-mirror',
    perSourceStrategyOverrides: {
      'entra-id': 'analytics-extended',
      'o365-audit': 'analytics-extended',
    },
  },
  {
    id: 'pci-dss',
    label: 'PCI DSS 4.0',
    shortLabel: 'PCI DSS',
    note: 'PCI DSS 4.0 Requirement 10.5.1 mandates 12 months total retention with the most recent 3 months immediately available for analysis. Analytics sources receive 90-day retention; Data Lake sources receive 365 days for archive compliance.',
    analyticsRetentionDays: 90,    // 3 months hot (= Analytics free window, no extra cost)
    dataLakeRetentionDays: 365,
    analyticsRetentionStrategy: 'data-lake-mirror',
  },
]

export const DEFAULT_PRESET_ID: CompliancePresetId = 'custom'

export function getPreset(id: CompliancePresetId): CompliancePreset {
  return COMPLIANCE_PRESETS.find(p => p.id === id)!
}
