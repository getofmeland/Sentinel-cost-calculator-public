import { LICENCES, type M365Licence } from '../../data/licenceBenefits'
import type { LicensingInput } from '../../utils/analysis'

interface Props {
  value: LicensingInput
  onChange: (next: LicensingInput) => void
}

/**
 * Licensing inputs for Analyse mode.
 *
 * Analyse mode charged full rate for data Microsoft gives away until this
 * existed. On a real tenant that overstated the bill by about 40%, and the
 * larger share came from Defender for Servers rather than E5 — which is why
 * the server count sits alongside the licence rather than behind it.
 *
 * The seat field is labelled hard. Microsoft grants per LICENSED SEAT, and a
 * tenant with 300 accounts, 70 staff and 100 E5 licences has three plausible
 * numbers to type. Two of them over-credit the grant and understate the bill.
 */
export function LicensingPanel({ value, onChange }: Props) {
  const set = <K extends keyof LicensingInput>(key: K, v: LicensingInput[K]) =>
    onChange({ ...value, [key]: v })

  const qualifies = value.licence === 'e5' || value.licence === 'e5-security'

  return (
    <div className="bg-surface rounded-xl border border-white/10 px-6 py-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-light">Licensing</p>
        <p className="text-xs text-light/60 mt-0.5 max-w-2xl">
          Microsoft gives away a slice of this data. Without these, the figures below are gross
          and will overstate what you actually pay.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-medium text-light/80 mb-1">Microsoft 365 licence</span>
          <select
            value={value.licence}
            onChange={e => set('licence', e.target.value as M365Licence)}
            className="w-full px-2 py-1.5 text-sm rounded-md bg-surface-raised border border-white/15 text-light focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {LICENCES.map(l => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-light/80 mb-1">
            Licensed seats {qualifies && <span className="text-accent-text">· not headcount</span>}
          </span>
          <input
            type="number"
            min={0}
            step={10}
            value={value.licensedSeats}
            disabled={!qualifies}
            onChange={e => set('licensedSeats', Math.max(0, Number(e.target.value) || 0))}
            className="w-full px-2 py-1.5 text-sm rounded-md bg-surface-raised border border-white/15 text-light font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <span className="block text-[11px] text-light/60 mt-1">
            {qualifies
              ? 'Seats of the qualifying SKU only. Guests, service accounts and F-series users earn nothing, and counting them over-credits the grant.'
              : 'The 5 MB/user/day grant needs E5 or E5 Security.'}
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="flex items-center gap-2 text-xs font-medium text-light/80 mb-1">
            <input
              type="checkbox"
              checked={value.defenderServersP2Enabled}
              onChange={e => set('defenderServersP2Enabled', e.target.checked)}
              className="accent-primary"
            />
            Defender for Servers Plan 2 is enabled on this workspace
          </span>
          <input
            type="number"
            min={0}
            step={10}
            value={value.serverCount}
            disabled={!value.defenderServersP2Enabled}
            onChange={e => set('serverCount', Math.max(0, Number(e.target.value) || 0))}
            aria-label="Number of servers reporting to this workspace"
            className="w-full sm:w-40 px-2 py-1.5 text-sm rounded-md bg-surface-raised border border-white/15 text-light font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <span className="block text-[11px] text-light/60 mt-1">
            500 MB per server per day, pooled across the workspace. It must be enabled on the
            <em> workspace</em> — enabling it only on the subscription grants nothing.
          </span>
        </label>
      </div>
    </div>
  )
}
