/**
 * How the estimator starts: which size of organisation is being priced, and
 * which sources are selected before the user touches anything.
 */

export type SegmentId = 'mid-market' | 'enterprise'

export interface Segment {
  id: SegmentId
  label: string
  /** Shown under the toggle — what picking this actually changes */
  description: string
  minUsers: number
  maxUsers: number
  /** Where the slider lands when this segment is chosen */
  defaultUsers: number
  /**
   * Slider granularity. A 50-user step is meaningful at 800 users and absurd at
   * 40,000, where it takes 800 keypresses to cross the range.
   */
  step: number
}

/**
 * WHY TWO RANGES RATHER THAN ONE SLIDER
 *
 * A single 100–50,000 track put the entire mid-market — the audience this tool
 * is built for — inside its first tenth. At a typical rendered width that is
 * roughly eighty users per pixel, so choosing 500 rather than 1,000 meant
 * landing a six-pixel target. The numbers were reachable by typing, but the
 * control that invites exploration was useless for the people most likely to
 * explore.
 *
 * A logarithmic track would also fix the resolution and needs no toggle, but it
 * makes the handle move at a rate that has to be explained, and a cost estimate
 * is not the place to teach someone about log scales.
 */
export const SEGMENTS: Segment[] = [
  {
    id: 'mid-market',
    label: 'SMB / Mid-market',
    description: 'Up to 5,000 users',
    minUsers: 100,
    maxUsers: 5_000,
    defaultUsers: 500,
    step: 50,
  },
  {
    id: 'enterprise',
    // Starts ABOVE the mid-market ceiling, not level with it. Sharing the 5,000
    // endpoint meant the enterprise slider could emit a value that derived back
    // to mid-market: dragging to the left end flipped the segment, rescaled the
    // track from 45,000 wide to 4,900, and threw the thumb from the far left to
    // the far right under the user's hand. Non-overlapping ranges make every
    // value a slider can produce derive back to itself.
    label: 'Enterprise',
    description: '5,500 to 50,000 users',
    minUsers: 5_500,
    maxUsers: 50_000,
    defaultUsers: 10_000,
    step: 500,
  },
]

/**
 * The segment is DERIVED from the user count, never stored alongside it.
 *
 * Storing both invites them to disagree — a shared link carrying 12,000 users
 * and a stale "mid-market" flag, or a segment toggle that leaves the count
 * behind. Every serious bug in this codebase has been two figures measured
 * against different bases, so there is only ever one figure here and the
 * segment is a view of it.
 */
export function segmentForUserCount(userCount: number): Segment {
  return userCount > SEGMENTS[0].maxUsers ? SEGMENTS[1] : SEGMENTS[0]
}

/**
 * Snap a typed value onto the grid of whichever segment it belongs to, and keep
 * it inside that segment.
 *
 * Snapping to an absolute multiple of the step — `round(v / step) * step` — was
 * wrong in a way that only showed at the boundary: typing 5,100 chose the
 * enterprise step of 500, snapped to 5,000, and 5,000 belongs to mid-market. The
 * value fell out of the segment whose grid it had just been snapped to. Offsets
 * are measured from the segment's own floor so the result always lands inside.
 */
export function snapUserCount(value: number): number {
  const clamped = Math.min(MAX_USERS, Math.max(MIN_USERS, value))
  const seg = segmentForUserCount(clamped)
  const snapped = seg.minUsers + Math.round((clamped - seg.minUsers) / seg.step) * seg.step
  return Math.min(seg.maxUsers, Math.max(seg.minUsers, snapped))
}

export function getSegment(id: SegmentId): Segment {
  return SEGMENTS.find(s => s.id === id) ?? SEGMENTS[0]
}

/** Absolute bounds across both segments, for validating restored state. */
export const MIN_USERS = SEGMENTS[0].minUsers
export const MAX_USERS = SEGMENTS[SEGMENTS.length - 1].maxUsers

/**
 * Sources selected on a first visit: the Microsoft telemetry an MXDR service
 * actually runs on.
 *
 * The estimator used to open with nothing selected and a total of zero, which
 * asks a newcomer to know the answer before the tool will tell them anything.
 * This is the Microsoft-first stack a managed detection and response service
 * onboards — identity, the five Defender workloads, and the two free
 * Microsoft audit feeds — so the first screen is a realistic deployment rather
 * than an empty form.
 *
 * Deliberately excluded, because they are decisions rather than defaults:
 *   - intune       device compliance is posture, not detection telemetry
 *   - key-vault    a narrow Azure audit trail, not part of the XDR stack
 *   - network      firewalls, DNS, NSG and WAF belong to the customer's estate
 *                  and vary enormously; assuming them would inflate every
 *                  first-visit estimate
 *   - third-party  by definition not Microsoft sources
 */
export const MXDR_DEFAULT_SOURCE_IDS: string[] = [
  // Identity — where most detections begin
  'entra-id',
  'entra-id-protection',
  // Defender XDR workloads
  'mde',
  'mdi',
  'mdo',
  'mdca',
  'mdc',
  // Free Microsoft audit feeds, included because leaving them out understates
  // coverage while costing nothing.
  'o365-audit',
  'azure-activity',
]
