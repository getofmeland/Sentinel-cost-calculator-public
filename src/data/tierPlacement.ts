export type TierRecommendation = 'analytics' | 'data-lake' | 'free'

export interface TierPlacementDefault {
  sourceId: string
  recommendedTier: TierRecommendation
  reason: string
}

export const TIER_PLACEMENT_DEFAULTS: TierPlacementDefault[] = [
  // Analytics (real-time detection)
  { sourceId: 'entra-id',            recommendedTier: 'analytics',  reason: 'Real-time identity detection: impossible travel, brute force, MFA bypass' },
  { sourceId: 'entra-id-protection', recommendedTier: 'analytics',  reason: 'Risk signals required for real-time conditional access policy triggers' },
  { sourceId: 'mde',                 recommendedTier: 'analytics',  reason: 'Core EDR telemetry — real-time incident detection and response' },
  { sourceId: 'mdi',                 recommendedTier: 'analytics',  reason: 'Lateral movement and credential attack detection requires low latency' },
  { sourceId: 'mdo',                 recommendedTier: 'analytics',  reason: 'Phishing and BEC detection; alert correlation with identity signals' },
  { sourceId: 'mdca',                recommendedTier: 'analytics',  reason: 'Shadow IT and OAuth app abuse detection' },
  { sourceId: 'mdc',                 recommendedTier: 'analytics',  reason: 'Cloud workload security alerts for real-time threat response' },
  { sourceId: 'o365-audit',          recommendedTier: 'analytics',  reason: 'Insider threat and admin activity monitoring' },
  { sourceId: 'intune',              recommendedTier: 'analytics',  reason: 'Device compliance events for posture-based alerting' },
  { sourceId: 'key-vault',           recommendedTier: 'analytics',  reason: 'Low-volume critical audit trail for privileged secret access' },
  // Data Lake (investigation & forensics)
  { sourceId: 'azure-firewall',       recommendedTier: 'data-lake', reason: 'High-volume network flow data; queried only during network investigations' },
  { sourceId: 'nsg-flow',             recommendedTier: 'data-lake', reason: 'Very high volume — use Summary Rules to aggregate into Analytics for IOC matching' },
  { sourceId: 'dns',                  recommendedTier: 'data-lake', reason: 'High volume; C2 detection via Summary Rules; bulk forensic DNS lookups' },
  { sourceId: 'third-party-firewall', recommendedTier: 'data-lake', reason: 'Investigation context; high volume unsuitable for real-time Analytics' },
  { sourceId: 'custom-app',           recommendedTier: 'data-lake', reason: 'Compliance/audit logs; rarely queried in real-time' },
  { sourceId: 'email-gateway',        recommendedTier: 'data-lake', reason: 'High-volume mail metadata; use Analytics only if not running MDO' },
  { sourceId: 'vpn-ztna',             recommendedTier: 'data-lake', reason: 'Auth/session logs; investigation context for network incidents' },
  { sourceId: 'waf',                  recommendedTier: 'data-lake', reason: 'Web request logs; investigation context unless running WAF detection rules' },
  // Windows Server Workloads
  { sourceId: 'ws-dc',         recommendedTier: 'analytics', reason: 'Authentication and logon events — core for identity-based detection' },
  { sourceId: 'ws-fileserver', recommendedTier: 'analytics', reason: 'Object access events — required for insider threat detection' },
  { sourceId: 'ws-sql',        recommendedTier: 'analytics', reason: 'Database authentication events; SQL injection and privilege escalation detection' },
  { sourceId: 'ws-web',        recommendedTier: 'analytics', reason: 'Web server auth and IIS events; targeted attack detection' },
  { sourceId: 'ws-app',        recommendedTier: 'analytics', reason: 'Application security events for behavioural anomaly detection' },
  { sourceId: 'ws-rds',        recommendedTier: 'analytics', reason: 'Multi-user logon/logoff events — high detection value' },
  { sourceId: 'ws-member',     recommendedTier: 'analytics', reason: 'Standard logon events for lateral movement detection' },
  { sourceId: 'ws-dhcp',       recommendedTier: 'analytics', reason: 'IP lease events — useful for device tracking and rogue device detection' },
  { sourceId: 'ws-print',      recommendedTier: 'data-lake', reason: 'Low security value; investigation only' },
  { sourceId: 'ws-exchange',   recommendedTier: 'analytics', reason: 'Email gateway events for BEC and phishing detection (on-premises Exchange)' },
  // Linux Server Workloads
  { sourceId: 'lx-web',        recommendedTier: 'analytics', reason: 'Web server auth and access events' },
  { sourceId: 'lx-app',        recommendedTier: 'analytics', reason: 'Application events for behavioural anomaly detection' },
  { sourceId: 'lx-db',         recommendedTier: 'analytics', reason: 'Database authentication — privilege escalation detection' },
  { sourceId: 'lx-general',    recommendedTier: 'data-lake', reason: 'General syslog — low detection value relative to volume' },
  // Free (tier irrelevant)
  { sourceId: 'azure-activity',       recommendedTier: 'free',      reason: 'No Sentinel ingestion charge — Azure Activity Logs are always free' },
]

export function getDefaultTier(sourceId: string): TierRecommendation {
  return TIER_PLACEMENT_DEFAULTS.find(d => d.sourceId === sourceId)?.recommendedTier ?? 'analytics'
}
