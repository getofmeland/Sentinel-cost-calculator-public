import { PricingBundle, STATIC_PRICING_BUNDLE, DAYS_PER_MONTH } from '../data/pricing'
import { matchTable, guessTable, isAlwaysFreeTable, type TableMatch } from '../data/tableIndex'
import type { TableGuess } from '../data/tableCatalogue'
import { computeTierOptions } from './tiers'
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
  /** Current monthly cost at the rate for its plan */
  monthlyCostUsd: number
  /** Set when moving this table to Data Lake would save money */
  potentialSavingUsd: number
  status: 'ok' | 'move-to-lake' | 'should-be-free' | 'needs-input' | 'unclassified'
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
): AnalysisResult {
  const tables: AnalysedTable[] = usage.rows.map(row => {
    const match = matchTable(row.tableName)
    const rate = rateForPlan(row, pricing)
    const monthlyCostUsd = row.billableGbPerDay * rate * DAYS_PER_MONTH

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
    ) {
      status = 'move-to-lake'
      potentialSavingUsd =
        row.billableGbPerDay * (pricing.paygRateUsd - pricing.dataLakeRateUsd) * DAYS_PER_MONTH
    }

    return {
      ...row, match,
      guess: match ? null : guessTable(row.tableName),
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

  // ── 3. Commitment tier, sized on what Analytics volume actually REMAINS ───
  //
  // Sizing against today's volume would recommend a tier the customer no longer
  // needs once the moves above are made, and promise a saving on gigabytes that
  // have already been counted as saved.
  const analyticsToday = usage.analyticsBillableGbPerDay
  const analyticsRemaining = Math.max(
    0,
    analyticsToday
      - wronglyBilled.filter(t => t.plan === 'Analytics').reduce((a, t) => a + t.billableGbPerDay, 0)
      - movable.reduce((a, t) => a + t.billableGbPerDay, 0),
  )

  const options = computeTierOptions(analyticsRemaining, pricing)
  const payg = options.find(o => o.isPayg)!
  const recommended = options.find(o => o.isRecommended && !o.isPayg)

  if (recommended) {
    const saving = payg.monthlyCostUsd - recommended.monthlyCostUsd
    if (saving > 0) {
      const movedNote = analyticsRemaining < analyticsToday
        ? ` — down from ${analyticsToday.toFixed(1)} once the moves above are made`
        : ''
      opportunities.push({
        kind: 'commitment-tier',
        title: `Move to the ${recommended.label} commitment tier`,
        detail:
          `Your Analytics-tier ingestion would be ${analyticsRemaining.toFixed(1)} GB/day${movedNote}. `
          + `Committing to ${recommended.label} bills that at the tier rate instead of `
          + `pay-as-you-go. Basic and Auxiliary volume is excluded — commitment tiers do not `
          + `cover those plans. Lowering a tier is only permitted every 31 days.`,
        monthlySavingUsd: saving,
        tables: [],
      })
    }
  }

  // ── 4. Operational data paying Sentinel rates ─────────────────────────────
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

  // ── 5. Tables we will not guess about ─────────────────────────────────────
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
  }
}
