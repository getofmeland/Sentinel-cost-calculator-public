export interface CollectionLevel {
  id: string
  label: string
  gbPerServerPerDay: { min: number; max: number }
}

export interface ServerWorkload {
  id: string
  name: string
  os: 'windows' | 'linux'
  collectionLevels: CollectionLevel[]
  defaultLevel: string
  description: string
  /** True for windows workloads — Windows Security Events are eligible for the Defender for Servers P2 grant */
  p2Eligible: boolean
  /** DHCP, Print, Exchange — shown in collapsible advanced panel */
  advanced?: boolean
}

export const SERVER_WORKLOADS: ServerWorkload[] = [

  // ── Windows Server Workloads ───────────────────────────────────────────────
  {
    id: 'ws-dc',
    name: 'Domain Controller',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Active Directory domain controllers — highest volume Windows source',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.3, max: 0.7 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 1.5, max: 2.5 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 6.0, max: 10.0 } },
    ],
  },
  {
    id: 'ws-fileserver',
    name: 'File Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Windows file servers with object access auditing',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.35, max: 0.65 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 2.0, max: 4.0 } },
    ],
  },
  {
    id: 'ws-sql',
    name: 'SQL / Database Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Windows SQL Server or other database hosts',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.3,  max: 0.5 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 1.5, max: 2.5 } },
    ],
  },
  {
    id: 'ws-web',
    name: 'Web / IIS Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Windows IIS or other web servers',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.2,  max: 0.4 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 1.0, max: 2.0 } },
    ],
  },
  {
    id: 'ws-app',
    name: 'Application Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'General Windows application servers',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.2,  max: 0.4 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 1.0, max: 2.0 } },
    ],
  },
  {
    id: 'ws-rds',
    name: 'RDS / Terminal Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Remote Desktop Services — high logon event volume from multiple users',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.1,  max: 0.3 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.75, max: 1.25 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 3.0, max: 5.0 } },
    ],
  },
  {
    id: 'ws-member',
    name: 'Member Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Standard Windows member servers not in another category',
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.03, max: 0.07 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.15, max: 0.25 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 0.75, max: 1.25 } },
    ],
  },
  {
    id: 'ws-dhcp',
    name: 'DHCP Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Windows DHCP server — IP lease events for device tracking',
    advanced: true,
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.03, max: 0.07 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.15, max: 0.25 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 0.35, max: 0.65 } },
    ],
  },
  {
    id: 'ws-print',
    name: 'Print Server',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'Windows print servers — low security value, minimal volume',
    advanced: true,
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.01, max: 0.03 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 0.07, max: 0.13 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 0.2, max: 0.4 } },
    ],
  },
  {
    id: 'ws-exchange',
    name: 'Exchange (on-premises)',
    os: 'windows',
    p2Eligible: true,
    defaultLevel: 'common',
    description: 'On-premises Microsoft Exchange — email gateway events',
    advanced: true,
    collectionLevels: [
      { id: 'minimal', label: 'Minimal', gbPerServerPerDay: { min: 0.2, max: 0.4 } },
      { id: 'common',  label: 'Common',  gbPerServerPerDay: { min: 1.0, max: 2.0 } },
      { id: 'all',     label: 'All Events', gbPerServerPerDay: { min: 4.0, max: 6.0 } },
    ],
  },

  // ── Linux Server Workloads ─────────────────────────────────────────────────
  {
    id: 'lx-web',
    name: 'Linux Web Server',
    os: 'linux',
    p2Eligible: false,
    defaultLevel: 'standard',
    description: 'Linux-hosted web servers (nginx, Apache, etc.)',
    collectionLevels: [
      { id: 'standard', label: 'Standard', gbPerServerPerDay: { min: 0.2, max: 0.4 } },
      { id: 'verbose',  label: 'Verbose',  gbPerServerPerDay: { min: 1.5, max: 2.5 } },
    ],
  },
  {
    id: 'lx-app',
    name: 'Linux App Server',
    os: 'linux',
    p2Eligible: false,
    defaultLevel: 'standard',
    description: 'General Linux application servers',
    collectionLevels: [
      { id: 'standard', label: 'Standard', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'verbose',  label: 'Verbose',  gbPerServerPerDay: { min: 0.75, max: 1.25 } },
    ],
  },
  {
    id: 'lx-db',
    name: 'Linux Database',
    os: 'linux',
    p2Eligible: false,
    defaultLevel: 'standard',
    description: 'Linux database servers (PostgreSQL, MySQL, etc.)',
    collectionLevels: [
      { id: 'standard', label: 'Standard', gbPerServerPerDay: { min: 0.07, max: 0.15 } },
      { id: 'verbose',  label: 'Verbose',  gbPerServerPerDay: { min: 0.6, max: 1.0 } },
    ],
  },
  {
    id: 'lx-general',
    name: 'Linux General Server',
    os: 'linux',
    p2Eligible: false,
    defaultLevel: 'standard',
    description: 'General-purpose Linux servers not in another category',
    collectionLevels: [
      { id: 'standard', label: 'Standard', gbPerServerPerDay: { min: 0.03, max: 0.07 } },
      { id: 'verbose',  label: 'Verbose',  gbPerServerPerDay: { min: 0.35, max: 0.65 } },
    ],
  },
]
