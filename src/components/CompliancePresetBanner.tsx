import { useId } from 'react'
import { COMPLIANCE_PRESETS, CompliancePresetId, getPreset } from '../data/compliancePresets'

interface Props {
  activePresetId: CompliancePresetId
  mifidExtended: boolean
  onPresetChange: (id: CompliancePresetId) => void
  onMifidExtensionToggle: () => void
  analyticsCapWarning: boolean
}

export function CompliancePresetBanner({
  activePresetId,
  mifidExtended,
  onPresetChange,
  onMifidExtensionToggle,
  analyticsCapWarning,
}: Props) {
  const activePreset = getPreset(activePresetId)
  const noteId = useId()
  const hasNote = activePresetId !== 'custom' && Boolean(activePreset.note)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-light/50 uppercase tracking-widest">
          Compliance preset
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {activePreset.hasExtensionToggle && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mifidExtended}
                onChange={onMifidExtensionToggle}
                className="h-5 w-5 accent-primary cursor-pointer"
              />
              <span className="text-xs text-light/60">Extend to 7 years (at FCA request)</span>
            </label>
          )}
          <select
            value={activePresetId}
            onChange={e => onPresetChange(e.target.value as CompliancePresetId)}
            aria-label="Compliance preset"
            aria-describedby={hasNote ? noteId : undefined}
            className="text-xs border border-white/15 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-light/70"
          >
            {COMPLIANCE_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasNote && (
        <p id={noteId} className="text-xs text-light/60">{activePreset.note}</p>
      )}

      {analyticsCapWarning && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2"
        >
          <span className="text-warning text-sm leading-none mt-0.5" aria-hidden="true">⚠</span>
          <p className="text-xs text-light/80">
            Analytics tier supports a maximum of 2 years retention. Sources requiring longer retention should be routed to Data Lake via the Tier Placement tab.
          </p>
        </div>
      )}
    </div>
  )
}
