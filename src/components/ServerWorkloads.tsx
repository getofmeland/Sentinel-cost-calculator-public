import { useState } from 'react'
import { ServerWorkload } from '../data/serverWorkloads'
import { TshirtSize, TSHIRT_SIZES } from '../data/tshirtSizes'
import { SourceEstimateRow } from '../utils/ingestion'
import { TableInfoPopover } from './TableInfoPopover'

interface Props {
  workloads: ServerWorkload[]
  counts: Record<string, number>
  levels: Record<string, string>
  sizeOverrides: Record<string, TshirtSize>
  globalSize: TshirtSize
  rows: SourceEstimateRow[]
  onCountChange: (id: string, n: number) => void
  onLevelChange: (id: string, level: string) => void
  onSizeChange: (id: string, size: TshirtSize) => void
}

export function ServerWorkloads({
  workloads,
  counts,
  levels,
  sizeOverrides,
  globalSize,
  rows,
  onCountChange,
  onLevelChange,
  onSizeChange,
}: Props) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false)

  const windowsWorkloads = workloads.filter(w => w.os === 'windows' && !w.advanced)
  const advancedWorkloads = workloads.filter(w => w.os === 'windows' && w.advanced)
  const linuxWorkloads = workloads.filter(w => w.os === 'linux')

  const totalWindows = workloads
    .filter(w => w.os === 'windows')
    .reduce((s, w) => s + (counts[w.id] ?? 0), 0)
  const totalLinux = workloads
    .filter(w => w.os === 'linux')
    .reduce((s, w) => s + (counts[w.id] ?? 0), 0)

  const windowsGbPerDay = rows
    .filter(r => r.source.p2Eligible === true)
    .reduce((s, r) => s + r.gbPerDay, 0)
  const linuxGbPerDay = rows
    .filter(r => !r.source.p2Eligible && !r.source.isFree && workloads.some(w => w.id === r.source.id))
    .reduce((s, r) => s + r.gbPerDay, 0)
  const combinedGbPerDay = windowsGbPerDay + linuxGbPerDay

  function renderWorkload(workload: ServerWorkload) {
    const count = counts[workload.id] ?? 0
    const levelId = levels[workload.id] ?? workload.defaultLevel
    const size = sizeOverrides[workload.id] ?? globalSize
    const isCustomSize = sizeOverrides[workload.id] !== undefined
    const row = rows.find(r => r.source.id === workload.id)
    const hasAllEvents = levelId === 'all'

    return (
      <div
        key={workload.id}
        className={`px-4 py-3 border-b border-white/5 last:border-0 ${count === 0 ? 'opacity-60' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Count stepper */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => onCountChange(workload.id, Math.max(0, count - 1))}
              disabled={count <= 0}
              aria-label={`Decrease ${workload.name} count`}
              className="w-6 h-6 flex items-center justify-center rounded border border-white/15 bg-surface text-light/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              −
            </button>
            <input
              type="number"
              min={0}
              value={count}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n)) onCountChange(workload.id, Math.max(0, n))
              }}
              aria-label={`Number of ${workload.name}`}
              className="w-12 px-1 py-0.5 text-xs font-mono text-center border border-white/15 rounded bg-surface text-light focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => onCountChange(workload.id, count + 1)}
              aria-label={`Increase ${workload.name} count`}
              className="w-6 h-6 flex items-center justify-center rounded border border-white/15 bg-surface text-light/60 hover:bg-white/10 text-sm leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              +
            </button>
          </div>

          {/* Name */}
          <div className="flex-1 min-w-[120px] flex items-center gap-1.5">
            <span className="text-xs font-medium text-light">{workload.name}</span>
            <TableInfoPopover
              sourceId={workload.os === 'windows' ? 'ws-security' : 'lx-syslog'}
              sourceName={workload.name}
            />
            {isCustomSize && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold">
                Custom
              </span>
            )}
          </div>

          {/* Collection level buttons */}
          <div role="group" aria-label={`Collection level for ${workload.name}`} className="flex gap-0.5 flex-shrink-0">
            {workload.collectionLevels.map(level => (
              <button
                key={level.id}
                type="button"
                aria-pressed={levelId === level.id}
                onClick={() => onLevelChange(workload.id, level.id)}
                className={[
                  'px-2 py-0.5 text-[10px] rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                  levelId === level.id
                    ? 'bg-primary text-white border-primary'
                    : 'border-white/15 text-light/50 hover:bg-white/5',
                ].join(' ')}
              >
                {level.label}
              </button>
            ))}
          </div>

          {/* S/M/L/XL size control */}
          <div role="group" aria-label={`Volume profile for ${workload.name}`} className="flex gap-0.5 flex-shrink-0">
            {TSHIRT_SIZES.map(s => (
              <button
                key={s.id}
                type="button"
                aria-pressed={size === s.id}
                title={s.description}
                onClick={() => onSizeChange(workload.id, s.id)}
                className={[
                  'px-1.5 py-0.5 text-[10px] rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                  size === s.id
                    ? 'bg-primary/80 text-white border-primary'
                    : 'border-white/10 text-light/40 hover:bg-white/5',
                ].join(' ')}
              >
                {s.id}
              </button>
            ))}
          </div>

          {/* GB/day */}
          <span className={`text-xs font-mono flex-shrink-0 w-20 text-right ${count > 0 ? 'text-light' : 'text-light/30'}`}>
            {count > 0 && row ? `${row.gbPerDay.toFixed(2)} GB/day` : '—'}
          </span>
        </div>

        {/* All Events DCR note */}
        {count > 0 && hasAllEvents && (
          <p className="mt-1.5 ml-[calc(1.5rem+3rem+0.375rem)] text-[10px] text-warning/80 leading-snug">
            Consider a DCR to route Common events to Analytics and verbose events to Data Lake.
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="px-6 py-1.5 bg-dark border-y border-white/10 sticky top-0 z-10">
        <span className="text-[10px] font-semibold text-light/40 uppercase tracking-[0.12em]">
          Server Workloads
        </span>
      </div>

      <div className="px-4 py-3 bg-dark/40 border-b border-white/10">
        <p className="text-[11px] text-light/50">
          Server volume varies by role and audit policy level — configure each separately.
          Windows Security Events are eligible for the Defender for Servers P2 grant; Linux Syslog is not.
        </p>
      </div>

      {/* Windows servers */}
      <div className="border-b border-white/10">
        <div className="px-4 py-2 bg-dark/20">
          <span className="text-[10px] font-semibold text-light/30 uppercase tracking-widest">Windows Servers</span>
        </div>
        {windowsWorkloads.map(renderWorkload)}

        {/* Advanced workloads collapsible */}
        <div>
          <button
            type="button"
            onClick={() => setAdvancedExpanded(v => !v)}
            aria-expanded={advancedExpanded}
            className="w-full px-4 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset"
          >
            <span className={`text-[10px] text-light/30 transition-transform ${advancedExpanded ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-[10px] font-semibold text-light/30 uppercase tracking-widest">
              Advanced workloads — DHCP, Print Server, Exchange
            </span>
          </button>
          {advancedExpanded && advancedWorkloads.map(renderWorkload)}
        </div>
      </div>

      {/* Linux servers */}
      <div className="border-b border-white/10">
        <div className="px-4 py-2 bg-dark/20">
          <span className="text-[10px] font-semibold text-light/30 uppercase tracking-widest">Linux Servers</span>
        </div>
        {linuxWorkloads.map(renderWorkload)}
      </div>

      {/* Summary */}
      {(totalWindows > 0 || totalLinux > 0) && (
        <div className="px-4 py-3 bg-dark/40 border-b border-white/10">
          <div className="flex items-center justify-between text-xs text-light/60 mb-2">
            <span>{totalWindows} Windows · {totalLinux} Linux</span>
            <span className="font-mono font-semibold text-light">
              {combinedGbPerDay.toFixed(2)} GB/day combined
            </span>
          </div>
          {windowsGbPerDay > 0 && (
            <div className="flex justify-between text-[11px] text-light/40">
              <span>Windows Security Events</span>
              <span className="font-mono">{windowsGbPerDay.toFixed(2)} GB/day</span>
            </div>
          )}
          {linuxGbPerDay > 0 && (
            <div className="flex justify-between text-[11px] text-light/40">
              <span>Linux Syslog</span>
              <span className="font-mono">{linuxGbPerDay.toFixed(2)} GB/day</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
