export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS = 6371008.8
const RAD = Math.PI / 180

/** Great-circle distance in metres. */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north, in [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * RAD
  const φ2 = b.lat * RAD
  const Δλ = (b.lng - a.lng) * RAD
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/**
 * Projects `p` onto segment `a`–`b`. Uses a local equirectangular plane around
 * `a`, which is accurate to well under a metre for segments of GPS-track length.
 * `t` is the clamped position along the segment, `dist` the metres from `p` to it.
 */
export function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): { t: number; dist: number } {
  const k = Math.cos(a.lat * RAD)
  const bx = (b.lng - a.lng) * k
  const by = b.lat - a.lat
  const px = (p.lng - a.lng) * k
  const py = p.lat - a.lat
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  const dx = px - bx * t
  const dy = py - by * t
  return { t, dist: Math.sqrt(dx * dx + dy * dy) * RAD * EARTH_RADIUS }
}
