import {
  type ComputeConfig,
  type GraphSchedule,
  computeComputeCosts,
  GRAPH_SCHEDULE_LABELS,
  GRAPH_SCHEDULE_RUNS_PER_MONTH,
} from '../utils/compute'
import {
  ADI_POOL_VCORES,
  GRAPH_BUILD_VCORES,
  GRAPH_QUERY_VCORES,
  ADI_SESSION_STARTUP_MINUTES,
  type AdiPoolVCores,
} from '../data/pricing'
import { fmtCurrency } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'

interface Props {
  config: ComputeConfig
  onChange: (next: ComputeConfig) => void
}

const SCHEDULES: GraphSchedule[] = [
  'on-demand', 'monthly', 'weekly', 'daily', 'hourly', 'by-the-minute',
]

/** Frequencies where a modest build turns into a very large monthly bill. */
const HIGH_FREQUENCY: GraphSchedule[] = ['hourly', 'by-the-minute']

const POOL_LABELS: Record<AdiPoolVCores, string> = {
  12: 'Small',
  32: 'Medium',
  80: 'Large',
}

const inputClass =
  'bg-surface-raised border border-white/15 text-light rounded-md px-2.5 py-1.5 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40'

function NumberField({
  id, label, value, onChange, disabled, min = 0, step = 1, suffix,
}: {
  id: string; label: string; value: number; onChange: (n: number) => void
  disabled?: boolean; min?: number; step?: number; suffix?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-light/60">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          min={min}
          step={step}
          value={value}
          disabled={disabled}
          onChange={e => {
            const n = Number.parseFloat(e.target.value)
            onChange(Number.isFinite(n) && n >= min ? n : min)
          }}
          className={`${inputClass} w-24`}
        />
        {suffix && <span className="text-[11px] text-light/60">{suffix}</span>}
      </div>
    </div>
  )
}

/**
 * Opt-in compute meters: custom graph and notebook (Advanced Data Insights).
 *
 * Both default off. The panel deliberately shows the vCore arithmetic on
 * screen — a graph build costs 49 x the hourly rate, and nobody believes
 * £183.75 an hour without seeing where it comes from.
 */
export function ComputeCostPanel({ config, onChange }: Props) {
  const { pricing, fxRate, eurRate, displayCurrency } = usePricing()
  const costs = computeComputeCosts(config, pricing)

  const money = (usd: number, decimals = 0) =>
    fmtCurrency(usd, displayCurrency, fxRate, eurRate, decimals)

  const set = <K extends keyof ComputeConfig>(key: K, value: ComputeConfig[K]) =>
    onChange({ ...config, [key]: value })

  const showFrequencyWarning = config.graphEnabled && HIGH_FREQUENCY.includes(config.graphSchedule)

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-light">Data Lake compute</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 border border-warning/40 text-light font-semibold uppercase tracking-wide">
            Opt-in
          </span>
        </div>
        <p className="text-sm text-light/60 mt-1 max-w-2xl">
          Billed per vCore-hour rather than per GB. Neither is charged simply by enabling the data
          lake — the hunting graph and blast-radius views in the Defender portal are free. These
          meters apply only when you build a custom graph or run notebooks yourself.
        </p>
        <p className="text-xs text-light/60 mt-2 max-w-2xl">
          Microsoft publishes no typical consumption figures for either meter, so nothing here is
          pre-filled with a guess. Enter the activity you expect; the arithmetic is shown so you can
          check it.
        </p>
      </div>

      {/* ── Custom graph ────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-light">Custom graph</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary-text font-medium uppercase">
                Preview
              </span>
            </div>
            <p className="text-xs text-light/60 mt-0.5 max-w-xl">
              Graphs you author in notebooks. Builds run on {GRAPH_BUILD_VCORES} vCores and queries
              on {GRAPH_QUERY_VCORES}, so a build costs {money(costs.graphBuildHourlyRateUsd, 2)} per
              hour it runs.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.graphEnabled}
            onClick={() => set('graphEnabled', !config.graphEnabled)}
            className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              config.graphEnabled ? 'bg-primary' : 'bg-surface-inset'
            }`}
          >
            <span className="sr-only">Enable custom graph costs</span>
            <span
              aria-hidden="true"
              className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                config.graphEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {config.graphEnabled && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="graph-schedule" className="text-[11px] text-light/60">
                  Rebuild schedule
                </label>
                <select
                  id="graph-schedule"
                  value={config.graphSchedule}
                  onChange={e => set('graphSchedule', e.target.value as GraphSchedule)}
                  className={inputClass}
                >
                  {SCHEDULES.map(s => (
                    <option key={s} value={s} className="bg-surface">
                      {GRAPH_SCHEDULE_LABELS[s]}
                      {s !== 'on-demand' && ` — ${Math.round(GRAPH_SCHEDULE_RUNS_PER_MONTH[s]).toLocaleString()} /mo`}
                    </option>
                  ))}
                </select>
              </div>

              {config.graphSchedule === 'on-demand' && (
                <NumberField
                  id="graph-builds" label="Builds per month"
                  value={config.graphBuildsPerMonth}
                  onChange={n => set('graphBuildsPerMonth', n)}
                />
              )}

              <NumberField
                id="graph-build-mins" label="Build duration" suffix="min"
                value={config.graphBuildMinutes} step={1}
                onChange={n => set('graphBuildMinutes', n)}
              />

              <NumberField
                id="graph-notebook-mins" label="Notebook time per build" suffix="min"
                value={config.graphBuildNotebookMinutes} step={1}
                onChange={n => set('graphBuildNotebookMinutes', n)}
              />

              <NumberField
                id="graph-queries" label="Queries per month"
                value={config.graphQueriesPerMonth}
                onChange={n => set('graphQueriesPerMonth', n)}
              />
            </div>

            <p className="text-[11px] text-light/60 max-w-2xl">
              Build duration seeds at 5 minutes — Microsoft's illustrative figure from their billing
              example, not a measured typical value. They do not document what makes a build take
              longer, and it is the single largest influence on this cost, so treat it as your own
              assumption.
            </p>

            {/* The arithmetic, shown rather than asserted. */}
            <div className="rounded-lg bg-surface-raised border border-white/10 px-4 py-3 text-xs font-mono text-light/80 space-y-1">
              <div>
                {GRAPH_BUILD_VCORES} vCores × {money(pricing.graphRateUsdPerVCoreHour, 2)}/vCore-hr
                {' = '}
                <span className="text-light">{money(costs.graphBuildHourlyRateUsd, 2)}</span> per build hour
              </div>
              <div>
                {Math.round(costs.graphBuildsPerMonth).toLocaleString()} builds ×{' '}
                {config.graphBuildMinutes} min ={' '}
                <span className="text-primary-text font-semibold">{money(costs.graphBuildMonthlyUsd)}</span>/mo
              </div>
              {costs.graphQueryMonthlyUsd > 0 && (
                <div>
                  {config.graphQueriesPerMonth.toLocaleString()} queries × {GRAPH_QUERY_VCORES} vCores ={' '}
                  <span className="text-primary-text font-semibold">{money(costs.graphQueryMonthlyUsd)}</span>/mo
                </div>
              )}
              {costs.graphNotebookMonthlyUsd > 0 && (
                <div className="text-light/60">
                  + notebook compute for the build ={' '}
                  <span className="text-light/80">{money(costs.graphNotebookMonthlyUsd)}</span>/mo
                </div>
              )}
            </div>

            {showFrequencyWarning && (
              <div className="rounded-lg px-4 py-3 bg-danger/15 border border-danger/40 text-xs text-light">
                <p className="font-semibold">Rebuild frequency dominates this cost.</p>
                <p className="mt-1 text-light/80">
                  At this schedule the same build costs{' '}
                  <span className="font-semibold">{money(costs.graphBuildMonthlyUsd)}</span> a month.
                  Rebuilding daily instead would cost roughly{' '}
                  {money(
                    costs.graphBuildMonthlyUsd
                      * (GRAPH_SCHEDULE_RUNS_PER_MONTH.daily / GRAPH_SCHEDULE_RUNS_PER_MONTH[config.graphSchedule]),
                  )}
                  . Note that Microsoft's spending thresholds can cap notebook compute but not graph.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Notebooks / ADI ─────────────────────────────────────────────── */}
      <div className="px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-sm font-medium text-light">Notebooks (Advanced Data Insights)</span>
            <p className="text-xs text-light/60 mt-0.5 max-w-xl">
              Spark compute for notebook sessions and scheduled jobs on the data lake. You pick the
              pool; cost is pool size × time the session is active.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.adiEnabled}
            onClick={() => set('adiEnabled', !config.adiEnabled)}
            className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              config.adiEnabled ? 'bg-primary' : 'bg-surface-inset'
            }`}
          >
            <span className="sr-only">Enable notebook compute costs</span>
            <span
              aria-hidden="true"
              className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                config.adiEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {config.adiEnabled && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="adi-pool" className="text-[11px] text-light/60">Pool size</label>
                <select
                  id="adi-pool"
                  value={config.adiPoolVCores}
                  onChange={e => set('adiPoolVCores', Number(e.target.value) as AdiPoolVCores)}
                  className={inputClass}
                >
                  {ADI_POOL_VCORES.map(v => (
                    <option key={v} value={v} className="bg-surface">
                      {POOL_LABELS[v]} — {v} vCores
                    </option>
                  ))}
                </select>
              </div>

              <NumberField
                id="adi-interactive" label="Interactive hours" suffix="/mo"
                value={config.adiInteractiveHoursPerMonth}
                onChange={n => set('adiInteractiveHoursPerMonth', n)}
              />
              <NumberField
                id="adi-sessions" label="Sessions started" suffix="/mo"
                value={config.adiInteractiveSessionsPerMonth}
                onChange={n => set('adiInteractiveSessionsPerMonth', n)}
              />
              <NumberField
                id="adi-scheduled" label="Scheduled job hours" suffix="/mo"
                value={config.adiScheduledHoursPerMonth}
                onChange={n => set('adiScheduledHoursPerMonth', n)}
              />
            </div>

            <div className="rounded-lg bg-surface-raised border border-white/10 px-4 py-3 text-xs font-mono text-light/80 space-y-1">
              <div>
                {config.adiPoolVCores} vCores ×{' '}
                {money(pricing.advancedDataInsightsRateUsdPerVCoreHour, 2)}/vCore-hr ={' '}
                <span className="text-light">{money(costs.adiPoolHourlyRateUsd, 2)}</span> per hour
              </div>
              {costs.adiStartupMonthlyUsd > 0 && (
                <div className="text-light/60">
                  + {ADI_SESSION_STARTUP_MINUTES} min Spark start-up per session ={' '}
                  <span className="text-light/80">{money(costs.adiStartupMonthlyUsd)}</span>/mo
                </div>
              )}
            </div>

            <p className="text-[11px] text-light/60 max-w-2xl">
              Sessions bill from start-up, which takes about {ADI_SESSION_STARTUP_MINUTES} minutes
              before any of your code runs, and keep billing while idle until they time out.
            </p>
          </div>
        )}
      </div>

      {/* ── Total ───────────────────────────────────────────────────────── */}
      {costs.totalMonthlyUsd > 0 && (
        <div
          className="px-6 py-4 border-t border-white/10 flex items-center justify-between bg-surface-raised"
          role="status"
          aria-live="polite"
        >
          <span className="text-xs font-semibold text-light/60 uppercase tracking-widest">
            Compute total
          </span>
          <span className="text-xl font-bold font-mono text-light">
            {money(costs.totalMonthlyUsd)}
            <span className="text-xs font-normal text-light/60 ml-1">/mo</span>
          </span>
        </div>
      )}
    </div>
  )
}
