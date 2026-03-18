import { useState } from 'react'
import {
  LICENCES,
  M365Licence,
  LicenceDefinition,
  ALWAYS_FREE_SOURCES,
  E5_DATA_GRANT_GB_PER_USER_PER_DAY,
  E5_GRANT_ELIGIBLE_SOURCE_IDS,
  DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY,
} from '../data/licenceBenefits'
import { computeLicenceBenefits } from '../utils/licenceBenefits'
import { SourceEstimateRow } from '../utils/ingestion'
import { fmtGbp } from '../utils/currency'
import { usePricing } from '../contexts/PricingContext'

interface Props {
  rows: SourceEstimateRow[]
  analyticsGbPerDay: number
  userCount: number
  licence: M365Licence
  onLicenceChange: (l: M365Licence) => void
  defenderEnabled: boolean
  onDefenderEnabledChange: (v: boolean) => void
  totalEnrolledServers: number
  windowsServerGbPerDay: number
  linuxServerGbPerDay: number
}

// ─── Licence card ─────────────────────────────────────────────────────────────

function LicenceCard({
  lic,
  selected,
  onClick,
}: {
  lic: LicenceDefinition
  selected: boolean
  onClick: () => void
}) {
  const isNone = lic.id === 'none'
  const isE5 = lic.id === 'e5'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'relative text-left px-3 py-3 rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        selected
          ? 'border-primary bg-primary/[0.06] shadow-sm'
          : 'border-white/10 bg-surface hover:border-white/20',
      ].join(' ')}
    >
      {isE5 && (
        <span className="absolute -top-2 right-2 bg-accent text-dark text-[10px] font-bold px-1.5 py-0.5 rounded">
          Recommended
        </span>
      )}

      <div className="flex gap-0.5 mb-2" aria-hidden="true">
        {[0, 1, 2, 3].map(i => {
          const filled =
            isNone ? false :
            lic.id === 'e3' ? i < 1 :
            lic.id === 'e5' ? i < 4 :
            i < 3
          return (
            <span
              key={i}
              className={`w-2 h-1.5 rounded-sm ${
                filled
                  ? selected ? 'bg-primary' : 'bg-light/40'
                  : 'bg-white/10'
              }`}
            />
          )
        })}
      </div>

      <div className={`text-xs font-bold leading-tight ${selected ? 'text-primary' : 'text-light'}`}>
        {lic.shortLabel}
      </div>
      <div className="text-[11px] text-light/50 mt-0.5 leading-tight">
        {lic.description}
      </div>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LicenceBenefits({
  rows,
  analyticsGbPerDay,
  userCount,
  licence,
  onLicenceChange,
  defenderEnabled,
  onDefenderEnabledChange,
  totalEnrolledServers,
  windowsServerGbPerDay,
  linuxServerGbPerDay,
}: Props) {
  const { pricing, fxRate } = usePricing()
  const [alwaysFreeExpanded, setAlwaysFreeExpanded] = useState(false)

  const benefits = computeLicenceBenefits(
    rows,
    analyticsGbPerDay,
    licence,
    userCount,
    defenderEnabled,
    totalEnrolledServers,
    pricing,
  )

  const selectedLicence = LICENCES.find(l => l.id === licence)!
  const isEmpty = rows.length === 0

  // E5 grant eligible rows (for display)
  const e5EligibleRows = rows.filter(
    r => r.logTier === 'analytics' && E5_GRANT_ELIGIBLE_SOURCE_IDS.has(r.source.id) && !r.source.isFree,
  )

  // Coverage percentage for Defender for Servers
  const defenderCoveragePct =
    benefits.defenderServersEligibleGbPerDay > 0
      ? Math.min(
          100,
          Math.round(
            (benefits.defenderServersGrantGbPerDay / benefits.defenderServersEligibleGbPerDay) * 100,
          ),
        )
      : 0

  return (
    <div className="bg-surface rounded-xl border border-white/10 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-light">Licence Benefits</h2>
        <p className="text-sm text-light/50 mt-0.5">
          These benefits reduce your Sentinel bill — all data is still ingested and available for detection.
        </p>
      </div>

      {/* Licence selector */}
      <div className="px-6 py-4 bg-dark border-b border-white/10">
        <p
          className="text-[11px] font-semibold text-light/40 uppercase tracking-widest mb-3"
          id="licence-group-label"
        >
          Your Microsoft 365 licence
        </p>
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-2"
          role="group"
          aria-labelledby="licence-group-label"
        >
          {LICENCES.map(lic => (
            <LicenceCard
              key={lic.id}
              lic={lic}
              selected={licence === lic.id}
              onClick={() => onLicenceChange(lic.id)}
            />
          ))}
        </div>
        {selectedLicence.includes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Included products">
            {selectedLicence.includes.map(product => (
              <span
                key={product}
                className="text-[11px] px-2 py-0.5 bg-primary/15 text-light rounded-full font-medium"
              >
                {product}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Always-Free Sources (collapsible) */}
      <div className="border-b border-white/10">
        <button
          type="button"
          onClick={() => setAlwaysFreeExpanded(v => !v)}
          aria-expanded={alwaysFreeExpanded}
          className="w-full px-6 py-3 flex items-center justify-between text-left hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        >
          <span className="text-xs font-semibold text-light/60 uppercase tracking-wide">
            Always-Free Sources
          </span>
          <span
            className={`text-light/40 transition-transform duration-200 ${alwaysFreeExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {alwaysFreeExpanded && (
          <div className="px-6 pb-4 space-y-2">
            <p className="text-xs text-light/40 mb-3">
              These sources are never billed for Analytics ingestion, regardless of licence.
            </p>
            {ALWAYS_FREE_SOURCES.map(src => (
              <div key={src.id} className="flex items-start gap-2">
                <span className="mt-0.5 text-primary text-xs">✓</span>
                <div>
                  <span className="text-xs font-medium text-light">{src.label}</span>
                  <span className="text-[11px] text-light/40 ml-1.5">{src.description}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-light/40">
            Select log sources in the Ingestion tab to see licence benefit calculations.
          </p>
        </div>
      ) : (
        <>
          {/* E5 Data Grant */}
          {benefits.e5IsActive && (
            <div className="px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-light">M365 E5 Data Grant</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary/20 border border-primary/40 text-primary uppercase tracking-widest">
                  Active
                </span>
              </div>
              <p className="text-xs text-light/50 mb-4">
                {E5_DATA_GRANT_GB_PER_USER_PER_DAY * 1000} MB/user/day billing credit applied to
                Entra ID and MDCA Analytics-tier ingestion only.
              </p>

              <div className="flex flex-col lg:flex-row gap-4">
                {/* Eligible sources */}
                <div className="flex-1 space-y-2">
                  <h4 className="text-[11px] font-semibold text-light/50 uppercase tracking-wide">
                    Eligible sources
                  </h4>
                  {e5EligibleRows.length === 0 ? (
                    <p className="text-xs text-light/40 italic">
                      Select Entra ID or MDCA in the Ingestion tab to see the grant.
                    </p>
                  ) : (
                    <>
                      {e5EligibleRows.map(r => (
                        <div
                          key={r.source.id}
                          className="flex items-center justify-between py-1.5 border-b border-white/10 last:border-0"
                        >
                          <span className="text-xs text-light">{r.source.label}</span>
                          <span className="text-xs font-mono text-light/60">
                            {r.gbPerDay.toFixed(2)} GB/day
                          </span>
                        </div>
                      ))}
                      <div className="rounded-lg bg-dark border border-white/10 px-4 py-3 space-y-1.5 text-xs font-mono mt-2">
                        <div className="flex justify-between">
                          <span className="text-light/50">Eligible GB/day</span>
                          <span className="text-light/70">{benefits.e5EligibleAnalyticsGbPerDay.toFixed(2)} GB/day</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-light/50">Allowance ({userCount.toLocaleString()} users × {E5_DATA_GRANT_GB_PER_USER_PER_DAY * 1000} MB)</span>
                          <span className="text-light/70">{benefits.e5AllowanceGbPerDay.toFixed(2)} GB/day</span>
                        </div>
                        <div className="flex justify-between border-t border-white/10 pt-1.5">
                          <span className="text-light/50">Grant (capped)</span>
                          <span className="text-primary font-semibold">{benefits.e5GrantGbPerDay.toFixed(2)} GB/day</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Saving summary */}
                <div className="lg:w-48">
                  <div className={`rounded-lg px-3 py-3 border ${benefits.e5SavedMonthlyUsd > 0 ? 'bg-accent/10 border-accent/40' : 'bg-dark border-white/10'}`}>
                    <p className="text-[10px] font-semibold text-light/60 uppercase tracking-widest">
                      Monthly saving
                    </p>
                    <p className={`text-2xl font-bold font-mono mt-1 leading-none ${benefits.e5SavedMonthlyUsd > 0 ? 'text-light' : 'text-light/30'}`}>
                      {benefits.e5SavedMonthlyUsd > 0 ? fmtGbp(benefits.e5SavedMonthlyUsd, 0, fxRate) : '—'}
                    </p>
                    {benefits.e5SavedMonthlyUsd > 0 && (
                      <p className="text-[10px] text-light/50 mt-1">
                        ${benefits.e5SavedMonthlyUsd.toLocaleString('en-GB', { maximumFractionDigits: 0 })} USD / month
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!benefits.e5IsActive && (
            <div className="px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-semibold text-light/50">M365 E5 Data Grant</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-light/30 uppercase tracking-widest">
                  Not applicable
                </span>
              </div>
              <p className="text-xs text-light/40">
                Select M365 E5 or M365 E3 + E5 Security above to activate the 5 MB/user/day billing credit for Entra ID and MDCA.
              </p>
            </div>
          )}

          {/* Defender for Servers P2 */}
          <div className="border-b border-white/10">
            <div className="px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-light">Defender for Servers Plan 2</h3>
                <p className="text-sm text-light/50 mt-0.5">
                  Each enrolled server includes {DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY * 1000} MB/day billing credit for
                  Windows Security Events (Linux Syslog is not eligible).
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={defenderEnabled}
                onClick={() => onDefenderEnabledChange(!defenderEnabled)}
                aria-label="Toggle Defender for Servers Plan 2"
                className={[
                  'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  defenderEnabled ? 'bg-primary' : 'bg-[#2e3245]',
                ].join(' ')}
              >
                <span
                  className={[
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform',
                    defenderEnabled ? 'translate-x-5' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>
            </div>

            {defenderEnabled && (
              <div className="px-6 pb-4">
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Coverage info */}
                  <div className="flex-1 space-y-4">
                    <div>
                      <p className="text-xs text-light/70 mb-1">
                        {totalEnrolledServers} servers enrolled × {DEFENDER_SERVERS_FREE_GB_PER_SERVER_PER_DAY * 1000} MB/day
                        = {benefits.defenderServersAllowanceGbPerDay.toFixed(2)} GB/day allowance
                      </p>
                      <p className="text-[11px] text-light/40">
                        Server counts are configured in the Ingestion tab → Server Workloads section.
                      </p>
                    </div>

                    {/* Server source breakdown */}
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-semibold text-light/50 uppercase tracking-wide">
                        Server log sources
                      </h4>
                      {windowsServerGbPerDay > 0 && (
                        <div className="flex items-center justify-between py-1.5 border-b border-white/10">
                          <span className="text-xs text-light">Windows Security Events</span>
                          <span className="text-xs font-mono text-primary">{windowsServerGbPerDay.toFixed(2)} GB/day (eligible)</span>
                        </div>
                      )}
                      {linuxServerGbPerDay > 0 && (
                        <div className="flex items-center justify-between py-1.5 border-b border-white/10">
                          <span className="text-xs text-light/60">Linux Syslog</span>
                          <span className="text-xs font-mono text-light/40">{linuxServerGbPerDay.toFixed(2)} GB/day (not eligible)</span>
                        </div>
                      )}
                      {benefits.defenderServersEligibleGbPerDay === 0 && (
                        <p className="text-xs text-light/40 italic">
                          Add Windows server workloads in the Ingestion tab to see savings.
                        </p>
                      )}
                      {benefits.defenderServersEligibleGbPerDay > 0 && (
                        <div className="pt-1">
                          <div className="flex items-center justify-between text-xs text-light/50 mb-1.5">
                            <span>Free allowance coverage</span>
                            <span className="font-semibold text-primary">{defenderCoveragePct}%</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-[#2e3245] overflow-hidden" aria-hidden="true">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-500"
                              style={{ width: `${defenderCoveragePct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-light/40 mt-1">
                            <span>{benefits.defenderServersGrantGbPerDay.toFixed(2)} GB/day covered</span>
                            <span>
                              {Math.max(0, benefits.defenderServersEligibleGbPerDay - benefits.defenderServersGrantGbPerDay).toFixed(2)} GB/day billed
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Saving summary */}
                  <div className="lg:w-48">
                    <div className={`rounded-lg px-3 py-3 border ${benefits.defenderServersSavedMonthlyUsd > 0 ? 'bg-accent/10 border-accent/40' : 'bg-dark border-white/10'}`}>
                      <p className="text-[10px] font-semibold text-light/60 uppercase tracking-widest">
                        Monthly saving
                      </p>
                      <p className={`text-2xl font-bold font-mono mt-1 leading-none ${benefits.defenderServersSavedMonthlyUsd > 0 ? 'text-light' : 'text-light/30'}`}>
                        {benefits.defenderServersSavedMonthlyUsd > 0
                          ? fmtGbp(benefits.defenderServersSavedMonthlyUsd, 0, fxRate)
                          : '—'}
                      </p>
                      {benefits.defenderServersSavedMonthlyUsd > 0 && (
                        <p className="text-[10px] text-light/50 mt-1">
                          ${benefits.defenderServersSavedMonthlyUsd.toLocaleString('en-GB', { maximumFractionDigits: 0 })} USD / month
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Benefits summary */}
          <div className="px-6 py-4 bg-dark">
            <h3 className="text-xs font-semibold text-light/50 uppercase tracking-wide mb-3">
              Benefits summary
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg px-3 py-2.5 bg-surface border border-white/10 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-light/50">Total analytics</span>
                  <span className="font-mono text-light/70">{analyticsGbPerDay.toFixed(2)} GB/day</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-light/50">Total credits</span>
                  <span className="font-mono text-primary font-semibold">−{benefits.totalGrantGbPerDay.toFixed(2)} GB/day</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-1">
                  <span className="text-light/50">Billable analytics</span>
                  <span className="font-mono text-light font-semibold">{benefits.billableAnalyticsGbPerDay.toFixed(2)} GB/day</span>
                </div>
              </div>

              <div className={`rounded-lg px-3 py-2.5 border ${benefits.totalSavedMonthlyUsd > 0 ? 'bg-accent/10 border-accent/30' : 'bg-surface border-white/10'}`}>
                <p className="text-[10px] font-semibold text-light/50 uppercase tracking-widest">
                  Total monthly saving
                </p>
                <p className={`text-2xl font-bold font-mono mt-1 leading-none ${benefits.totalSavedMonthlyUsd > 0 ? 'text-light' : 'text-light/30'}`}>
                  {benefits.totalSavedMonthlyUsd > 0 ? fmtGbp(benefits.totalSavedMonthlyUsd, 0, fxRate) : '—'}
                </p>
              </div>

              <div className="rounded-lg px-3 py-2.5 bg-surface border border-white/10 text-xs space-y-1">
                <p className="text-[10px] font-semibold text-light/40 uppercase tracking-widest mb-2">
                  Commitment tiers use
                </p>
                <p className="text-sm font-mono font-bold text-primary">
                  {benefits.billableAnalyticsGbPerDay.toFixed(2)} GB/day
                </p>
                <p className="text-[11px] text-light/40 leading-snug">
                  Post-benefit billable Analytics GB — the basis for tier selection below.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="px-6 py-3 border-t border-white/10 text-[11px] text-light/40 leading-relaxed">
        All data is still ingested into Sentinel for full detection and investigation coverage.
        Billing credits reduce the Analytics GB charged — they do not affect total ingestion volume.
        E5 data grant applies only to Entra ID and MDCA sources on the Analytics tier.
        Defender for Servers P2 credit applies to Windows Security Events only — Linux Syslog is not eligible.
      </div>
    </div>
  )
}
