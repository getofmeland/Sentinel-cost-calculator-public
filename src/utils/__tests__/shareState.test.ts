// @vitest-environment node
/**
 * A share link is user-editable input that lands directly in the pricing maths,
 * so these tests care as much about what gets rejected as what round-trips.
 */

import { describe, it, expect } from 'vitest'

import {
  encodeShareState,
  decodeShareState,
  DEFAULT_SHARE_STATE,
  SHARE_SCHEMA_VERSION,
  MIN_USERS,
  MAX_USERS,
  type ShareableState,
} from '../shareState'

const fullState: ShareableState = {
  userCount: 2500,
  selectedIds: ['entra-id', 'mde', 'dns'],
  globalSize: 'L',
  activePresetId: 'pci-dss',
  mifidExtended: false,
  globalRetentionStrategy: 'analytics-extended',
  licence: 'e5',
  defenderEnabled: true,
  region: 'westeurope',
  displayCurrency: 'EUR',
  serverCounts: { 'ws-dc': 4, 'lx-web': 12 },
  serverLevels: { 'ws-dc': 'all' },
  deviceCounts: { dns: 6 },
  logTiers: { dns: 'data-lake', 'ws-dc': 'analytics' },
  retentionDays: { 'entra-id': 365 },
  selectedVariants: {},
  manualGbValues: {},
  sizeOverrides: { mde: 'XL' },
  retentionStrategies: { 'entra-id': 'analytics-extended' },
}

describe('share state round-trip', () => {
  it('restores every field it was given', () => {
    const decoded = decodeShareState(encodeShareState(fullState))
    expect(decoded).toEqual(fullState)
  })

  it('omits defaults, so a light configuration produces a short link', () => {
    const encoded = encodeShareState({ ...DEFAULT_SHARE_STATE, selectedIds: ['entra-id'] })
    // Version and the one non-default field only.
    expect(encoded).toBe(`v=${SHARE_SCHEMA_VERSION}&s=entra-id`)
  })

  it('a default state decodes back to the defaults', () => {
    const decoded = decodeShareState(encodeShareState(DEFAULT_SHARE_STATE))
    expect(decoded).toEqual(DEFAULT_SHARE_STATE)
  })

  it('keeps a realistic link short enough to paste', () => {
    const encoded = encodeShareState(fullState)
    expect(encoded.length).toBeLessThan(400)
  })
})

describe('share state rejects untrusted input', () => {
  it('returns null when there is no version', () => {
    expect(decodeShareState('u=1000&s=entra-id')).toBeNull()
  })

  it('returns null for a schema version this build does not understand', () => {
    // Better a fresh estimate than someone else's numbers reconstructed wrongly.
    expect(decodeShareState(`v=${SHARE_SCHEMA_VERSION + 1}&u=1000`)).toBeNull()
  })

  it('clamps a user count below the supported minimum', () => {
    expect(decodeShareState(`v=${SHARE_SCHEMA_VERSION}&u=-5000`)!.userCount).toBe(MIN_USERS)
  })

  it('clamps a user count above the supported maximum', () => {
    expect(decodeShareState(`v=${SHARE_SCHEMA_VERSION}&u=99999999`)!.userCount).toBe(MAX_USERS)
  })

  it('falls back to the default user count for a non-numeric value', () => {
    expect(decodeShareState(`v=${SHARE_SCHEMA_VERSION}&u=NaN`)!.userCount)
      .toBe(DEFAULT_SHARE_STATE.userCount)
  })

  it('drops source ids that do not exist', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&s=entra-id,not-a-source,mde`)!
    expect(decoded.selectedIds).toEqual(['entra-id', 'mde'])
  })

  it('ignores an unknown region, size, licence, preset and currency', () => {
    const decoded = decodeShareState(
      `v=${SHARE_SCHEMA_VERSION}&r=mars&sz=XXL&l=e99&p=gdpr&c=BTC`,
    )!
    expect(decoded.region).toBe(DEFAULT_SHARE_STATE.region)
    expect(decoded.globalSize).toBe(DEFAULT_SHARE_STATE.globalSize)
    expect(decoded.licence).toBe(DEFAULT_SHARE_STATE.licence)
    expect(decoded.activePresetId).toBe(DEFAULT_SHARE_STATE.activePresetId)
    expect(decoded.displayCurrency).toBe(DEFAULT_SHARE_STATE.displayCurrency)
  })

  it('rejects a negative manual GB value rather than letting it subtract from the total', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&mg=custom-app:-500`)!
    expect(decoded.manualGbValues['custom-app']).toBeUndefined()
  })

  it('rejects a NaN manual GB value', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&mg=custom-app:NaN`)!
    expect(decoded.manualGbValues['custom-app']).toBeUndefined()
  })

  it('clamps an absurd manual GB value instead of trusting it', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&mg=custom-app:1e12`)!
    expect(decoded.manualGbValues['custom-app']).toBeLessThanOrEqual(100000)
  })

  it('rejects a negative device count', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&dc=dns:-4`)!
    expect(decoded.deviceCounts.dns).toBe(0)
  })

  it('rejects an unknown log tier', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&lt=dns:quantum`)!
    expect(decoded.logTiers.dns).toBeUndefined()
  })

  it('rejects a collection level the workload does not define', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&sl=ws-dc:nonsense`)!
    expect(decoded.serverLevels['ws-dc']).toBeUndefined()
  })

  it('caps retention days at the longest the Data Lake supports', () => {
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&rd=entra-id:999999`)!
    expect(decoded.retentionDays['entra-id']).toBe(4380)
  })

  it('survives malformed map entries without throwing', () => {
    expect(() =>
      decodeShareState(`v=${SHARE_SCHEMA_VERSION}&dc=nocolon,,:,dns:3`),
    ).not.toThrow()
    const decoded = decodeShareState(`v=${SHARE_SCHEMA_VERSION}&dc=nocolon,,:,dns:3`)!
    expect(decoded.deviceCounts.dns).toBe(3)
  })

  it('survives an entirely junk query string', () => {
    expect(() => decodeShareState('%%%&&&===')).not.toThrow()
  })
})
