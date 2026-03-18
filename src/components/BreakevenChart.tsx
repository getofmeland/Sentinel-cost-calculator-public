import { useState, useEffect, useRef } from 'react'
import { usePricing } from '../contexts/PricingContext'
import { costAtVolume, breakevenForTier } from '../utils/tiers'
import { CommitmentTier } from '../data/pricing'

interface Props {
  billableGbPerDay: number
  dataLakeGbPerDay?: number
}

const SVG_W = 600
const SVG_H = 300
const MARGIN = { top: 24, right: 24, bottom: 44, left: 72 }
const PLOT_W = SVG_W - MARGIN.left - MARGIN.right
const PLOT_H = SVG_H - MARGIN.top - MARGIN.bottom

const COLOR_PAYG = '#6B7D8F'
const COLOR_BEST = '#F1B434'
const TIER_COLORS = ['#00A3AD', '#0095C8', '#E87722', '#115E67', '#8B5CF6', '#10B981', '#F472B6']

const Y_TICK_CANDIDATES = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000]

function computeXMax(billableGbPerDay: number, tiers: CommitmentTier[], showFullRange: boolean): number {
  if (showFullRange) return 5000
  const nextTier = tiers.find(t => t.gbPerDay > billableGbPerDay)
  const lastTier = tiers[tiers.length - 1]
  const ref = nextTier?.gbPerDay ?? lastTier?.gbPerDay ?? 100
  return Math.max(75, Math.min(5000, ref * 1.5))
}

function computeSmartYTicks(rawYMax: number): number[] {
  for (const interval of Y_TICK_CANDIDATES) {
    const top = Math.ceil(rawYMax / interval) * interval
    const numTicks = top / interval + 1 // includes 0
    if (numTicks >= 4 && numTicks <= 8) {
      const ticks: number[] = []
      for (let i = 0; i < numTicks; i++) ticks.push(i * interval)
      return ticks
    }
  }
  // Fallback
  const interval = Math.ceil(rawYMax / 5 / 10) * 10
  return Array.from({ length: 6 }, (_, i) => i * interval)
}

function toDisplay(usd: number, showGbp: boolean, fxRate: number): number {
  return showGbp ? usd * fxRate : usd
}

function fmtCurrency(value: number, showGbp: boolean): string {
  if (showGbp) {
    return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function scaleX(gb: number, xMax: number): number {
  return MARGIN.left + (gb / xMax) * PLOT_W
}

function scaleY(cost: number, yMax: number): number {
  return MARGIN.top + PLOT_H - (cost / yMax) * PLOT_H
}

function tierColor(tier: CommitmentTier, tiers: CommitmentTier[], isBest: boolean): string {
  if (isBest) return COLOR_BEST
  return TIER_COLORS[tiers.indexOf(tier) % TIER_COLORS.length]
}

export function BreakevenChart({ billableGbPerDay, dataLakeGbPerDay = 0 }: Props) {
  const { pricing, fxRate } = usePricing()
  const { commitmentTiers, paygRateUsd } = pricing

  // Debounced billable for axis recalculation (200ms delay)
  const [debouncedBillable, setDebouncedBillable] = useState(billableGbPerDay)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedBillable(billableGbPerDay), 200)
    return () => clearTimeout(id)
  }, [billableGbPerDay])

  const [showFullRange, setShowFullRange] = useState(false)
  const [showGbp, setShowGbp] = useState(true)
  const [enabledTiers, setEnabledTiers] = useState<Set<number>>(() => new Set(commitmentTiers.map(t => t.gbPerDay)))

  // Hover tooltip
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverGb, setHoverGb] = useState<number | null>(null)

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W
    const plotX = svgX - MARGIN.left
    if (plotX < 0 || plotX > PLOT_W) {
      setHoverGb(null)
      return
    }
    const gb = (plotX / PLOT_W) * xMax
    setHoverGb(gb)
  }

  function handleSvgMouseLeave() {
    setHoverGb(null)
  }

  function toggleTier(gbPerDay: number) {
    setEnabledTiers(prev => {
      const next = new Set(prev)
      if (next.has(gbPerDay)) {
        next.delete(gbPerDay)
      } else {
        next.add(gbPerDay)
      }
      return next
    })
  }

  const xMax = computeXMax(debouncedBillable, commitmentTiers, showFullRange)
  const visibleTiers = commitmentTiers.filter(t => enabledTiers.has(t.gbPerDay) && t.gbPerDay <= xMax * 1.01)

  // Best option at customer volume (raw billableGbPerDay for customer marker)
  const paygCostUsd = billableGbPerDay * paygRateUsd
  let bestCostUsd = paygCostUsd
  let bestTier: CommitmentTier | null = null
  for (const t of commitmentTiers) {
    const c = costAtVolume(t, billableGbPerDay)
    if (c < bestCostUsd) {
      bestCostUsd = c
      bestTier = t
    }
  }
  const paygIsBest = bestTier === null

  // Y-axis: max cost in display currency at xMax across all visible lines
  const rawYMaxUsd = Math.max(
    xMax * paygRateUsd,
    ...visibleTiers.map(t => costAtVolume(t, xMax)),
  ) * 1.15
  const rawYMaxDisplay = toDisplay(rawYMaxUsd, showGbp, fxRate)
  const yTicks = computeSmartYTicks(rawYMaxDisplay)
  const yMax = yTicks[yTicks.length - 1]

  function yForCostUsd(usd: number): number {
    return scaleY(toDisplay(usd, showGbp, fxRate), yMax)
  }

  const isEmpty = billableGbPerDay === 0

  // X axis ticks
  const xTickStep = xMax > 400 ? 200 : xMax > 150 ? 50 : 25
  const xTicks: number[] = []
  for (let v = 0; v <= xMax; v += xTickStep) xTicks.push(v)

  // Tooltip content
  const tooltipContent = hoverGb !== null ? (() => {
    const gb = hoverGb
    const paygUsd = gb * paygRateUsd
    const tierCosts = visibleTiers.map(t => ({ tier: t, usd: costAtVolume(t, gb) }))
    return { gb, paygUsd, tierCosts }
  })() : null

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowGbp(true)}
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
              showGbp
                ? 'bg-primary text-white border-primary'
                : 'border-white/15 text-light/50 hover:bg-white/5'
            }`}
          >
            GBP
          </button>
          <button
            type="button"
            onClick={() => setShowGbp(false)}
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
              !showGbp
                ? 'bg-primary text-white border-primary'
                : 'border-white/15 text-light/50 hover:bg-white/5'
            }`}
          >
            USD
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowFullRange(v => !v)}
          className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
            showFullRange
              ? 'bg-accent/20 text-accent border-accent/40'
              : 'border-white/15 text-light/50 hover:bg-white/5'
          }`}
        >
          {showFullRange ? 'Showing full range (0–5000 GB/day)' : 'Show full range'}
        </button>
      </div>

      {/* Chart SVG */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        role="img"
        aria-labelledby="breakeven-chart-title"
        aria-describedby="breakeven-chart-desc"
        onMouseMove={handleSvgMouseMove}
        onMouseLeave={handleSvgMouseLeave}
        style={{ cursor: 'crosshair' }}
      >
        <title id="breakeven-chart-title">
          {isEmpty
            ? 'Cost vs. Ingestion Volume'
            : `Cost vs. Ingestion Volume — your volume ${billableGbPerDay.toFixed(1)} GB/day`}
        </title>
        <desc id="breakeven-chart-desc">
          {isEmpty
            ? 'Line chart showing daily cost for pay-as-you-go and commitment tiers across ingestion volumes. Select log sources to see your estimated volume.'
            : `Line chart comparing daily cost across 0 to ${xMax.toFixed(0)} GB/day. Your estimated volume of ${billableGbPerDay.toFixed(1)} GB/day is shown as a vertical dashed line.`}
        </desc>

        {/* Grid lines */}
        {yTicks.map(v => {
          const y = scaleY(v, yMax)
          return (
            <line
              key={`yg-${v}`}
              x1={MARGIN.left}
              y1={y}
              x2={MARGIN.left + PLOT_W}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          )
        })}

        {/* Axis lines */}
        <line
          x1={MARGIN.left} y1={MARGIN.top}
          x2={MARGIN.left} y2={MARGIN.top + PLOT_H}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1}
        />
        <line
          x1={MARGIN.left} y1={MARGIN.top + PLOT_H}
          x2={MARGIN.left + PLOT_W} y2={MARGIN.top + PLOT_H}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1}
        />

        {/* X axis */}
        {xTicks.map(v => {
          const x = scaleX(v, xMax)
          const y = MARGIN.top + PLOT_H
          return (
            <g key={`xt-${v}`}>
              <line x1={x} y1={y} x2={x} y2={y + 4} stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
              <text x={x} y={y + 14} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.35)">
                {v}
              </text>
            </g>
          )
        })}
        <text
          x={MARGIN.left + PLOT_W / 2}
          y={SVG_H - 4}
          textAnchor="middle"
          fontSize={10}
          fill="rgba(255,255,255,0.35)"
        >
          GB/day
        </text>

        {/* Y axis */}
        {yTicks.map(v => {
          const y = scaleY(v, yMax)
          return (
            <g key={`yt-${v}`}>
              <line x1={MARGIN.left - 4} y1={y} x2={MARGIN.left} y2={y} stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y + 3.5} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.35)">
                {fmtCurrency(v, showGbp)}
              </text>
            </g>
          )
        })}

        {/* PAYG line */}
        <line
          x1={scaleX(0, xMax)}
          y1={yForCostUsd(0)}
          x2={scaleX(xMax, xMax)}
          y2={yForCostUsd(xMax * paygRateUsd)}
          stroke={COLOR_PAYG}
          strokeWidth={2}
        />

        {/* Commitment tier lines */}
        {visibleTiers.map(tier => {
          const isBest = !paygIsBest && tier === bestTier
          const color = tierColor(tier, commitmentTiers, isBest)
          const strokeWidth = isBest ? 2.5 : 1.5

          const xBreak = scaleX(Math.min(tier.gbPerDay, xMax), xMax)
          const yFlat = yForCostUsd(tier.dailyCostUsd)
          const yEnd = yForCostUsd(costAtVolume(tier, xMax))
          const breakVisible = tier.gbPerDay <= xMax

          return (
            <g key={tier.gbPerDay}>
              {/* Flat (pre-commitment) segment */}
              <line
                x1={scaleX(0, xMax)}
                y1={yFlat}
                x2={xBreak}
                y2={yFlat}
                stroke={color}
                strokeWidth={strokeWidth}
              />
              {/* Overage slope */}
              {breakVisible && (
                <line
                  x1={xBreak}
                  y1={yFlat}
                  x2={scaleX(xMax, xMax)}
                  y2={yEnd}
                  stroke={color}
                  strokeWidth={strokeWidth}
                />
              )}
            </g>
          )
        })}

        {/* Breakeven dots (where tier line crosses PAYG) */}
        {visibleTiers.map(tier => {
          const bx = breakevenForTier(tier, paygRateUsd)
          if (bx < 0 || bx > xMax) return null
          const isBest = !paygIsBest && tier === bestTier
          const color = tierColor(tier, commitmentTiers, isBest)
          return (
            <circle
              key={`be-${tier.gbPerDay}`}
              cx={scaleX(bx, xMax)}
              cy={yForCostUsd(bx * paygRateUsd)}
              r={3.5}
              fill={color}
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1}
            />
          )
        })}

        {/* Customer volume marker */}
        {!isEmpty && (() => {
          const markerX = scaleX(billableGbPerDay, xMax)
          // Clamp marker within plot area (may be slightly outside if xMax debounced)
          const clampedX = Math.max(MARGIN.left, Math.min(MARGIN.left + PLOT_W, markerX))

          const bestLabel = paygIsBest
            ? 'PAYG is cheapest'
            : `${bestTier!.gbPerDay} GB/day tier is cheapest`

          const labelOnRight = billableGbPerDay < xMax * 0.65

          // Cost dots on the marker line
          const paygDotY = yForCostUsd(paygCostUsd)
          const tierDots = visibleTiers.map(t => ({
            tier: t,
            y: yForCostUsd(costAtVolume(t, billableGbPerDay)),
            isBest: !paygIsBest && t === bestTier,
            color: tierColor(t, commitmentTiers, !paygIsBest && t === bestTier),
          }))

          return (
            <g>
              {/* Dashed vertical line */}
              <line
                x1={clampedX} y1={MARGIN.top}
                x2={clampedX} y2={MARGIN.top + PLOT_H}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />

              {/* PAYG cost dot */}
              <circle
                cx={clampedX} cy={paygDotY} r={4}
                fill={paygIsBest ? COLOR_BEST : COLOR_PAYG}
                stroke="rgba(0,0,0,0.4)" strokeWidth={1}
              />

              {/* Tier cost dots */}
              {tierDots.map(({ tier, y, color }) => (
                <circle
                  key={`md-${tier.gbPerDay}`}
                  cx={clampedX} cy={y} r={4}
                  fill={color}
                  stroke="rgba(0,0,0,0.4)" strokeWidth={1}
                />
              ))}

              {/* Label */}
              <text
                x={clampedX + (labelOnRight ? 6 : -6)}
                y={MARGIN.top + 10}
                textAnchor={labelOnRight ? 'start' : 'end'}
                fontSize={9}
                fill="rgba(255,255,255,0.55)"
                fontWeight="600"
              >
                {billableGbPerDay.toFixed(1)} GB/day
              </text>
              <text
                x={clampedX + (labelOnRight ? 6 : -6)}
                y={MARGIN.top + 20}
                textAnchor={labelOnRight ? 'start' : 'end'}
                fontSize={8.5}
                fill={COLOR_BEST}
              >
                {bestLabel}
              </text>
            </g>
          )
        })()}

        {/* Data Lake annotation */}
        {dataLakeGbPerDay > 0 && (
          <text
            x={MARGIN.left + PLOT_W}
            y={MARGIN.top + 12}
            textAnchor="end"
            fontSize={9}
            fill="rgba(255,255,255,0.35)"
          >
            +{dataLakeGbPerDay.toFixed(1)} GB/day Data Lake (excluded)
          </text>
        )}

        {/* Hover tooltip */}
        {tooltipContent && (() => {
          const { gb, paygUsd, tierCosts } = tooltipContent
          const tooltipX = scaleX(gb, xMax)
          const onRight = gb < xMax * 0.65

          const lines = [
            { label: 'PAYG', value: toDisplay(paygUsd, showGbp, fxRate), color: COLOR_PAYG },
            ...tierCosts.map(({ tier, usd }) => ({
              label: `${tier.gbPerDay} GB/day`,
              value: toDisplay(usd, showGbp, fxRate),
              color: tierColor(tier, commitmentTiers, !paygIsBest && tier === bestTier),
            })),
          ]

          const lineH = 14
          const padding = 8
          const tooltipW = 130
          const tooltipH = (lines.length + 1) * lineH + padding * 2
          const tx = onRight ? tooltipX + 10 : tooltipX - tooltipW - 10
          const ty = MARGIN.top + 4

          return (
            <g pointerEvents="none">
              {/* Crosshair */}
              <line
                x1={tooltipX} y1={MARGIN.top}
                x2={tooltipX} y2={MARGIN.top + PLOT_H}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              {/* Box */}
              <rect
                x={tx} y={ty}
                width={tooltipW} height={tooltipH}
                rx={4}
                fill="rgba(20,22,36,0.92)"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1}
              />
              {/* GB label */}
              <text x={tx + padding} y={ty + padding + 10} fontSize={9} fill="rgba(255,255,255,0.55)" fontWeight="600">
                {gb.toFixed(1)} GB/day
              </text>
              {/* Cost lines */}
              {lines.map(({ label, value, color }, i) => (
                <g key={label}>
                  <rect
                    x={tx + padding} y={ty + padding + lineH * (i + 1) + 3}
                    width={8} height={3} rx={1} fill={color}
                  />
                  <text
                    x={tx + padding + 12}
                    y={ty + padding + lineH * (i + 1) + 10}
                    fontSize={9}
                    fill="rgba(255,255,255,0.70)"
                  >
                    {label}: {fmtCurrency(value, showGbp)}
                  </text>
                </g>
              ))}
            </g>
          )
        })()}

        {/* Empty state */}
        {isEmpty && (
          <text
            x={MARGIN.left + PLOT_W / 2}
            y={MARGIN.top + PLOT_H / 2}
            textAnchor="middle"
            fontSize={12}
            fill="rgba(255,255,255,0.25)"
          >
            Select log sources to see your estimated volume
          </text>
        )}
      </svg>

      {/* Tier legend / toggle checkboxes */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {/* PAYG legend entry (no toggle — always shown) */}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: COLOR_PAYG }} />
          <span className="text-light/50">Pay-as-you-go</span>
        </div>

        {/* Tier toggles */}
        {commitmentTiers.map(tier => {
          const isBest = !paygIsBest && tier === bestTier
          const color = tierColor(tier, commitmentTiers, isBest)
          const enabled = enabledTiers.has(tier.gbPerDay)
          return (
            <button
              key={tier.gbPerDay}
              type="button"
              onClick={() => toggleTier(tier.gbPerDay)}
              className="flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <span
                className="inline-block w-4 h-0.5 rounded transition-opacity"
                style={{ backgroundColor: color, opacity: enabled ? 1 : 0.25 }}
              />
              <span className={`transition-opacity ${enabled ? 'text-light/60' : 'text-light/25'}`}>
                {tier.gbPerDay} GB/day{isBest ? ' ★' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
