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

test("reads a Garmin-style activity with extensions inside each point", () => {
  const garmin = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><time>2026-09-30T07:00:00.000Z</time></metadata>
  <trk>
    <name>Rio Maior Cycling</name>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="39.3361540"
             lon="-8.9367120">
        <ele>58.4</ele>
        <time>2026-09-30T07:00:00.000Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension><gpxtpx:hr>112</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="39.3362010" lon="-8.9366540"><ele>58.8</ele><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>113</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`
  const gpx = parseGpx(garmin)
  expect(gpx.name).toBe("Rio Maior Cycling")
  expect(gpx.points).toEqual([
    { lat: 39.336154, lng: -8.936712, ele: 58.4 },
    { lat: 39.336201, lng: -8.936654, ele: 58.8 },
  ])
})

test("reads a Strava-style route export", () => {
  const strava = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <metadata>
  <name>Saturday loop</name>
  <link href="https://www.strava.com/routes/123"/>
 </metadata>
 <trk>
  <name>Saturday loop</name>
  <trkseg>
   <trkpt lat="38.7223" lon="-9.1393">
    <ele>45</ele>
   </trkpt>
   <trkpt lat="38.7230" lon="-9.1400">
    <ele>47.2</ele>
   </trkpt>
  </trkseg>
 </trk>
</gpx>`
  const gpx = parseGpx(strava)
  expect(gpx.name).toBe("Saturday loop")
  expect(gpx.points.map((p) => p.ele)).toEqual([45, 47.2])
})

test("an elevation-less export yields null elevations, not zeros", () => {
  const flat = `<gpx><trk><trkseg>
    <trkpt lat="1" lon="2"><time>2026-01-01T00:00:00Z</time></trkpt>
    <trkpt lat="1.001" lon="2"><ele></ele></trkpt>
  </trkseg></trk></gpx>`
  expect(parseGpx(flat).points.map((p) => p.ele)).toEqual([null, null])
})
