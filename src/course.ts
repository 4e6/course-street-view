import { angleDiff, bearing, distance, type LatLng, lerp, projectOntoSegment } from "./geo.ts"

export interface CoursePoint extends LatLng {
  ele: number | null
}

export interface LocateOptions {
  /** Current position along the course; the search prefers matches near it. */
  near?: number
  /** Bearing of the movement that produced `p`; segments facing the other way are penalised. */
  travel?: number
}

export interface Located {
  /** Metres along the course. */
  s: number
  /** Metres from the query point to the course. */
  dist: number
}

// How far around `near` the windowed search looks. Wide enough to follow a
// Street View step, narrow enough that the other leg of an out-and-back or
// the next lap of a circuit is out of reach.
const WINDOW_BACK = 300
const WINDOW_AHEAD = 600
// A windowed match further than this from the query falls back to a whole-course search.
const WINDOW_MAX_DIST = 50
// Score penalty, in metres, for a segment facing against the direction of travel.
const AGAINST_TRAVEL_PENALTY = 20
// Score penalty per metre of distance from `near`, to break ties between passes.
const AWAY_FROM_NEAR_PENALTY = 0.01

export class Course {
  readonly points: readonly CoursePoint[]
  /** Cumulative distance at each point; `cum[0] === 0`. */
  readonly cum: readonly number[]
  readonly length: number
  readonly hasElevation: boolean
  private readonly segBearing: readonly number[]

  constructor(points: readonly CoursePoint[]) {
    // GPS recorders emit runs of identical fixes while stopped; they add
    // zero-length segments and nothing else.
    const kept: CoursePoint[] = []
    for (const p of points) {
      const last = kept[kept.length - 1]
      if (!last || distance(last, p) >= 0.5) kept.push(p)
    }
    if (kept.length < 2) throw new Error("The course needs at least two distinct points.")

    const cum = [0]
    const segBearing: number[] = []
    for (let i = 1; i < kept.length; i++) {
      cum.push(cum[i - 1]! + distance(kept[i - 1]!, kept[i]!))
      segBearing.push(bearing(kept[i - 1]!, kept[i]!))
    }
    this.points = kept
    this.cum = cum
    this.segBearing = segBearing
    this.length = cum[cum.length - 1]!
    this.hasElevation = kept.filter((p) => p.ele !== null).length >= kept.length / 2
  }

  clamp(s: number): number {
    return Math.max(0, Math.min(this.length, s))
  }

  /** Index `i` of the segment `points[i]`–`points[i+1]` containing distance `s`. */
  segmentAt(s: number): number {
    let lo = 0
    let hi = this.cum.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.cum[mid]! <= s) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  pointAt(s: number): LatLng {
    s = this.clamp(s)
    const i = this.segmentAt(s)
    const a = this.points[i]!
    const b = this.points[i + 1]!
    const len = this.cum[i + 1]! - this.cum[i]!
    return lerp(a, b, len === 0 ? 0 : (s - this.cum[i]!) / len)
  }

  /** The stretch of course from `from` to `to` metres, as a polyline. */
  between(from: number, to: number): LatLng[] {
    from = this.clamp(from)
    to = this.clamp(to)
    const out = [this.pointAt(from)]
    for (let i = this.segmentAt(from) + 1; i < this.points.length && this.cum[i]! < to; i++) {
      out.push(this.points[i]!)
    }
    out.push(this.pointAt(to))
    return out
  }

  /** Elevation at `s`, interpolated; `null` when the course has no elevation data. */
  elevationAt(s: number): number | null {
    if (!this.hasElevation) return null
    s = this.clamp(s)
    const i = this.segmentAt(s)
    const a = this.points[i]!.ele
    const b = this.points[i + 1]!.ele
    if (a === null || b === null) return a ?? b
    const len = this.cum[i + 1]! - this.cum[i]!
    return len === 0 ? a : a + (b - a) * ((s - this.cum[i]!) / len)
  }

  /**
   * Direction to look when standing at `s`: towards the point `lookahead`
   * metres further on, which irons out GPS wiggle that a single segment's
   * bearing would swing with.
   */
  headingAt(s: number, lookahead = 30): number {
    s = this.clamp(s)
    if (s + lookahead <= this.length) return bearing(this.pointAt(s), this.pointAt(s + lookahead))
    return bearing(this.pointAt(Math.max(0, s - lookahead)), this.pointAt(s))
  }

  /** Average gradient in percent over `window` metres centred on `s`. */
  gradeAt(s: number, window = 100): number | null {
    if (!this.hasElevation || this.length < window) return null
    // Slide the window inwards at either end rather than shrinking it.
    const from = Math.max(0, Math.min(this.length - window, s - window / 2))
    const a = this.elevationAt(from)
    const b = this.elevationAt(from + window)
    if (a === null || b === null) return null
    return ((b - a) / window) * 100
  }

  /**
   * Finds the position along the course closest to `p`.
   *
   * With `near`, the search first looks only around that position, so a
   * course that uses the same road twice (out-and-back, laps) resolves to the
   * pass the rider is on rather than whichever happens to be marginally
   * closer. It widens to the whole course only when nothing nearby fits.
   */
  locate(p: LatLng, opts: LocateOptions = {}): Located {
    const { near, travel } = opts
    if (near !== undefined) {
      const windowed = this.search(p, near - WINDOW_BACK, near + WINDOW_AHEAD, near, travel)
      if (windowed.dist <= WINDOW_MAX_DIST) return windowed
      const global = this.search(p, 0, this.length, undefined, travel)
      return global.dist < windowed.dist ? global : windowed
    }
    return this.search(p, 0, this.length, undefined, travel)
  }

  private search(
    p: LatLng,
    from: number,
    to: number,
    near: number | undefined,
    travel: number | undefined,
  ): Located {
    const first = this.segmentAt(this.clamp(from))
    const last = this.segmentAt(this.clamp(to))
    let best: Located = { s: 0, dist: Number.POSITIVE_INFINITY }
    let bestScore = Number.POSITIVE_INFINITY
    for (let i = first; i <= last; i++) {
      const a = this.points[i]!
      const b = this.points[i + 1]!
      const { t, dist } = projectOntoSegment(p, a, b)
      const s = this.cum[i]! + t * (this.cum[i + 1]! - this.cum[i]!)
      let score = dist
      if (travel !== undefined && angleDiff(this.segBearing[i]!, travel) > 90) {
        score += AGAINST_TRAVEL_PENALTY
      }
      if (near !== undefined) score += Math.abs(s - near) * AWAY_FROM_NEAR_PENALTY
      if (score < bestScore) {
        bestScore = score
        best = { s, dist }
      }
    }
    return best
  }
}
