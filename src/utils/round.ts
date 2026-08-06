/**
 * Round to two decimal places.
 *
 * Every cost and GB/day figure in the calculator passes through this, so the
 * tests import it rather than re-implementing it — a second copy would let a
 * change in rounding behaviour pass unnoticed.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
