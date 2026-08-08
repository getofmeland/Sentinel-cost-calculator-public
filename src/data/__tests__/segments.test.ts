// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  SEGMENTS, MIN_USERS, MAX_USERS, MXDR_DEFAULT_SOURCE_IDS,
  segmentForUserCount, getSegment,
} from '../segments'
import { LOG_SOURCES } from '../pricing'
import { MIN_USERS as SHARE_MIN, MAX_USERS as SHARE_MAX } from '../../utils/shareState'

describe('user-count segments', () => {
  it('covers the whole range with no gap between segments', () => {
    // A gap would make some user counts unreachable by slider entirely.
    for (let i = 1; i < SEGMENTS.length; i++) {
      expect(SEGMENTS[i].minUsers).toBeLessThanOrEqual(SEGMENTS[i - 1].maxUsers)
    }
    expect(MIN_USERS).toBe(SEGMENTS[0].minUsers)
    expect(MAX_USERS).toBe(SEGMENTS[SEGMENTS.length - 1].maxUsers)
  })

  it('shares one set of bounds with the share-link validator', () => {
    // These were separate literals in two files. A shared link outside the
    // slider's range would have been silently clamped to a different number
    // than the slider could reach.
    expect(SHARE_MIN).toBe(MIN_USERS)
    expect(SHARE_MAX).toBe(MAX_USERS)
  })

  it('puts every segment default inside its own range', () => {
    for (const s of SEGMENTS) {
      expect(s.defaultUsers).toBeGreaterThanOrEqual(s.minUsers)
      expect(s.defaultUsers).toBeLessThanOrEqual(s.maxUsers)
      // And lands back in the same segment, so the toggle is not self-cancelling.
      expect(segmentForUserCount(s.defaultUsers).id).toBe(s.id)
    }
  })

  it('derives the segment from the count rather than storing it', () => {
    expect(segmentForUserCount(100).id).toBe('mid-market')
    expect(segmentForUserCount(500).id).toBe('mid-market')
    expect(segmentForUserCount(5_000).id).toBe('mid-market')
    expect(segmentForUserCount(5_001).id).toBe('enterprise')
    expect(segmentForUserCount(50_000).id).toBe('enterprise')
  })

  it('gives the mid-market range usable resolution', () => {
    // The reason the split exists. On a single 100–50,000 track the mid-market
    // occupied the first tenth; picking 500 rather than 1,000 was a six-pixel
    // target at a typical rendered width.
    const mid = getSegment('mid-market')
    const steps = (mid.maxUsers - mid.minUsers) / mid.step
    expect(steps).toBeGreaterThan(50)
    expect(steps).toBeLessThan(200)
  })

  it('gives the enterprise range a step you can actually cross', () => {
    const ent = getSegment('enterprise')
    const steps = (ent.maxUsers - ent.minUsers) / ent.step
    expect(steps).toBeGreaterThan(50)
    expect(steps).toBeLessThan(200)
  })
})

describe('MXDR default selection', () => {
  const ids = new Set(LOG_SOURCES.map(s => s.id))

  it('names only sources that exist', () => {
    // A typo here would silently select nothing and quietly understate the
    // first-visit estimate.
    for (const id of MXDR_DEFAULT_SOURCE_IDS) {
      expect(ids.has(id), `${id} is not a real source id`).toBe(true)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(MXDR_DEFAULT_SOURCE_IDS).size).toBe(MXDR_DEFAULT_SOURCE_IDS.length)
  })

  it('covers the Defender XDR workloads an MXDR service runs on', () => {
    for (const id of ['mde', 'mdi', 'mdo', 'mdca', 'mdc']) {
      expect(MXDR_DEFAULT_SOURCE_IDS).toContain(id)
    }
  })

  it('covers identity, where most detections begin', () => {
    expect(MXDR_DEFAULT_SOURCE_IDS).toContain('entra-id')
    expect(MXDR_DEFAULT_SOURCE_IDS).toContain('entra-id-protection')
  })

  it('selects no source outside the Microsoft groups', () => {
    // Network and third-party sources belong to the customer's estate and vary
    // enormously. Assuming them would inflate every first-visit estimate.
    const microsoftGroups = new Set(['identity', 'microsoft-365', 'microsoft-defender', 'azure-platform'])
    for (const id of MXDR_DEFAULT_SOURCE_IDS) {
      const source = LOG_SOURCES.find(s => s.id === id)!
      expect(microsoftGroups.has(source.group), `${id} is in group ${source.group}`).toBe(true)
    }
  })

  it('produces a non-zero estimate on a first visit', () => {
    // The point of the change: the estimator used to open on an empty form and
    // a total of zero, which asks a newcomer to know the answer first.
    const billable = MXDR_DEFAULT_SOURCE_IDS
      .map(id => LOG_SOURCES.find(s => s.id === id)!)
      .filter(s => !s.isFree)
    expect(billable.length).toBeGreaterThan(0)
  })
})
