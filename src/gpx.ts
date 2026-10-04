import type { CoursePoint } from "./course.ts"

export interface ParsedGpx {
  name: string | null
  points: CoursePoint[]
}

// GPX is regular enough to read with patterns, which keeps the parser free of
// DOMParser and therefore testable outside a browser. Optional namespace
// prefixes (`<gpx:trkpt>`) are accepted because some exporters write them.
const POINT = /<(?:\w+:)?(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1\s*>)/g
const LAT = /\blat\s*=\s*["']([^"']+)["']/
const LON = /\blon\s*=\s*["']([^"']+)["']/
const ELE = /<(?:\w+:)?ele\s*>([^<]*)</
const NAME = /<(?:\w+:)?name\s*>([\s\S]*?)<\/(?:\w+:)?name\s*>/

/**
 * Reads the track points of a GPX file, or its route points when it has no
 * track. Multiple tracks and segments are joined in file order.
 */
export function parseGpx(text: string): ParsedGpx {
  const track: CoursePoint[] = []
  const route: CoursePoint[] = []
  for (const m of text.matchAll(POINT)) {
    const lat = Number(LAT.exec(m[2] ?? "")?.[1])
    const lng = Number(LON.exec(m[2] ?? "")?.[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const eleText = m[3] ? ELE.exec(m[3])?.[1]?.trim() : undefined
    const ele = eleText ? Number(eleText) : Number.NaN
    const point = { lat, lng, ele: Number.isFinite(ele) ? ele : null }
    ;(m[1] === "trkpt" ? track : route).push(point)
  }
  const points = track.length > 0 ? track : route
  if (points.length === 0) throw new Error("No track or route points found in this GPX file.")

  const rawName = NAME.exec(text)?.[1]
  return { name: rawName ? decodeText(rawName) || null : null, points }
}

function decodeText(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim()
}
