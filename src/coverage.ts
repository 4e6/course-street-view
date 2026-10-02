import type { Course } from "./course.ts"
import { findPanorama } from "./rider.ts"

export type Gap = [from: number, to: number]

const SPACING = 50
const RADIUS = 40
const WORKERS = 3

/**
 * Stretches without coverage, from per-sample results taken every `spacing`
 * metres. A missing sample stands for the half-spacing either side of it;
 * samples not yet known (`undefined`) count as covered.
 */
export function gapsFrom(
  covered: readonly (boolean | undefined)[],
  spacing: number,
  length: number,
): Gap[] {
  const gaps: Gap[] = []
  let start: number | null = null
  for (let i = 0; i <= covered.length; i++) {
    const missing = i < covered.length && covered[i] === false
    if (missing && start === null) start = i
    if (!missing && start !== null) {
      gaps.push([Math.max(0, (start - 0.5) * spacing), Math.min(length, (i - 0.5) * spacing)])
      start = null
    }
  }
  return gaps
}

/**
 * Checks Street View coverage along the whole course in the background and
 * reports gaps as they are found. Lookups by location are free; a failure
 * that is not "no imagery" (usually a rate limit) is retried once and then
 * ends the scan, leaving the rest unknown rather than painting it as a gap.
 * Returns a function that cancels the scan.
 */
export function scanCoverage(
  course: Course,
  service: google.maps.StreetViewService,
  onGaps: (gaps: Gap[]) => void,
): () => void {
  const count = Math.floor(course.length / SPACING) + 1
  const covered: (boolean | undefined)[] = new Array(count)
  let next = 0
  let done = 0
  let stopped = false

  const check = async (i: number) => {
    const at = course.pointAt(i * SPACING)
    for (let attempt = 0; ; attempt++) {
      try {
        return (await findPanorama(service, at, RADIUS)) !== null
      } catch {
        if (attempt === 1) return undefined
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  const worker = async () => {
    while (!stopped && next < count) {
      const i = next++
      const result = await check(i)
      if (stopped) return
      if (result === undefined) {
        stopped = true
        onGaps(gapsFrom(covered, SPACING, course.length))
        return
      }
      covered[i] = result
      if (++done % 20 === 0 || done === count) onGaps(gapsFrom(covered, SPACING, course.length))
    }
  }

  for (let w = 0; w < WORKERS; w++) void worker()
  return () => {
    stopped = true
  }
}
