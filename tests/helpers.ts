import type { CoursePoint } from "../src/course.ts"
import type { LatLng } from "../src/geo.ts"

// Metres per degree of latitude on the sphere `geo.ts` measures with.
const M_PER_DEG = (6371008.8 * Math.PI) / 180

export const ORIGIN: LatLng = { lat: 45, lng: 7 }

/** The point `east` and `north` metres from `from`. */
export function offset(from: LatLng, east: number, north: number): LatLng {
  return {
    lat: from.lat + north / M_PER_DEG,
    lng: from.lng + east / (M_PER_DEG * Math.cos((from.lat * Math.PI) / 180)),
  }
}

/** Points every `step` metres along a polyline given as [east, north] metre offsets from ORIGIN. */
export function path(
  corners: [number, number][],
  step = 10,
  ele?: (i: number) => number,
): CoursePoint[] {
  const out: CoursePoint[] = []
  for (let c = 0; c < corners.length - 1; c++) {
    const [x0, y0] = corners[c]!
    const [x1, y1] = corners[c + 1]!
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = c === 0 ? 0 : 1; k <= n; k++) {
      const p = offset(ORIGIN, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n)
      out.push({ ...p, ele: ele ? ele(out.length) : null })
    }
  }
  return out
}
