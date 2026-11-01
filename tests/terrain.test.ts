import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { nth } from "../src/assert.ts"
import { Course, type CoursePoint } from "../src/course.ts"
import { distance } from "../src/geo.ts"
import {
  decodePng,
  decodeTerrarium,
  decodeTerrariumTile,
  densify,
  fetchSrtmTile,
  fetchTerrariumTile,
  type GetTile,
  SMOOTHING,
  sampleElevation,
  smoothElevations,
  type Tile,
  tileOf,
  withTerrainElevation,
  worldPixel,
} from "../src/terrain.ts"
import crops from "./fixtures/route-crops.json"
import { ORIGIN, offset, path } from "./helpers.ts"

const FIXTURE = new URL("./fixtures/terrarium-13-3888-3123.png", import.meta.url)

/** The inverse of `worldPixel`. */
function fromPixel(x: number, y: number, z: number) {
  const size = 256 * 2 ** z
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI,
    lng: (x / size) * 360 - 180,
  }
}

describe("terrarium decoding", () => {
  test("packs metres into RGB", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0)
    expect(decodeTerrarium(128, 10, 128)).toBe(10.5)
    expect(decodeTerrarium(127, 255, 255)).toBeCloseTo(-1 / 256, 6)
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768)
  })
})

describe("tile math", () => {
  test("finds the tile of a known point at two zooms", () => {
    expect(tileOf(39.2655, -9.1165, 13)).toEqual({ x: 3888, y: 3123 })
    expect(tileOf(39.2655, -9.1165, 14)).toEqual({ x: 7777, y: 6246 })
  })

  test("origin and antimeridian", () => {
    expect(tileOf(0, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(tileOf(0, -180, 3).x).toBe(0)
    const { x, y } = worldPixel(0, 0, 2)
    expect(x).toBeCloseTo(512, 6)
    expect(y).toBeCloseTo(512, 6)
  })
})

describe("the real tile", () => {
  const load = async () =>
    decodeTerrariumTile(new Uint8Array(await Bun.file(FIXTURE).arrayBuffer()))
  // Reference values from an independent decoder, which matched OpenTopoData's EU-DEM to the metre.
  const references: [lat: number, lng: number, ele: number][] = [
    [39.26589, -9.11595, 62.91],
    [39.26569, -9.11704, 73.17],
    [39.26462, -9.11331, 60.41],
    [39.26531, -9.11543, 62.29],
  ]

  test("decodes to plausible elevations", async () => {
    const { elevations } = await load()
    expect(elevations.length).toBe(256 * 256)
    expect(Math.min(...elevations)).toBeGreaterThan(-50)
    expect(Math.max(...elevations)).toBeLessThan(2000)
  })

  test.each(references)("samples %f, %f as %f m", async (lat, lng, ele) => {
    const tile = await load()
    const tileAt = (x: number, y: number) => {
      if (x !== 3888 || y !== 3123) throw new Error(`unexpected tile ${x}/${y}`)
      return tile
    }
    expect(Math.abs(sampleElevation(lat, lng, 13, tileAt) - ele)).toBeLessThan(0.05)
  })
})

describe("png decoding", () => {
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    new DataView(out.buffer).setUint32(0, body.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(body, 8)
    return out // the CRC is left zero: the decoder does not check it
  }
  const header = (w: number, h: number, depth: number, colorType: number, interlace = 0) => {
    const body = new Uint8Array(13)
    new DataView(body.buffer).setUint32(0, w)
    new DataView(body.buffer).setUint32(4, h)
    body.set([depth, colorType, 0, 0, interlace], 8)
    return chunk("IHDR", body)
  }
  const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
  const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const IEND = chunk("IEND", new Uint8Array(0))

  /** Encodes `pixels` with row y using filter type `y % 5`, split over two IDAT chunks. */
  function encode(w: number, h: number, channels: 3 | 4, pixels: Uint8Array) {
    const stride = w * channels
    const raw = new Uint8Array((stride + 1) * h)
    const at = (y: number, i: number) => (y < 0 || i < 0 ? 0 : (pixels[y * stride + i] ?? 0))
    for (let y = 0; y < h; y++) {
      const type = y % 5
      raw[y * (stride + 1)] = type
      for (let i = 0; i < stride; i++) {
        const a = at(y, i - channels)
        const b = at(y - 1, i)
        const c = at(y - 1, i - channels)
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        const predictor = [0, a, b, (a + b) >> 1, paeth][type] ?? 0
        raw[y * (stride + 1) + 1 + i] = (at(y, i) - predictor) & 0xff
      }
    }
    const z = new Uint8Array(deflateSync(raw))
    const mid = z.length >> 1
    return join(
      SIGNATURE,
      header(w, h, 8, channels === 3 ? 2 : 6),
      chunk("IDAT", z.subarray(0, mid)),
      chunk("IDAT", z.subarray(mid)),
      IEND,
    )
  }

  for (const channels of [3, 4] as const) {
    test(`round-trips all five filters, ${channels} channels`, async () => {
      const w = 7
      const h = 10
      const pixels = new Uint8Array(w * h * channels).map((_, i) => (i * 37 + (i >> 3) * 11) & 0xff)
      const image = await decodePng(encode(w, h, channels, pixels))
      expect([image.width, image.height, image.channels]).toEqual([w, h, channels])
      expect(Array.from(image.data)).toEqual(Array.from(pixels))
    })
  }

  test("rejects what it does not support", async () => {
    const data = chunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(2))))
    await expect(decodePng(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9))).rejects.toThrow()
    for (const [depth, colorType, interlace] of [
      [16, 2, 0], // 16-bit
      [8, 0, 0], // greyscale
      [8, 3, 0], // palette
      [8, 2, 1], // interlaced
    ] as const) {
      await expect(
        decodePng(join(SIGNATURE, header(1, 1, depth, colorType, interlace), data, IEND)),
      ).rejects.toThrow()
    }
  })
})

describe("bilinear sampling", () => {
  // A tilted plane in world pixels, measured from a corner where four tiles
  // meet, so that it is continuous across tile edges.
  const Z = 13
  const TX = 3888
  const TY = 3123
  const A = 0.5
  const B = 0.25
  const tileAt = (x: number, y: number): Tile => {
    const elevations = new Float32Array(256 * 256)
    for (let v = 0; v < 256; v++) {
      for (let u = 0; u < 256; u++) {
        elevations[v * 256 + u] = A * ((x - TX) * 256 + u) + B * ((y - TY) * 256 + v)
      }
    }
    return { elevations }
  }

  test("reproduces a plane at pixel centres and between them, across tile edges", () => {
    const requested = new Set<string>()
    const recording = (x: number, y: number) => {
      requested.add(`${x}/${y}`)
      return tileAt(x, y)
    }
    const edgeX = (TX + 1) * 256
    const edgeY = (TY + 1) * 256
    for (const [dx, dy] of [
      [-0.3, -0.3], // all four neighbours in different tiles
      [0.4, 0.4],
      [-0.5, 0.2], // exactly on a pixel centre column
      [0.5, -0.5],
      [-40.7, 33.2], // well inside a tile
    ] as const) {
      const { lat, lng } = fromPixel(edgeX + dx, edgeY + dy, Z)
      const expected = A * (edgeX + dx - 0.5 - TX * 256) + B * (edgeY + dy - 0.5 - TY * 256)
      expect(sampleElevation(lat, lng, Z, recording)).toBeCloseTo(expected, 3)
    }
    expect(requested).toEqual(new Set(["3888/3123", "3889/3123", "3888/3124", "3889/3124"]))
  })
})

describe("densify", () => {
  // A 6 km sine-wave road with a corner every ~150 m.
  const corners: [number, number][] = []
  for (let x = 0; x <= 6000; x += 150) corners.push([x, 800 * Math.sin(x / 700)])
  const original = path(corners, 150)

  test("keeps the shape and every original point, with no gap over 10 m", () => {
    const dense = densify(original)
    const before = new Course(original)
    const after = new Course(dense)
    expect(before.length).toBeGreaterThan(5000)
    expect(Math.abs(after.length - before.length) / before.length).toBeLessThan(0.001)
    for (let i = 1; i < dense.length; i++) {
      const gap = distance(dense[i - 1] as CoursePoint, dense[i] as CoursePoint)
      expect(gap).toBeLessThanOrEqual(10.001)
    }
    let from = 0
    for (const p of original) {
      const found = dense.indexOf(p, from)
      expect(found).toBeGreaterThanOrEqual(from)
      from = found
    }
    // Inserted points lie on the original polyline.
    for (const p of dense.filter((q) => !original.includes(q))) {
      expect(before.locate(p).dist).toBeLessThan(0.05)
    }
  })

  test("leaves a dense path as it is", () => {
    const pts = path(
      [
        [0, 0],
        [100, 0],
      ],
      5,
    )
    expect(densify(pts)).toEqual(pts)
  })
})

describe("withTerrainElevation", () => {
  // Constant tiles whose elevation is the tile's column, so the result shows which tile was read.
  const flat = (x: number): Tile => ({ elevations: new Float32Array(256 * 256).fill(x % 1000) })

  // About 40 km east: a dozen z13 tiles, more than the concurrency limit.
  const line = path(
    [
      [0, 0],
      [40000, 0],
    ],
    500,
    () => 9999,
  )

  test("fetches each tile once, at most six at a time", async () => {
    const calls = new Map<string, number>()
    let inFlight = 0
    let peak = 0
    const getTile: GetTile = async (z, x, y) => {
      calls.set(`${z}/${x}/${y}`, (calls.get(`${z}/${x}/${y}`) ?? 0) + 1)
      peak = Math.max(peak, ++inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return flat(x)
    }
    const progress: [number, number][] = []
    const { points: result } = await withTerrainElevation(line, {
      getTile,
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(calls.size).toBeGreaterThan(8)
    expect([...calls.values()].every((n) => n === 1)).toBe(true)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(6)
    expect(progress[0]).toEqual([0, calls.size])
    expect(progress[progress.length - 1]).toEqual([calls.size, calls.size])

    // Densified, every point has an elevation, and the GPX's own is not used.
    expect(result.length).toBeGreaterThan(line.length * 10)
    // Away from tile edges a sample reads one tile only, so its value is that tile's column.
    for (const p of result) {
      const { x } = worldPixel(p.lat, p.lng, 13)
      const inTile = x % 256
      if (inTile > 1 && inTile < 255) expect(p.ele).toBe(Math.floor(x / 256) % 1000)
    }
    expect(new Course(result).hasElevation).toBe(true)
    expect(distance(result[0] as CoursePoint, ORIGIN)).toBeLessThan(0.01)
    const last = result[result.length - 1] as CoursePoint
    expect(distance(last, offset(ORIGIN, 40000, 0))).toBeLessThan(0.5)
  })

  test("a failed tile fails the load, cancels the rest and reports no progress after", async () => {
    let failed = false
    let aborted = 0
    let started = 0
    const getTile: GetTile = (_z, x, _y, signal) => {
      started++
      // The first tile fails fast; the others are slow, and ignore the abort
      // on purpose so that a progress report after the failure would show.
      if (started === 1) {
        return new Promise((_resolve, reject) =>
          setTimeout(() => {
            failed = true
            reject(new Error("offline"))
          }, 5),
        )
      }
      signal?.addEventListener("abort", () => aborted++)
      return new Promise((resolve) => setTimeout(() => resolve(flat(x)), 30))
    }
    const late: number[] = []
    const result = withTerrainElevation(line, {
      getTile,
      onProgress: (done) => {
        if (failed) late.push(done)
      },
    })
    await expect(result).rejects.toThrow("offline")
    const startedAtFailure = started
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(late).toEqual([])
    expect(aborted).toBe(startedAtFailure - 1)
    expect(started).toBe(startedAtFailure)
  })

  test("aborting stops the load", async () => {
    const controller = new AbortController()
    let started = 0
    const getTile: GetTile = (_z, x, _y, signal) => {
      started++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(flat(x)), 20)
        signal?.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(signal.reason)
        })
      })
    }
    const result = withTerrainElevation(line, { getTile, signal: controller.signal })
    setTimeout(() => controller.abort(), 30)
    await expect(result).rejects.toThrow()
    const startedAtAbort = started
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(started).toBe(startedAtAbort)
    expect(startedAtAbort).toBeLessThan(13)
  })

  test("a failed v2 tile stops the v2 attempt early, before the fallback", async () => {
    let v2Started = 0
    const v1Loads: number[] = []
    const getSrtmTile: GetTile = (_z, x) => {
      v2Started++
      // The first tile fails; the others are slow, so the six workers are all busy when it does.
      if (v2Started === 1) {
        return new Promise((_resolve, reject) => setTimeout(() => reject(new Error("403")), 5))
      }
      return new Promise((resolve) =>
        setTimeout(() => resolve({ ...flat(x), sources: ["srtm/N39W010.tif"] }), 30),
      )
    }
    const getTile: GetTile = async (_z, x) => {
      v1Loads.push(x)
      return flat(x)
    }
    await withTerrainElevation(line, { getTile, getSrtmTile })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(v1Loads.length).toBeGreaterThan(6)
    expect(v2Started).toBeLessThanOrEqual(6)
    expect(v2Started).toBeLessThan(v1Loads.length)
  })
})

describe("smoothElevations", () => {
  /** A west-to-east road with a point every `step` metres and elevation `ele(s)`. */
  const road = (length: number, ele: (s: number) => number, step = 10) =>
    path(
      [
        [0, 0],
        [length, 0],
      ],
      step,
    ).map((p, i, all) => ({ ...p, ele: ele((i * length) / (all.length - 1)) }))
  /** Cosine-shaped dip of `depth` metres and `width` metres, centred at `at`. */
  const dip = (depth: number, width: number, at: number) => (s: number) =>
    Math.abs(s - at) < width / 2
      ? (-depth * (1 + Math.cos((2 * Math.PI * (s - at)) / width))) / 2
      : 0
  const minGrade = (points: CoursePoint[], from: number, to: number) => {
    const course = new Course(points)
    let min = Infinity
    for (let s = from; s <= to; s += 10) min = Math.min(min, course.gradeAt(s) ?? Infinity)
    return min
  }
  const SIGMA = SMOOTHING.srtm

  test("a 6 m dip over 150 m on a 4 % climb no longer reads as a descent", () => {
    const raw = road(3000, (s) => 0.04 * s + dip(6, 150, 1500)(s))
    expect(minGrade(raw, 500, 2500)).toBeLessThan(-1.5)
    expect(minGrade(smoothElevations(raw, SMOOTHING.srtm), 500, 2500)).toBeGreaterThan(0)
    expect(minGrade(smoothElevations(raw, SMOOTHING.eudem), 500, 2500)).toBeGreaterThan(1.5)
  })

  test("an 8 m dip over 300 m on a 1.5 % climb is still a descent", () => {
    const raw = road(3000, (s) => 0.015 * s + dip(8, 300, 1500)(s))
    expect(minGrade(smoothElevations(raw, SIGMA), 500, 2500)).toBeLessThan(-2)
  })

  test("uneven spacing smooths the same as even spacing", () => {
    const ele = (s: number) => 0.03 * s + dip(5, 200, 1000)(s)
    const even = road(2000, ele, 5)
    // Every other point dropped over a stretch, and a long gap: same road, fewer samples.
    const uneven = even.filter((_, i) => i % 40 > 3 || i % 2 === 0)
    const a = new Course(smoothElevations(even, SIGMA))
    const b = new Course(smoothElevations(uneven, SIGMA))
    expect(uneven.length).toBeLessThan(even.length)
    for (let s = 0; s <= 2000; s += 50) {
      expect(Math.abs((a.elevationAt(s) ?? NaN) - (b.elevationAt(s) ?? NaN))).toBeLessThan(0.05)
    }
  })

  test("leaves a straight slope alone, ends included", () => {
    const smoothed = smoothElevations(
      road(1000, (s) => 100 + 0.06 * s),
      60,
    )
    const course = new Course(smoothed)
    expect(course.elevationAt(0)).toBeCloseTo(100, 6)
    expect(course.elevationAt(course.length)).toBeCloseTo(160, 3)
    for (let s = 0; s <= course.length; s += 25) expect(course.gradeAt(s)).toBeCloseTo(6, 1)
  })

  test("keeps every point and its position", () => {
    const raw = road(500, (s) => s / 10)
    const smoothed = smoothElevations(raw, 35)
    expect(smoothed.map(({ lat, lng }) => ({ lat, lng }))).toEqual(
      raw.map(({ lat, lng }) => ({ lat, lng })),
    )
  })
})

describe("terrain model choice on a real road", () => {
  // Two stretches of EN 115 near Vermelha, PT (OpenStreetMap; see fixtures/README.md), with the real
  // tiles of the default build (v1, EU-DEM) and of the `v2` build (SRTM) under them.
  const TILES = ["3888/3125", "3888/3126", "3888/3122", "3889/3122"]
  const bytes = new Map<string, Uint8Array>()
  const SOURCES = { v1: "eudem/eudem_dem_5deg_n35w010.tif", v2: "srtm/N39W010.tif" }
  for (const variant of ["v1", "v2"]) {
    for (const tile of TILES) {
      const file = new URL(
        `./fixtures/terrarium-${variant}-13-${tile.replace("/", "-")}.png`,
        import.meta.url,
      )
      bytes.set(`${variant}/${tile}`, new Uint8Array(readFileSync(file)))
    }
  }

  interface Fake {
    getTile: GetTile
    getSrtmTile: GetTile
    loads: { v1: string[]; v2: string[] }
  }
  /** Getters serving the fixtures; `sources` and `fail` let a test make v2 (or v1) look different. */
  function fake(
    options: { v2Sources?: string[]; v1Sources?: string[]; failV2?: boolean } = {},
  ): Fake {
    const loads = { v1: [] as string[], v2: [] as string[] }
    const serve =
      (variant: "v1" | "v2", sources: string[] | undefined): GetTile =>
      async (z, x, y) => {
        loads[variant].push(`${z}/${x}/${y}`)
        if (variant === "v2" && options.failV2) throw new Error("Terrain tile failed (403).")
        const png = bytes.get(`${variant}/${x}/${y}`)
        if (z !== 13 || !png) throw new Error(`no fixture for ${variant} ${z}/${x}/${y}`)
        const tile = await decodeTerrariumTile(png)
        return sources ? { ...tile, sources } : tile
      }
    return {
      getTile: serve("v1", options.v1Sources ?? [SOURCES.v1]),
      getSrtmTile: serve("v2", options.v2Sources ?? [SOURCES.v2]),
      loads,
    }
  }

  const route = (name: "site" | "vermelha") =>
    crops[name].map((p): CoursePoint => ({ lat: nth(p, 0), lng: nth(p, 1), ele: null }))
  const site = route("site")
  const vermelha = route("vermelha")

  // Stretches in metres along each crop (crop-local, from its start), found once from the fixture.
  const AT_38_25 = [284, 334] as const
  const AT_39_2 = [1215, 1325] as const
  const VERMELHA = [610, 860] as const

  const minOver = (course: Course, [from, to]: readonly [number, number]) => {
    let min = Infinity
    for (let s = from; s <= to; s += 10) min = Math.min(min, course.gradeAt(s) ?? Infinity)
    return min
  }
  /** The most the course falls below its own highest point so far, over the stretch. */
  const dropOver = (course: Course, [from, to]: readonly [number, number]) => {
    let high = -Infinity
    let drop = 0
    for (let s = from; s <= to; s += 10) {
      const e = course.elevationAt(s) ?? NaN
      high = Math.max(high, e)
      drop = Math.max(drop, high - e)
    }
    return drop
  }

  test("uses SRTM, smoothed, where every tile is SRTM", async () => {
    const f = fake()
    const result = await withTerrainElevation(site, f)
    expect(result.source).toBe("srtm")
    expect(f.loads.v1).toEqual([])
    const course = new Course(result.points)
    // The road climbs through both stretches; the EU-DEM said it fell (-2.0 and -6.2 % raw).
    expect(minOver(course, AT_38_25)).toBeGreaterThan(1)
    expect(minOver(course, AT_39_2)).toBeGreaterThan(0)
  })

  test("smoothing is what lifts the 38.25 km stretch above +1 %", async () => {
    // The same SRTM tiles with the source hidden: no smoothing, and the dip is still there.
    const f = fake({ v2Sources: [SOURCES.v2] })
    const raw = await withTerrainElevation(site, {
      getTile: async (...a) => ({ ...(await f.getSrtmTile(...a)), sources: [] }),
    })
    expect(raw.source).toBe("other")
    expect(minOver(new Course(raw.points), AT_38_25)).toBeLessThan(1)
  })

  test("EU-DEM alone, even smoothed, does not clear the 39.2 km stretch", async () => {
    const result = await withTerrainElevation(site, { getTile: fake().getTile })
    expect(result.source).toBe("eudem")
    const course = new Course(result.points)
    expect(minOver(course, AT_38_25)).toBeGreaterThan(1)
    expect(minOver(course, AT_39_2)).toBeLessThan(-1)
  })

  test("unsmoothed EU-DEM is what main did: false descents at both stretches", async () => {
    const f = fake({ v1Sources: [] })
    const result = await withTerrainElevation(site, { getTile: f.getTile })
    const course = new Course(result.points)
    expect(minOver(course, AT_38_25)).toBeLessThan(-1.5)
    expect(minOver(course, AT_39_2)).toBeLessThan(-5)
  })

  test("a real dip survives: Vermelha keeps most of its depth and a steep descent", async () => {
    const course = new Course((await withTerrainElevation(vermelha, fake())).points)
    expect(dropOver(course, VERMELHA)).toBeGreaterThanOrEqual(4.3)
    expect(minOver(course, VERMELHA)).toBeLessThan(-3.5)
  })

  test("the smoothing widths stay in the band the course was tuned on", () => {
    expect(SMOOTHING.srtm).toBeGreaterThanOrEqual(30)
    expect(SMOOTHING.srtm).toBeLessThanOrEqual(37)
    expect(SMOOTHING.eudem).toBeGreaterThanOrEqual(50)
    expect(SMOOTHING.eudem).toBeLessThanOrEqual(70)
  })

  describe("falls back to the default tiles for the whole course", () => {
    const cases: [string, Parameters<typeof fake>[0]][] = [
      ["a tile from gmted", { v2Sources: ["gmted/gmted_mea075.tif"] }],
      ["a tile with no source header", { v2Sources: [] }],
      ["a tile mixing srtm and eudem", { v2Sources: [SOURCES.v2, SOURCES.v1] }],
      ["a tile that fails to load", { failV2: true }],
    ]
    test.each(cases)("%s", async (_name, options) => {
      const f = fake(options)
      const progress: [number, number][] = []
      const result = await withTerrainElevation(site, {
        ...f,
        onProgress: (done, total) => progress.push([done, total]),
      })
      const v1Only = await withTerrainElevation(site, { getTile: fake().getTile })
      expect(result.source).toBe("eudem")
      expect(result.points).toEqual(v1Only.points)
      // Each default tile exactly once.
      expect(f.loads.v1.length).toBe(new Set(f.loads.v1).size)
      expect(new Set(f.loads.v1).size).toBeGreaterThan(0)
      // The abandoned attempt leaves no trace: the count restarts at zero and ends complete.
      const total = progress[0]?.[1] ?? 0
      expect(progress.filter(([done]) => done === 0).length).toBe(2)
      expect(progress[progress.length - 1]).toEqual([total, total])
    })
  })

  test("a cancelled load does not fall back", async () => {
    const f = fake()
    const controller = new AbortController()
    const slow: GetTile = (_z, _x, _y, signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason)),
      )
    let aborted = false
    const reported: [number, number][] = []
    const result = withTerrainElevation(site, {
      getTile: f.getTile,
      getSrtmTile: slow,
      signal: controller.signal,
      onProgress: (done, total) => {
        if (aborted) reported.push([done, total])
      },
    })
    setTimeout(() => {
      aborted = true
      controller.abort()
    }, 10)
    await expect(result).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(f.loads.v1).toEqual([])
    expect(reported).toEqual([])
  })

  test("default tiles from a national model are not smoothed", async () => {
    const f = fake({ v1Sources: ["pgdc_5m/some.tif"], failV2: true })
    const result = await withTerrainElevation(site, f)
    expect(result.source).toBe("other")
    const tiles = new Map<string, Tile>()
    for (const key of TILES) {
      tiles.set(key, await decodeTerrariumTile(bytes.get(`v1/${key}`) as Uint8Array))
    }
    for (const p of result.points) {
      const direct = sampleElevation(p.lat, p.lng, 13, (x, y) => tiles.get(`${x}/${y}`) as Tile)
      expect(p.ele).toBe(direct)
    }
  })
})

describe("fetching tiles", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  const png = new Uint8Array(
    readFileSync(new URL("./fixtures/terrarium-v2-13-3888-3122.png", import.meta.url)),
  )
  const stub = (headers: Record<string, string>) => {
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(url)
      return new Response(png, { headers })
    }) as unknown as typeof fetch
    return urls
  }

  test("reads every model from the imagery-sources header", async () => {
    const urls = stub({ "x-amz-meta-x-imagery-sources": "srtm/N39W010.tif, srtm/N39W009.tif" })
    const tile = await fetchSrtmTile(13, 3888, 3122)
    expect(tile.sources).toEqual(["srtm/N39W010.tif", "srtm/N39W009.tif"])
    expect(urls[0]).toContain("/v2/")
    expect(urls[0]).toEndWith("/13/3888/3122.png")
    stub({ "x-amz-meta-x-imagery-sources": "eudem/a.tif,gmted/b.tif" })
    expect((await fetchTerrariumTile(13, 3888, 3122)).sources).toEqual([
      "eudem/a.tif",
      "gmted/b.tif",
    ])
  })

  test("a response without the header has no sources, so the SRTM gate stays closed", async () => {
    stub({})
    expect((await fetchSrtmTile(13, 3888, 3122)).sources).toEqual([])
  })
})
