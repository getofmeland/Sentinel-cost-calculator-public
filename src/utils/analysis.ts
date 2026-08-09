import { PricingBundle, STATIC_PRICING_BUNDLE, DAYS_PER_MONTH, BILLING_RULES } from '../data/pricing'
import {
  matchTable, guessTable, attributeTable, isAlwaysFreeTable, type TableMatch,
} from '../data/tableIndex'
import type { ConnectorAttribution } from '../data/connectorIndex'
import type { TableGuess } from '../data/tableCatalogue'
import { computeTierOptions, costAtVolume, tierLabel } from './tiers'
import { sizeTierOnDailyVolume, type DailySizingResult } from './tierSizing'
import { transformsForTable, type DcrTransform } from '../data/dcrTransforms'
import {
  isP2Eligible, isE5Eligible,
  P2_GRANT_MB_PER_SERVER_PER_DAY, E5_GRANT_MB_PER_LICENSED_USER_PER_DAY,
} from '../data/grantEligibleTables'
import { E5_QUALIFYING_LICENCES, type M365Licence } from '../data/licenceBenefits'
import { round2 } from './round'
import type { ParsedUsage, UsageRow } from './usageParser'

/**
 * Turns measured ingestion into a ranked list of costed savings.
 *
 * Two rules govern everything here:
 *
 * 1. Commitment tiers apply ONLY to Analytics-plan volume. Basic and Auxiliary
 *    are billed at flat per-GB rates with no tier discount, so sizing a tier
 *    against total billable volume would overstate the saving.
 * 2. Nothing is invented. A table we cannot classify is reported with its cost
 *    and no recommendation; a table whose claimants disagree asks the user
 *    rather than guessing. Silently recommending that someone move their Key
 *    Vault audit trail to a tier with limited KQL is the exact failure this
 *    feature exists to avoid.
 */

export type OpportunityKind =
  | 'commitment-tier'
  | 'tier-placement'
  | 'basic-plan'
  | 'billed-but-free'
  | 'operational-data'
  | 'needs-input'

export interface Opportunity {
  kind: OpportunityKind
  title: string
  detail: string
  /** Monthly saving in USD. Zero for items that need input before they can be costed. */
  monthlySavingUsd: number
  /** Tables this concerns, largest first */
  tables: string[]
  /** True when we cannot act without the user telling us something */
  needsUserInput?: boolean
  /** Amount at stake, where it is not a saving we can claim outright */
  contextUsd?: number
}

export interface AnalysedTable extends UsageRow {
  match: TableMatch | null
  /** Best-effort family identification when the table is not catalogued */
  guess: TableGuess | null
  /**
   * The connector documented as writing this table, when the catalogue has no
   * entry. Names the source without claiming anything about its cost.
   */
  attribution: ConnectorAttribution | null
  /** Current monthly cost at the rate for its plan */
  monthlyCostUsd: number
  /** Volume covered by a free-ingestion grant, and therefore not billed */
  grantedGbPerDay: number
  /** Set when moving this table to a cheaper plan would save money */
  potentialSavingUsd: number
  status: 'ok' | 'move-to-lake' | 'move-to-basic' | 'should-be-free' | 'needs-input' | 'unclassified'
}

/** An ingestion filter offered for a table the paste actually contains. */
export interface OfferedTransform {
  tableName: string
  monthlyCostUsd: number
  transform: DcrTransform
}

export interface AnalysisResult {
  tables: AnalysedTable[]
  /** What they are spending now, on measured ingestion only */
  currentMonthlyUsd: number
  analyticsMonthlyUsd: number
  basicMonthlyUsd: number
  auxiliaryMonthlyUsd: number

  opportunities: Opportunity[]
  totalAddressableSavingUsd: number

  /** Volume we could not classify, and therefore excluded from advice */
  unclassifiedGbPerDay: number
  unclassifiedMonthlyUsd: number
  unclassifiedTableCount: number

  /** Volume awaiting a user decision before it can be advised on */
  needsInputGbPerDay: number

  currentTierLabel: string
  recommendedTierLabel: string | null
  /** Analytics GB/day remaining once the recommended moves are made */
  analyticsGbPerDayAfterMoves: number
  /** Volume absorbed by Defender for Servers P2, and the credit it is worth */
  p2GrantedGbPerDay: number
  p2GrantSavedMonthlyUsd: number
  /** Volume absorbed by the Microsoft 365 E5 data grant */
  e5GrantedGbPerDay: number
  e5GrantSavedMonthlyUsd: number
  /** Present only when the optional daily volume query was supplied AND usable */
  dailySizing: DailySizingResult | null
  /**
   * True when the two pastes' Analytics averages differ enough to suggest they
   * were taken from different periods. The shape is rescaled to the per-table
   * paste regardless, so figures stay consistent — but a stale second query is
   * worth saying out loud.
   */
  dailyPasteDiverges: boolean
  /**
   * Ingestion filters available for tables in this paste, largest spend first.
   * Carries no saving figure: how much a filter removes depends on the estate,
   * and Microsoft publishes no reduction percentages to borrow.
   */
  offeredTransforms: OfferedTransform[]
}

/** What the workspace is licensed for. Absent, no grant is applied at all. */
export interface LicensingInput {
  /** Qualifying M365 licence, or 'none' */
  licence: M365Licence
  /**
   * LICENSED SEATS of a qualifying SKU — not headcount and not total accounts.
   * A tenant with 300 accounts, 70 staff and 100 E5 licences earns 100 × 5 MB.
   * Taking either larger number over-credits and understates the bill.
   */
  licensedSeats: number
  defenderServersP2Enabled: boolean
  /** Machines reporting to this workspace; the P2 allowance is count × 500 MB. */
  serverCount: number
  /**
   * The commitment tier the workspace is ALREADY on, in GB/day. Null for
   * pay-as-you-go.
   *
   * Analyse mode assumed pay-as-you-go and hardcoded it. A workspace big enough
   * to justify an optimisation engagement is usually already committed, and for
   * those customers the tool overstated current spend AND presented the tier
   * saving they had already banked as a fresh opportunity — solving a different
   * customer's problem while appearing confident.
   */
  currentCommitmentTierGbPerDay?: number | null
}

/**
 * Allocate a grant pool across the tables it covers, largest first.
 *
 * Microsoft applies both allowances as a workspace-level POOL — "calculated
 * across all machines in a subscription, not enforced per machine" — so which
 * specific gigabytes it absorbs does not affect the total. It does affect
 * everything downstream: a table already covered must not be offered as a
 * saving, must not be credited again by the other grant, and must not count
 * toward the commitment tier. So the allocation is tracked per table rather
 * than netted off a total.
 *
 * Mutates `credited` and returns the gigabytes this grant absorbed.
 */
function allocateGrant(
  rows: UsageRow[],
  isEligible: (table: string) => boolean,
  allowanceGbPerDay: number,
  credited: Map<string, number>,
): number {
  let remaining = Math.max(0, allowanceGbPerDay)
  const byLargest = [...rows].sort((a, b) => b.billableGbPerDay - a.billableGbPerDay)

  for (const row of byLargest) {
    if (remaining <= 0) break
    // Grants apply to Analytics-plan ingestion. Basic and Auxiliary are billed
    // on their own flat meters and are not what either offer covers.
    if (row.plan !== 'Analytics') continue
    if (!isEligible(row.tableName)) continue
    // Never spend a pool on a table that should not be billed at all.
    //
    // SecurityAlert is on Microsoft's free-data list AND on the P2 eligible
    // list — real overlap in shipped data, not a constructed case. Granting it
    // caused the same gigabytes to leave the tier pool twice: once via
    // grantedAnalyticsGbPerDay and again via the wronglyBilled reducer, which
    // works on gross volume. On a two-table fixture that drove the sizing pool
    // to zero and suppressed a commitment-tier recommendation worth real money.
    // It also netted the misconfiguration saving down to nothing, blinding the
    // very feature that flags being billed for free data.
    if (isAlwaysFreeTable(row.tableName)) continue

    const already = credited.get(row.tableName) ?? 0
    const available = row.billableGbPerDay - already
    if (available <= 0) continue

    const take = Math.min(available, remaining)
    credited.set(row.tableName, already + take)
    remaining -= take
  }
  return Math.max(0, allowanceGbPerDay) - remaining
}

/**
 * Rate per GB for a table, by plan. Basic and Auxiliary are flat-rate.
 *
 * `analyticsRateUsd` is pay-as-you-go on an uncommitted workspace, and the
 * committed tier's blended effective rate where one is in force. Charging
 * Analytics rows at PAYG for a customer already on a tier overstated their
 * current spend — by about 7% at 74 GB/day, and more as volume grows.
 */
function rateForPlan(row: UsageRow, pricing: PricingBundle, analyticsRateUsd: number): number {
  if (row.plan === 'Basic') return pricing.basicLogsRateUsd
  if (row.plan === 'Auxiliary') return pricing.auxiliaryLogsRateUsd
  return analyticsRateUsd
}

export function analyseUsage(
  usage: ParsedUsage,
  pricing: PricingBundle = STATIC_PRICING_BUNDLE,
  /**
   * Optional Analytics-plan volume for each observed day, from the second
   * query. Absent, tier sizing falls back to the period average exactly as
   * before — this only ever adds precision, never changes the default.
   */
  analyticsGbByDay?: number[],
  licensing?: LicensingInput,
): AnalysisResult {
  // ── Free-ingestion grants, applied before anything is costed ─────────────
  const p2AllowanceGbPerDay = licensing?.defenderServersP2Enabled
    ? Math.max(0, licensing.serverCount) * (P2_GRANT_MB_PER_SERVER_PER_DAY / 1000)
    : 0
  const e5AllowanceGbPerDay = licensing && E5_QUALIFYING_LICENCES.has(licensing.licence)
    ? Math.max(0, licensing.licensedSeats) * (E5_GRANT_MB_PER_LICENSED_USER_PER_DAY / 1000)
    : 0

  // Which pool goes first CHANGES THE TOTAL, because three tables sit in both
  // eligible sets. Spending P2 on a shared table can strand a P2-only table
  // while the E5 pool sits unused — review priced one such case at $655/month
  // of bill that the other ordering avoids entirely. The original fixed
  // P2-first rule was justified on per-unit pool size, which says nothing
  // about aggregate size and was simply wrong reasoning.
  //
  // Both grants are separate meters Microsoft applies automatically, so the
  // real invoice reflects whichever assignment covers more. Trying both and
  // keeping the better one is therefore not an optimisation — it is what the
  // customer is actually billed.
  const bothOrderings = [true, false].map(p2First => {
    const credited = new Map<string, number>()
    const first = p2First
      ? allocateGrant(usage.rows, isP2Eligible, p2AllowanceGbPerDay, credited)
      : allocateGrant(usage.rows, isE5Eligible, e5AllowanceGbPerDay, credited)
    const second = p2First
      ? allocateGrant(usage.rows, isE5Eligible, e5AllowanceGbPerDay, credited)
      : allocateGrant(usage.rows, isP2Eligible, p2AllowanceGbPerDay, credited)
    return {
      credited,
      p2: p2First ? first : second,
      e5: p2First ? second : first,
      total: first + second,
    }
  })
  const best = bothOrderings[0].total >= bothOrderings[1].total
    ? bothOrderings[0]
    : bothOrderings[1]

  const grantedGbByTable = best.credited
  const p2GrantedGbPerDay = best.p2
  const e5GrantedGbPerDay = best.e5

  // Analytics volume actually billed, once the grants have taken their share.
  // Needed before costing, because the committed tier's effective rate depends
  // on it — a tier's blended rate is its daily cost spread over the volume that
  // reaches it, plus any overage.
  const netAnalyticsGbPerDay = usage.rows.reduce((sum, r) => (
    r.plan === 'Analytics'
      ? sum + Math.max(0, r.billableGbPerDay - Math.min(r.billableGbPerDay, grantedGbByTable.get(r.tableName) ?? 0))
      : sum
  ), 0)

  const committedTier = licensing?.currentCommitmentTierGbPerDay
    ? pricing.commitmentTiers.find(t => t.gbPerDay === licensing.currentCommitmentTierGbPerDay) ?? null
    : null

  const analyticsRateUsd = committedTier && netAnalyticsGbPerDay > 0
    ? costAtVolume(committedTier, netAnalyticsGbPerDay) / netAnalyticsGbPerDay
    : pricing.paygRateUsd

  const tables: AnalysedTable[] = usage.rows.map(row => {
    const match = matchTable(row.tableName)
    const rate = rateForPlan(row, pricing, analyticsRateUsd)
    // Granted volume is not billed, so it is not costed and — critically — not
    // offered back as a saving further down. You cannot save on a free gigabyte.
    const grantedGbPerDay = Math.min(
      row.billableGbPerDay,
      grantedGbByTable.get(row.tableName) ?? 0,
    )
    const netBillableGbPerDay = Math.max(0, row.billableGbPerDay - grantedGbPerDay)
    const monthlyCostUsd = netBillableGbPerDay * rate * DAYS_PER_MONTH

    let status: AnalysedTable['status'] = 'ok'
    let potentialSavingUsd = 0

    if (row.billableGbPerDay > 0 && isAlwaysFreeTable(row.tableName)) {
      // Microsoft does not charge for this table. Billable volume means a
      // misconfiguration, and the whole amount is recoverable.
      status = 'should-be-free'
      potentialSavingUsd = monthlyCostUsd
    } else if (!match) {
      status = 'unclassified'
    } else if (match.needsUserInput && row.plan === 'Analytics' && row.billableGbPerDay > 0) {
      status = 'needs-input'
    } else if (
      match.recommendation === 'data-lake'
      && row.plan === 'Analytics'
      && row.billableGbPerDay > 0
      // Some tables cannot be switched to the Lake plan at all — Microsoft
      // publishes "Auxiliary / Lake table support: No" for them. Recommending
      // a move would be advice the customer physically cannot follow.
      && match.lakeCapable
      // Nothing left to move: the grant already covers this table in full.
      && netBillableGbPerDay > 0
    ) {
      status = 'move-to-lake'
      // Measured on NET volume. A granted gigabyte is already free, so moving
      // it to a cheaper tier saves nothing and must not be offered as if it did.
      potentialSavingUsd =
        netBillableGbPerDay * (pricing.paygRateUsd - pricing.dataLakeRateUsd) * DAYS_PER_MONTH
    } else if (
      match.recommendation === 'basic'
      && row.plan === 'Analytics'
      && row.billableGbPerDay > 0
      // Basic support is a published table attribute, verified in
      // tablePlanSupport.ts — same rule as the Lake guard above. A catalogue
      // entry can only reach 'basic' with basicCapable true, but the engine
      // must not trust the catalogue to have got that right.
      && match.basicCapable
      && netBillableGbPerDay > 0
    ) {
      status = 'move-to-basic'
      potentialSavingUsd =
        netBillableGbPerDay * (pricing.paygRateUsd - pricing.basicLogsRateUsd) * DAYS_PER_MONTH
    }

    return {
      ...row, match,
      guess: match ? null : guessTable(row.tableName),
      attribution: match ? null : attributeTable(row.tableName),
      grantedGbPerDay: round2(grantedGbPerDay),
      monthlyCostUsd, potentialSavingUsd, status,
    }
  })

  const sumBy = (f: (t: AnalysedTable) => number) => tables.reduce((a, t) => a + f(t), 0)
  const planCost = (plan: UsageRow['plan']) =>
    sumBy(t => (t.plan === plan ? t.monthlyCostUsd : 0))

  const currentMonthlyUsd = sumBy(t => t.monthlyCostUsd)
  const opportunities: Opportunity[] = []

  // The opportunities are NOT independent, and adding their savings together
  // would double-count. Moving tables to the Data Lake reduces Analytics volume,
  // which changes — often removes — the commitment tier worth buying. So they
  // are applied in sequence, each measured against the state the previous one
  // leaves behind, and the headline is the difference between the current and
  // final cost rather than a sum of parts.
  //
  // Order reflects what a customer would actually do: stop paying for data that
  // should be free, then move what does not need Analytics, then size a
  // commitment tier against whatever genuinely remains.

  // ── 1. Billed but should be free ──────────────────────────────────────────
  const wronglyBilled = tables.filter(t => t.status === 'should-be-free')
  if (wronglyBilled.length > 0) {
    opportunities.push({
      kind: 'billed-but-free',
      title: `${wronglyBilled.length} table${wronglyBilled.length === 1 ? ' is' : 's are'} being billed but should be free`,
      detail:
        `Microsoft does not charge for these. Billable volume here usually means the data is `
        + `arriving through a paid connector or a custom collection rule rather than the free `
        + `native one. Worth checking how each is being ingested.`,
      monthlySavingUsd: wronglyBilled.reduce((a, t) => a + t.potentialSavingUsd, 0),
      tables: wronglyBilled.map(t => t.tableName),
    })
  }

  // ── 2. Tier placement ─────────────────────────────────────────────────────
  const movable = tables.filter(t => t.status === 'move-to-lake')

  // Some of these are SHARED tables. CommonSecurityLog carries CEF from
  // firewalls, VPN concentrators and mail gateways alike; the index records
  // that several sources claim it and that they happen to agree on a tier.
  //
  // The tool has always computed that flag and never shown it. Everywhere else
  // this codebase is scrupulous about admitting what it does not know, and here
  // it was quietly resting a costed recommendation on an assumption about what
  // is INSIDE a table it cannot see into. Saying so is the point of the flag.
  const sharedTables = movable.filter(t => t.match?.ambiguousButAgreed)
  const sharedNote = sharedTables.length > 0
    ? ` ${sharedTables.map(t => t.tableName).join(', ')} ${sharedTables.length === 1 ? 'is a' : 'are'} `
      + `shared table${sharedTables.length === 1 ? '' : 's'} that several connectors write into. Every `
      + `source we know of agrees on this tier, but we cannot see which of them is actually feeding `
      + `yours — confirm what is in it before moving it.`
    : ''

  if (movable.length > 0) {
    opportunities.push({
      kind: 'tier-placement',
      title: `Move ${movable.length} high-volume table${movable.length === 1 ? '' : 's'} to the Data Lake tier`,
      detail:
        `These carry investigative rather than real-time detection value, and Data Lake ingestion `
        + `costs a fraction of Analytics. Two things to check before moving anything: alerts stop `
        + `working on a table once it moves to the Lake plan, and Microsoft allows only one plan `
        + `change per table per week — so verify nothing you detect on depends on these first.`
        + sharedNote,
      monthlySavingUsd: movable.reduce((a, t) => a + t.potentialSavingUsd, 0),
      tables: movable.map(t => t.tableName),
    })
  }

  // ── 3. Basic plan, for the tables where it is the only cheaper plan ───────
  //
  // These cannot use the Lake tier at all — first-party operational tables like
  // Perf and ContainerLogV2 publish "Auxiliary / Lake support: No". Basic bills
  // at roughly a fifth of the Analytics rate and, unlike the Lake plan, keeps
  // simple per-table alerts working.
  const basicMovable = tables.filter(t => t.status === 'move-to-basic')
  if (basicMovable.length > 0) {
    opportunities.push({
      kind: 'basic-plan',
      title: `Move ${basicMovable.length} table${basicMovable.length === 1 ? '' : 's'} to the Basic plan`,
      detail:
        `The Lake tier is not available for these tables, so Basic is the only cheaper plan they `
        + `support — at roughly a fifth of the Analytics rate. Basic keeps full KQL on the table and `
        + `simple per-table alerts, but check what depends on these tables first: the curated `
        + `Insights experiences they power — VM Insights, Container Insights, Application Insights — `
        + `do not work against the Basic plan, and resource-scoped queries stop too. Queries are `
        + `billed per GB scanned rather than included, scheduled analytics rules cannot query the `
        + `table, interactive retention is 30 days, and plan changes are limited to one per table `
        + `per week. The saving shown is on ingestion only, before any query charges.`,
      monthlySavingUsd: basicMovable.reduce((a, t) => a + t.potentialSavingUsd, 0),
      tables: basicMovable.map(t => t.tableName),
    })
  }

  // ── 4. Commitment tier, sized on what Analytics volume actually REMAINS ───
  //
  // Sizing against today's volume would recommend a tier the customer no longer
  // needs once the moves above are made, and promise a saving on gigabytes that
  // have already been counted as saved. Basic moves leave the Analytics pool
  // just as Lake moves do — commitment tiers cover neither plan.
  // Granted volume leaves the pool too. A commitment tier is bought against
  // what you are BILLED for, so sizing one against gigabytes Microsoft is
  // already giving away would recommend a larger tier than the workspace needs.
  const grantedAnalyticsGbPerDay = tables
    .filter(t => t.plan === 'Analytics')
    .reduce((a, t) => a + t.grantedGbPerDay, 0)

  const analyticsToday = Math.max(0, usage.analyticsBillableGbPerDay - grantedAnalyticsGbPerDay)
  const analyticsRemaining = Math.max(
    0,
    analyticsToday
      - wronglyBilled.filter(t => t.plan === 'Analytics').reduce((a, t) => a + t.billableGbPerDay, 0)
      - movable.reduce((a, t) => a + t.billableGbPerDay, 0)
      - basicMovable.reduce((a, t) => a + t.billableGbPerDay, 0),
  )

  // ── Reconciling the two pastes ────────────────────────────────────────────
  //
  // The daily series arrives from a SECOND, independent paste. Two things went
  // wrong when it was first wired up, both caught in review, and both are the
  // "measured against different bases" family this file already warns about.
  //
  // 1. LEVEL. Subtracting a cost derived from the daily paste's volume from a
  //    baseline derived from the per-table paste's volume compares two
  //    different workspaces whenever the pastes were taken days apart. It
  //    overstated a saving by 76% in review. The per-table paste is
  //    authoritative for HOW MUCH; the daily paste contributes only the SHAPE,
  //    so the series is rescaled to the per-table mean before it is used and
  //    every figure then shares one base.
  //
  // 2. SHAPE AFTER MOVES. Scaling every day by the proportion the moves remove
  //    assumes the moved tables are spread like everything else. When a moved
  //    table is spiky — a backfill, a migration, precisely the case this
  //    feature exists for — that invents a distribution that never existed, and
  //    review demonstrated it recommending a tier that costs MORE than the
  //    average-based sizing it replaces. Nothing in either paste says which days
  //    a given table's volume fell on, so the honest answer is that the shape
  //    cannot be carried across a material move. Below the threshold the
  //    distortion cannot change the answer enough to matter; above it, we say so
  //    and size on the average instead.
  const MATERIAL_MOVE_FRACTION = 0.1
  /** Below this the extrapolation to a month is guesswork, not measurement. */
  const MIN_DAYS_TO_SIZE_ON = 14

  const dailyMean = analyticsGbByDay?.length
    ? analyticsGbByDay.reduce((a, b) => a + b, 0) / analyticsGbByDay.length
    : 0
  const movedFraction = analyticsToday > 0
    ? (analyticsToday - analyticsRemaining) / analyticsToday
    : 0

  const tooFewDays = (analyticsGbByDay?.length ?? 0) < MIN_DAYS_TO_SIZE_ON
  const movesTooLarge = movedFraction > MATERIAL_MOVE_FRACTION
  const canUseDailyShape = dailyMean > 0 && !tooFewDays && !movesTooLarge

  const daysAfterMoves = canUseDailyShape && analyticsGbByDay
    // Rescale to the per-table mean, then to what the moves leave. The result
    // has mean exactly analyticsRemaining, so it shares a base with payg below.
    ? analyticsGbByDay.map(gb => gb * (analyticsRemaining / dailyMean))
    : null
  const dailySizing = daysAfterMoves ? sizeTierOnDailyVolume(daysAfterMoves, pricing) : null

  // A large gap between the two pastes' averages means they describe different
  // periods or different estates. The shape is still usable — it is rescaled
  // above — but the user should know the second query is stale.
  const pastesDiverge = dailyMean > 0 && analyticsToday > 0
    && Math.abs(dailyMean - analyticsToday) / analyticsToday > 0.2

  // What the workspace pays for Analytics volume TODAY. Where a commitment is
  // already in place that is the tier's daily cost plus overage at the tier
  // rate — not pay-as-you-go, which the mode used to assume for everyone.
  const existingTier = committedTier

  const options = computeTierOptions(analyticsRemaining, pricing)
  const payg = options.find(o => o.isPayg)!
  const averageRecommended = options.find(o => o.isRecommended && !o.isPayg)

  // The baseline every tier saving is measured against. On a committed
  // workspace, measuring against pay-as-you-go would invent a saving the
  // customer banked months ago.
  const baselineMonthlyUsd = existingTier
    ? costAtVolume(existingTier, analyticsRemaining) * DAYS_PER_MONTH
    : payg.monthlyCostUsd

  // Pay-as-you-go is a legitimate DESTINATION once an existing tier is known.
  //
  // This used to exclude it — `isRecommended && !isPayg` — which was right
  // while the mode assumed every customer was already on pay-as-you-go, since
  // recommending it to them is a no-op. With a stated tier it left a hole
  // exactly where an over-committed customer's money is: a workspace on the
  // 100 GB/day tier sending 20 GB/day pays $11,263/month against $3,275 on
  // pay-as-you-go, and the tool said nothing at all, because no TIER was
  // cheaper and PAYG was not allowed to be the answer.
  //
  // Being over-committed is the classic optimisation finding. It cannot be the
  // one case the tool cannot express.
  const cheapest = options.reduce((a, b) => (b.monthlyCostUsd < a.monthlyCostUsd ? b : a))
  const currentLabel = existingTier ? tierLabel(existingTier) : payg.label

  const recommendedLabel = dailySizing
    // tierSizing returns null for pay-as-you-go, which is now meaningful.
    ? dailySizing.bestTierLabel ?? payg.label
    : existingTier
      ? cheapest.label
      : averageRecommended?.label ?? null

  const recommended = recommendedLabel
    ? options.find(o => o.label === recommendedLabel) ?? null
    : null

  // Nothing to say when the workspace is already on the right thing.
  if (recommended && recommended.label !== currentLabel) {
    const saving = dailySizing
      ? baselineMonthlyUsd - dailySizing.bestMonthlyUsd
      : baselineMonthlyUsd - recommended.monthlyCostUsd
    if (saving > 0) {
      const movedNote = analyticsRemaining < analyticsToday
        ? ` — down from ${analyticsToday.toFixed(1)} once the moves above are made`
        : ''
      const variabilityNote = dailySizing
        ? ` Sized against your ${dailySizing.dayCount} actual days rather than the average: after the `
          + `moves above they range ${dailySizing.minGbPerDay.toFixed(1)} to `
          + `${dailySizing.maxGbPerDay.toFixed(1)} GB/day. `
          + (dailySizing.disagrees
            ? `Sizing on the average alone would have picked `
              + `${dailySizing.meanBasedTierLabel ?? 'pay-as-you-go'}, which costs more against those `
              + `same days. Overage above a commitment bills at that tier's own rate, so committing `
              + `slightly low costs little, while lowering a tier is only permitted every 31 days.`
            : `The average would have picked the same tier.`)
        : movesTooLarge
          ? ` Sized on the period average. Your daily volume data cannot be used here: the moves above `
            + `remove a large share of Analytics volume, and neither query says which days that volume `
            + `fell on, so carrying the daily shape across would invent a pattern rather than measure `
            + `one.`
          : tooFewDays && (analyticsGbByDay?.length ?? 0) > 0
            ? ` Sized on the period average. The daily volume data covers only `
              + `${analyticsGbByDay?.length} days, too few to extrapolate a month from.`
            : ` Sized on the period average — run the optional daily volume query for a tier sized `
              + `against your actual day-to-day variation.`
      // The 50 GB/day tier is a time-limited preview promotion. Estimate mode
      // discloses that; Analyse mode did not, so a saving that expires could
      // land in a client deliverable with no note against it.
      const promoNote = recommended.tier?.isPreviewPromo
        ? ` This is a preview promotional tier and Microsoft's published pricing for it runs to `
          + `${BILLING_RULES.promoTierExpiryDate}. Do not quote it beyond that date without checking.`
        : ''
      opportunities.push({
        kind: 'commitment-tier',
        title: recommended.isPayg
          ? 'Drop the commitment tier and move to pay-as-you-go'
          : existingTier
            ? `Change commitment tier from ${currentLabel} to ${recommended.label}`
            : `Move to the ${recommended.label} commitment tier`,
        detail:
          `Your Analytics-tier ingestion would be ${analyticsRemaining.toFixed(1)} GB/day${movedNote}. `
          + (recommended.isPayg
            // Only reachable when a tier is already in force, so this is always
            // a downgrade and the 31-day lock is the operative constraint.
            ? `That is below the point where any commitment tier pays for itself, so you are buying `
              + `capacity you are not using. A tier can only be LOWERED once every 31 days, so start `
              + `this now rather than after the other moves — and be sure the volume is not about to `
              + `come back, because reversing it is immediate but reversing it again is not.`
            : existingTier
              ? `Committing to ${recommended.label} instead of ${currentLabel} bills that volume at a `
                + `rate that fits it. Increasing a tier takes effect immediately; LOWERING one is `
                + `permitted only every 31 days, so if the moves above shrink your volume, change the `
                + `tier first or you pay the old commitment on data you no longer send.`
              : `Committing to ${recommended.label} bills that at the tier rate instead of `
                + `pay-as-you-go. Lowering a tier is only permitted every 31 days.`)
          + ` Basic and Auxiliary volume is excluded — commitment tiers do not `
          + `cover those plans.${promoNote}${variabilityNote}`,
        monthlySavingUsd: saving,
        tables: [],
      })
    }
  }

  // ── 5. Operational data paying Sentinel rates ─────────────────────────────
  //
  // Enabling Sentinel on a workspace means everything in it attracts Sentinel
  // charges, including data with no security purpose. Microsoft's own guidance
  // is to separate the two — but frames it as a trade-off, not a rule, so this
  // is reported as something to investigate rather than a costed saving.
  const operational = tables.filter(t => t.match?.category === 'operational' && t.billableGbPerDay > 0)
  const operationalMonthlyUsd = operational.reduce((a, t) => a + t.monthlyCostUsd, 0)

  // Some of these will already appear above as a tier move. That is not a
  // double-count — the headline excludes this item entirely — but a reader
  // seeing AppTraces as both an £82 saving and £103 "at stake" is entitled to
  // wonder which it is. They are alternatives: move the table to a cheaper
  // plan, or move it out of the workspace. Doing the second makes the first
  // moot, so the overlap is named rather than left to be inferred.
  const alsoActioned = operational.filter(
    t => t.status === 'move-to-basic' || t.status === 'move-to-lake',
  )
  const overlapNote = alsoActioned.length > 0
    ? ` ${alsoActioned.map(t => t.tableName).join(', ')} also appear${alsoActioned.length === 1 ? 's' : ''} `
      + `above as a tier move. These are alternatives rather than additions — moving a table out of `
      + `this workspace makes any plan change to it moot, so count one or the other, not both.`
    : ''

  if (operational.length > 0) {
    opportunities.push({
      kind: 'operational-data',
      title: `${operational.length} operational table${operational.length === 1 ? '' : 's'} paying Sentinel rates`,
      detail:
        `Enabling Sentinel on a workspace means everything in it attracts Sentinel charges, including `
        + `data with no security purpose. Microsoft recommends keeping operational data in a separate `
        + `workspace — but check two things first: combining volume can reach a commitment tier that `
        + `neither workspace would reach alone, and a workspace without Sentinel gets 31 days of free `
        + `retention rather than 90. Below roughly 100 GB/day combined, separating usually wins.`
        + overlapNote,
      // Deliberately zero: whether this is a saving depends on the two effects
      // above, so it must not inflate a headline number we would have to defend.
      monthlySavingUsd: 0,
      tables: operational.map(t => t.tableName),
      needsUserInput: true,
      contextUsd: operationalMonthlyUsd,
    })
  }

  // ── 6. Tables we will not guess about ─────────────────────────────────────
  const needsInput = tables.filter(t => t.status === 'needs-input')
  if (needsInput.length > 0) {
    opportunities.push({
      kind: 'needs-input',
      title: `${needsInput.length} table${needsInput.length === 1 ? '' : 's'} need${needsInput.length === 1 ? 's' : ''} your input`,
      detail:
        `These are shared tables that several different sources write into, and the recommended `
        + `tier differs depending on what is actually in yours. Tell us what each carries and we `
        + `can price the move — we will not guess, because getting it wrong could push data you `
        + `detect on into a tier with limited querying.`,
      monthlySavingUsd: 0,
      tables: needsInput.map(t => t.tableName),
      needsUserInput: true,
    })
  }

  opportunities.sort((a, b) => b.monthlySavingUsd - a.monthlySavingUsd)

  const unclassified = tables.filter(t => t.status === 'unclassified')

  return {
    tables,
    currentMonthlyUsd: round2(currentMonthlyUsd),
    analyticsMonthlyUsd: round2(planCost('Analytics')),
    basicMonthlyUsd: round2(planCost('Basic')),
    auxiliaryMonthlyUsd: round2(planCost('Auxiliary')),

    opportunities,
    // Safe to sum now: each opportunity was measured against the state the
    // previous one leaves, so the gigabytes are counted once.
    totalAddressableSavingUsd: round2(
      opportunities.reduce((a, o) => a + o.monthlySavingUsd, 0),
    ),

    unclassifiedGbPerDay: round2(unclassified.reduce((a, t) => a + t.billableGbPerDay, 0)),
    unclassifiedMonthlyUsd: round2(unclassified.reduce((a, t) => a + t.monthlyCostUsd, 0)),
    unclassifiedTableCount: unclassified.length,

    needsInputGbPerDay: round2(needsInput.reduce((a, t) => a + t.billableGbPerDay, 0)),

    currentTierLabel: existingTier ? tierLabel(existingTier) : 'Pay-as-you-go',
    recommendedTierLabel: recommended?.label ?? null,
    analyticsGbPerDayAfterMoves: round2(analyticsRemaining),
    p2GrantedGbPerDay: round2(p2GrantedGbPerDay),
    p2GrantSavedMonthlyUsd: round2(p2GrantedGbPerDay * pricing.paygRateUsd * DAYS_PER_MONTH),
    e5GrantedGbPerDay: round2(e5GrantedGbPerDay),
    e5GrantSavedMonthlyUsd: round2(e5GrantedGbPerDay * pricing.paygRateUsd * DAYS_PER_MONTH),
    dailySizing,
    dailyPasteDiverges: pastesDiverge,
    // Deliberately outside the ranked opportunities and outside the headline.
    // A filter's saving depends entirely on what the estate sends, and inventing
    // a percentage to make the number bigger is the failure this tool exists to
    // avoid. Offered as an action with the cost at stake, not as a claim.
    offeredTransforms: tables
      .filter(t => t.billableGbPerDay > 0)
      .flatMap(t =>
        transformsForTable(t.tableName, t.match?.dcrCapable ?? null)
          .map(transform => ({
            tableName: t.tableName,
            monthlyCostUsd: t.monthlyCostUsd,
            transform,
          })),
      )
      .sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd),
  }
}
