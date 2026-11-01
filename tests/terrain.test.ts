import { describe, expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { Course, type CoursePoint } from "../src/course.ts"
import { distance } from "../src/geo.ts"
import {
  cachedTiles,
  decodePng,
  decodeTerrarium,
  decodeTerrariumTile,
  densify,
  type GetTile,
  sampleElevation,
  type Tile,
  tileOf,
  withTerrainElevation,
  worldPixel,
} from "../src/terrain.ts"
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
    const result = await withTerrainElevation(line, {
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
    expect(result.every((p) => p.ele !== null)).toBe(true)
    expect(new Course(result).hasElevation).toBe(true)
    expect(distance(result[0] as CoursePoint, ORIGIN)).toBeLessThan(0.01)
    const last = result[result.length - 1] as CoursePoint
    expect(distance(last, offset(ORIGIN, 40000, 0))).toBeLessThan(0.5)
  })

  test("concurrent requests for one tile share a fetch", async () => {
    let fetches = 0
    const getTile: GetTile = async (_z, x) => {
      fetches++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return flat(x)
    }
    const cached = cachedTiles(getTile)
    await Promise.all([cached(13, 1, 1), cached(13, 1, 1), cached(13, 1, 1), cached(13, 2, 1)])
    expect(fetches).toBe(2)
  })

  test("a failed tile is not remembered", async () => {
    let fetches = 0
    const cached = cachedTiles(async (_z, x) => {
      if (++fetches === 1) throw new Error("offline")
      return flat(x)
    })
    await expect(cached(13, 1, 1)).rejects.toThrow("offline")
    await expect(cached(13, 1, 1)).resolves.toBeDefined()
  })

  test("a failed tile fails the whole load", async () => {
    const getTile: GetTile = async (_z, x) => {
      if (x % 2 === 0) throw new Error("offline")
      return flat(x)
    }
    await expect(withTerrainElevation(line, { getTile })).rejects.toThrow("offline")
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
})
