import { LogSourceGroup } from './pricing'

/**
 * Display labels and ordering for the log source groups.
 *
 * These were previously copied into IngestionEstimator and TierPlacementTab,
 * and had already drifted: the infrastructure group read "Server Workloads" in
 * one and "Infrastructure" in the other, so the same set of rows was labelled
 * differently on two tabs.
 */
export const GROUP_LABELS: Record<LogSourceGroup, string> = {
  'identity': 'Identity & Entra',
  'microsoft-defender': 'Microsoft Defender',
  'microsoft-365': 'Microsoft 365',
  'azure-platform': 'Azure Platform',
  'network': 'Network',
  'infrastructure': 'Server Workloads',
  'third-party': 'Third-party & Custom',
}

export const GROUP_ORDER: LogSourceGroup[] = [
  'identity',
  'microsoft-defender',
  'microsoft-365',
  'azure-platform',
  'network',
  'infrastructure',
  'third-party',
]
