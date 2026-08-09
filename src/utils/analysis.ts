import { PricingBundle, STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../data/pricing'
import {
  matchTable, guessTable, attributeTable, isAlwaysFreeTable, type TableMatch,
} from '../data/tableIndex'
import type { ConnectorAttribution } from '../data/connectorIndex'
import type { TableGuess } from '../data/tableCatalogue'
import { computeTierOptions } from './tiers'
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

    const already = credited.get(row.tableName) ?? 0
    const available = row.billableGbPerDay - already
    if (available <= 0) continue

    const take = Math.min(available, remaining)
    credited.set(row.tableName, already + take)
    remaining -= take
  }
  return Math.max(0, allowanceGbPerDay) - remaining
}

/** Rate per GB for a table, by plan. Basic and Auxiliary are flat-rate. */
function rateForPlan(row: UsageRow, pricing: PricingBundle): number {
  if (row.plan === 'Basic') return pricing.basicLogsRateUsd
  if (row.plan === 'Auxiliary') return pricing.auxiliaryLogsRateUsd
  return pricing.paygRateUsd
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
  //
  // Order matters and is deliberate. Defender for Servers P2 goes first because
  // its pool is far larger per unit (500 MB per server against 5 MB per seat)
  // and its eligible set is narrow, so spending it first leaves the broader E5
  // pool for tables only E5 covers. Three tables sit in both lists, which is
  // exactly why allocation is tracked per table.
  const grantedGbByTable = new Map<string, number>()

  const p2AllowanceGbPerDay = licensing?.defenderServersP2Enabled
    ? Math.max(0, licensing.serverCount) * (P2_GRANT_MB_PER_SERVER_PER_DAY / 1000)
    : 0
  const p2GrantedGbPerDay = allocateGrant(
    usage.rows, isP2Eligible, p2AllowanceGbPerDay, grantedGbByTable,
  )

  const e5AllowanceGbPerDay = licensing && E5_QUALIFYING_LICENCES.has(licensing.licence)
    ? Math.max(0, licensing.licensedSeats) * (E5_GRANT_MB_PER_LICENSED_USER_PER_DAY / 1000)
    : 0
  const e5GrantedGbPerDay = allocateGrant(
    usage.rows, isE5Eligible, e5AllowanceGbPerDay, grantedGbByTable,
  )

  const tables: AnalysedTable[] = usage.rows.map(row => {
    const match = matchTable(row.tableName)
    const rate = rateForPlan(row, pricing)
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
  if (movable.length > 0) {
    opportunities.push({
      kind: 'tier-placement',
      title: `Move ${movable.length} high-volume table${movable.length === 1 ? '' : 's'} to the Data Lake tier`,
      detail:
        `These carry investigative rather than real-time detection value, and Data Lake ingestion `
        + `costs a fraction of Analytics. Two things to check before moving anything: alerts stop `
        + `working on a table once it moves to the Lake plan, and Microsoft allows only one plan `
        + `change per table per week — so verify nothing you detect on depends on these first.`,
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

  const options = computeTierOptions(analyticsRemaining, pricing)
  const payg = options.find(o => o.isPayg)!
  const averageRecommended = options.find(o => o.isRecommended && !o.isPayg)

  // Day-by-day sizing supersedes the average when we have it, because it is the
  // same arithmetic applied to real data rather than to a single flat number.
  const recommendedLabel = dailySizing ? dailySizing.bestTierLabel : averageRecommended?.label ?? null
  const recommended = recommendedLabel
    ? options.find(o => o.label === recommendedLabel) ?? null
    : null

  if (recommended) {
    const saving = dailySizing
      ? payg.monthlyCostUsd - dailySizing.bestMonthlyUsd
      : payg.monthlyCostUsd - recommended.monthlyCostUsd
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
      opportunities.push({
        kind: 'commitment-tier',
        title: `Move to the ${recommended.label} commitment tier`,
        detail:
          `Your Analytics-tier ingestion would be ${analyticsRemaining.toFixed(1)} GB/day${movedNote}. `
          + `Committing to ${recommended.label} bills that at the tier rate instead of `
          + `pay-as-you-go. Basic and Auxiliary volume is excluded — commitment tiers do not `
          + `cover those plans.${variabilityNote}`,
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
  if (operational.length > 0) {
    opportunities.push({
      kind: 'operational-data',
      title: `${operational.length} operational table${operational.length === 1 ? '' : 's'} paying Sentinel rates`,
      detail:
        `Enabling Sentinel on a workspace means everything in it attracts Sentinel charges, including `
        + `data with no security purpose. Microsoft recommends keeping operational data in a separate `
        + `workspace — but check two things first: combining volume can reach a commitment tier that `
        + `neither workspace would reach alone, and a workspace without Sentinel gets 31 days of free `
        + `retention rather than 90. Below roughly 100 GB/day combined, separating usually wins.`,
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

    currentTierLabel: 'Pay-as-you-go',
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
