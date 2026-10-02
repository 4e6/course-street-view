import { expect, test } from "bun:test"
import { parseGpx } from "../src/gpx.ts"

const track = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name><![CDATA[Col & Back]]></name></metadata>
  <trk><name>ignored</name>
    <trkseg>
      <trkpt lat="45.1" lon="7.1"><ele>310.5</ele><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lon='7.2' lat='45.2'><ele> 320 </ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="45.3" lon="7.3"/>
    </trkseg>
  </trk>
</gpx>`

test("reads track points across segments, with optional elevation", () => {
  const gpx = parseGpx(track)
  expect(gpx.name).toBe("Col & Back")
  expect(gpx.points).toEqual([
    { lat: 45.1, lng: 7.1, ele: 310.5 },
    { lat: 45.2, lng: 7.2, ele: 320 },
    { lat: 45.3, lng: 7.3, ele: null },
  ])
})

test("falls back to route points, and accepts namespace prefixes", () => {
  const route = `<gpx:gpx><gpx:rte><gpx:name>Loop &amp; more</gpx:name>
    <gpx:rtept lat="1" lon="2"><gpx:ele>5</gpx:ele></gpx:rtept>
    <gpx:rtept lat="3" lon="4"></gpx:rtept></gpx:rte></gpx:gpx>`
  const gpx = parseGpx(route)
  expect(gpx.name).toBe("Loop & more")
  expect(gpx.points).toEqual([
    { lat: 1, lng: 2, ele: 5 },
    { lat: 3, lng: 4, ele: null },
  ])
})

test("prefers the track when a file has both", () => {
  const both = `<gpx><rte><rtept lat="9" lon="9"/></rte><trk><trkseg>
    <trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>`
  expect(parseGpx(both).points.map((p) => p.lat)).toEqual([1, 2])
})

test("rejects a file without points", () => {
  expect(() => parseGpx("<gpx><wpt lat='1' lon='2'/></gpx>")).toThrow(/No track or route points/)
})
