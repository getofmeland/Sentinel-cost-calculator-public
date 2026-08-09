// @vitest-environment node
/**
 * Defender for Endpoint volume, after moving it from users to devices.
 *
 * The old model was GB per 1,000 USERS, which silently assumed about one
 * onboarded endpoint per user and modelled MDE-on-servers nowhere. A real
 * 70-user tenant with 231 onboarded devices measured 2.04 GB/day; the per-user
 * model predicted 0.31. It was wrong by 6.5x because the denominator was wrong,
 * not because the rate was.
 */

import { describe, it, expect } from 'vitest'
import { LOG_SOURCES } from '../pricing'
import { estimateSourceGbPerDay, scaledDeviceCount } from '../../utils/ingestion'
import { getSizeMultiplier } from '../tshirtSizes'
import { E5_GRANT_ELIGIBLE_SOURCE_IDS } from '../licenceBenefits'
import { MXDR_DEFAULT_SOURCE_IDS } from '../segments'

const src = (id: string) => LOG_SOURCES.find(s => s.id === id)!
const est = (id: string, users: number, devices?: number) =>
  estimateSourceGbPerDay(
    src(id), users, devices ?? scaledDeviceCount(src(id), users),
    undefined, undefined, getSizeMultiplier('M'),
  )

describe('MDE is measured per device', () => {
  it('scales by devices, not by users', () => {
    expect(src('mde').scaleBy).toBe('devices')
    expect(src('mde-servers').scaleBy).toBe('devices')
    // The old per-user range must be gone, not merely unused.
    expect(src('mde').gbPer1000UsersRange).toBeUndefined()
  })

  it('seeds workstations one per user rather than by square root', () => {
    // Square-root seeding suits firewalls and domain controllers; a laptop
    // estate grows one-for-one. At 10,000 users the old rule seeded 2,236.
    expect(scaledDeviceCount(src('mde'), 500)).toBe(500)
    expect(scaledDeviceCount(src('mde'), 10_000)).toBe(10_000)
  })

  it('still seeds servers sub-linearly, because they do grow that way', () => {
    const at500 = scaledDeviceCount(src('mde-servers'), 500)
    const at10k = scaledDeviceCount(src('mde-servers'), 10_000)
    expect(at10k).toBeGreaterThan(at500)
    expect(at10k).toBeLessThan(at500 * 20)
  })

  it('rates servers above workstations', () => {
    // Servers run more processes, hold more connections, and never sleep.
    const [wLo, wHi] = src('mde').gbPerDeviceRange!
    const [sLo, sHi] = src('mde-servers').gbPerDeviceRange!
    expect(sLo).toBeGreaterThan(wLo)
    expect(sHi).toBeGreaterThan(wHi)
  })
})

describe('against the one tenant anybody has measured', () => {
  // 70 users, 69 workstations, 162 servers, 2.04 GB/day of Device* tables.
  //
  // Pinned deliberately, and deliberately loosely. It is a single tenant and a
  // server-heavy one, so it is an anchor rather than a distribution — but it is
  // the only real measurement in the project, and a future range change that
  // drifts away from it should have to say so out loud.
  const predicted = est('mde', 70, 69) + est('mde-servers', 70, 162)

  it('lands within a quarter of the measured figure', () => {
    expect(predicted).toBeGreaterThan(2.04 * 0.75)
    expect(predicted).toBeLessThan(2.04 * 1.25)
  })

  it('is a large improvement on the model it replaced', () => {
    // The per-user model gave 0.31 GB/day for this estate.
    expect(predicted).toBeGreaterThan(0.31 * 3)
  })
})

describe('the typical estate barely moves', () => {
  it('matches the old model closely at one device per user', () => {
    // A correction to the DENOMINATOR should leave estates that fitted the old
    // assumption roughly where they were. The old model gave 2.24 GB/day at
    // 500 users; anything far from that would mean the rate had drifted too.
    const total = est('mde', 500) + est('mde-servers', 500)
    expect(total).toBeGreaterThan(2.24 * 0.8)
    expect(total).toBeLessThan(2.24 * 1.2)
  })
})

describe('grant and default wiring', () => {
  it('includes servers in the MXDR default selection', () => {
    expect(MXDR_DEFAULT_SOURCE_IDS).toContain('mde-servers')
  })

  it('keeps server telemetry out of the E5 grant pool', () => {
    // The E5 grant is denominated per licensed USER; servers are covered by a
    // separate per-server benefit, and Microsoft states the two offers are
    // separate products where one will not cover the other. It does not say
    // which side server-generated advanced hunting data falls on, so this
    // shows a higher cost rather than assuming relief.
    expect(E5_GRANT_ELIGIBLE_SOURCE_IDS.has('mde')).toBe(true)
    expect(E5_GRANT_ELIGIBLE_SOURCE_IDS.has('mde-servers')).toBe(false)
  })
})
