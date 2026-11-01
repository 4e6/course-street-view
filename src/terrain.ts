import { defined, nth } from "./assert.ts"
import type { CoursePoint } from "./course.ts"
import { distance, lerp } from "./geo.ts"

/**
 * Elevation from a terrain model rather than from the GPX file: AWS Terrain
 * Tiles, "terrarium" encoding, which are keyless and allow cross-origin reads.
 * A GPX recorded by a bike computer or planned in a route editor can carry
 * barometer drift or a coarse model; the DEM is a second opinion at a known
 * (if coarse, ~25-30 m) resolution.
 */

export const TERRAIN_ZOOM = 13
const TILE_SIZE = 256
/** Longest gap left between consecutive points once a course is densified. */
export const MAX_SPACING = 10
/** Tiles in flight at once; browsers allow six connections per host anyway. */
const CONCURRENCY = 6

const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"

/** One decoded 256x256 tile: metres above sea level, row-major from the top-left. */
export interface Tile {
  readonly elevations: Float32Array
}

export type GetTile = (z: number, x: number, y: number, signal?: AbortSignal) => Promise<Tile>

/** Terrarium packs metres into RGB: 24 bits, 1/256 m steps, offset by 32768 m. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

// ---------------------------------------------------------------------------
// Web-Mercator tile and pixel arithmetic

/** Position on the world pixel grid at zoom `z`, fractional; the grid is `256 * 2^z` square. */
export function worldPixel(lat: number, lng: number, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

/** The tile containing a point. */
export function tileOf(lat: number, lng: number, z: number): { x: number; y: number } {
  const { x, y } = worldPixel(lat, lng, z)
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) }
}

/**
 * The four pixels a bilinear sample reads. Pixel `i` has its centre at
 * `i + 0.5`, so the sample sits `fx`, `fy` of the way from pixel (`x0`, `y0`)
 * to its right and lower neighbours. Pixels are on the world grid, not
 * tile-local: a sample near a tile edge simply has neighbours in the next tile.
 */
function footprint(lat: number, lng: number, z: number) {
  const { x, y } = worldPixel(lat, lng, z)
  const px = x - 0.5
  const py = y - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  return { x0, y0, fx: px - x0, fy: py - y0 }
}

/** Keeps a world pixel on the grid: longitude wraps around, latitude stops at the poles. */
function wrapPixel(x: number, y: number, z: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** z
  return { x: ((x % size) + size) % size, y: Math.max(0, Math.min(size - 1, y)) }
}

const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`

/** Tiles (as `z/x/y` keys) whose pixels a sample at this point reads: one, two or four. */
function tilesFor(lat: number, lng: number, z: number): Set<string> {
  const { x0, y0 } = footprint(lat, lng, z)
  const keys = new Set<string>()
  for (const dy of [0, 1]) {
    for (const dx of [0, 1]) {
      const p = wrapPixel(x0 + dx, y0 + dy, z)
      keys.add(tileKey(z, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)))
    }
  }
  return keys
}

/**
 * Bilinear elevation at a point. `tileAt` must return every tile
 * `tilesFor` lists; it is synchronous so callers load tiles first.
 */
export function sampleElevation(
  lat: number,
  lng: number,
  z: number,
  tileAt: (x: number, y: number) => Tile,
): number {
  const { x0, y0, fx, fy } = footprint(lat, lng, z)
  const at = (dx: number, dy: number) => {
    const p = wrapPixel(x0 + dx, y0 + dy, z)
    const tx = Math.floor(p.x / TILE_SIZE)
    const ty = Math.floor(p.y / TILE_SIZE)
    const index = (p.y - ty * TILE_SIZE) * TILE_SIZE + (p.x - tx * TILE_SIZE)
    return nth(tileAt(tx, ty).elevations, index)
  }
  const top = at(0, 0) * (1 - fx) + at(1, 0) * fx
  const bottom = at(0, 1) * (1 - fx) + at(1, 1) * fx
  return top * (1 - fy) + bottom * fy
}

// ---------------------------------------------------------------------------
// Densifying

/**
 * `points` with extra points inserted so no two neighbours are further than
 * `maxSpacing` apart. The extras lie on the original segments, so the shape
 * and the distance along the course stay the same, and the original points
 * are all kept. Extras have no elevation of their own.
 *
 * Why: a DEM varies within a few tens of metres, while a GPX can have hundreds
 * of metres between points (a route planner only emits corners), and
 * interpolating straight between those would flatten a climb's real shape.
 */
export function densify(points: readonly CoursePoint[], maxSpacing = MAX_SPACING): CoursePoint[] {
  const out: CoursePoint[] = []
  for (let i = 0; i < points.length; i++) {
    const to = nth(points, i)
    const from = out[out.length - 1]
    if (from) {
      const pieces = Math.ceil(distance(from, to) / maxSpacing)
      for (let k = 1; k < pieces; k++) out.push({ ...lerp(from, to, k / pieces), ele: null })
    }
    out.push(to)
  }
  return out
}

// ---------------------------------------------------------------------------
// Loading

/**
 * Runs `task` over `items`, at most `limit` at a time. The first failure
 * rejects the run; aborting `signal` stops new items from starting.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      signal.throwIfAborted()
      await task(nth(items, next++))
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export interface TerrainOptions {
  getTile: GetTile
  /** Aborts outstanding tile requests; the returned promise then rejects. */
  signal?: AbortSignal
  /** Called as tiles arrive, with how many are done of how many are needed; never after a failure. */
  onProgress?: (done: number, total: number) => void
}

/**
 * `points` densified to at most `MAX_SPACING` between neighbours, each with
 * its elevation taken from the terrain model (the GPX's own is discarded).
 * Each tile is fetched once. One failed tile fails the load and cancels the
 * requests still in flight, so they stop downloading and reporting progress.
 */
export async function withTerrainElevation(
  points: readonly CoursePoint[],
  { getTile, signal, onProgress }: TerrainOptions,
): Promise<CoursePoint[]> {
  const dense = densify(points)
  const needed = new Set<string>()
  for (const p of dense) for (const key of tilesFor(p.lat, p.lng, TERRAIN_ZOOM)) needed.add(key)

  // Aborted by the caller, or by this load's own first failure.
  const stop = new AbortController()
  const forward = () => stop.abort(signal?.reason)
  if (signal?.aborted) forward()
  signal?.addEventListener("abort", forward)

  const tiles = new Map<string, Tile>()
  const keys = [...needed]
  onProgress?.(0, keys.length)
  try {
    await runPool(
      keys,
      CONCURRENCY,
      async (key) => {
        const parts = key.split("/").map(Number)
        let tile: Tile
        try {
          tile = await getTile(nth(parts, 0), nth(parts, 1), nth(parts, 2), stop.signal)
        } catch (e) {
          // Abort here, not after the rejection has worked its way out of the
          // pool, so no other tile can report progress in between.
          stop.abort(e)
          throw e
        }
        stop.signal.throwIfAborted()
        tiles.set(key, tile)
        onProgress?.(tiles.size, keys.length)
      },
      stop.signal,
    )
  } catch (e) {
    stop.abort(e)
    throw e
  } finally {
    signal?.removeEventListener("abort", forward)
  }

  return dense.map((p) => ({
    ...p,
    ele: sampleElevation(p.lat, p.lng, TERRAIN_ZOOM, (x, y) =>
      defined(tiles.get(tileKey(TERRAIN_ZOOM, x, y)), `tile ${x}/${y}`),
    ),
  }))
}

// ---------------------------------------------------------------------------
// PNG decoding
//
// Done by hand rather than through a canvas: browsers that defend against
// fingerprinting add noise to canvas pixel reads, and colour management can
// shift values, either of which would corrupt data packed into the low bits.

interface Image {
  width: number
  height: number
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  channels: number
  data: Uint8Array
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function inflate(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  // PNG's zlib stream is what `DecompressionStream("deflate")` reads.
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Undoes PNG's per-row prediction filters (types 0-4) in place. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  if (raw.length !== (stride + 1) * height) throw new Error("PNG pixel data has the wrong size.")
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const type = nth(raw, y * (stride + 1))
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let i = 0; i < stride; i++) {
      const x = nth(raw, src + i)
      const a = i >= bpp ? nth(out, row + i - bpp) : 0
      const b = y > 0 ? nth(out, row - stride + i) : 0
      const c = y > 0 && i >= bpp ? nth(out, row - stride + i - bpp) : 0
      let predictor: number
      switch (type) {
        case 0:
          predictor = 0
          break
        case 1:
          predictor = a
          break
        case 2:
          predictor = b
          break
        case 3:
          predictor = (a + b) >> 1
          break
        case 4: {
          // Paeth: whichever of left, above, upper-left is closest to a + b - c.
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new Error(`PNG has an unknown filter type ${type}.`)
      }
      out[row + i] = (x + predictor) & 0xff
    }
  }
  return out
}

/** Decodes a non-interlaced 8-bit RGB or RGBA PNG; anything else throws. */
export async function decodePng(bytes: Uint8Array): Promise<Image> {
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("Not a PNG file.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let header: { width: number; height: number; channels: number } | null = null
  const idat: Uint8Array[] = []
  let done = false
  for (let at = PNG_SIGNATURE.length; !done; ) {
    if (at + 8 > bytes.length) throw new Error("PNG is truncated.")
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (body.length < length) throw new Error("PNG is truncated.")
    if (type === "IHDR") {
      const bitDepth = nth(body, 8)
      const colorType = nth(body, 9)
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG (bit depth ${bitDepth}, colour type ${colorType}).`)
      }
      if (nth(body, 12) !== 0) throw new Error("Interlaced PNGs are not supported.")
      header = {
        width: view.getUint32(at + 8),
        height: view.getUint32(at + 12),
        channels: colorType === 2 ? 3 : 4,
      }
    } else if (type === "IDAT") {
      idat.push(body)
    } else if (type === "IEND") {
      done = true
    }
    at += 12 + length
  }
  if (!header || idat.length === 0) throw new Error("PNG has no image data.")

  const compressed = new Uint8Array(idat.reduce((n, chunk) => n + chunk.length, 0))
  let offset = 0
  for (const chunk of idat) {
    compressed.set(chunk, offset)
    offset += chunk.length
  }
  const { width, height, channels } = header
  const data = unfilter(await inflate(compressed), width, height, channels)
  return { width, height, channels, data }
}

/** A terrarium PNG turned into elevations. */
export async function decodeTerrariumTile(png: Uint8Array): Promise<Tile> {
  const { width, height, channels, data } = await decodePng(png)
  if (width !== TILE_SIZE || height !== TILE_SIZE) throw new Error("Unexpected terrain tile size.")
  const elevations = new Float32Array(width * height)
  for (let i = 0; i < elevations.length; i++) {
    const o = i * channels
    elevations[i] = decodeTerrarium(nth(data, o), nth(data, o + 1), nth(data, o + 2))
  }
  return { elevations }
}

/** Fetches and decodes one tile from the AWS bucket. */
export const fetchTerrariumTile: GetTile = async (z, x, y, signal) => {
  const response = await fetch(`${TILE_URL}/${z}/${x}/${y}.png`, { signal })
  if (!response.ok) throw new Error(`Terrain tile ${z}/${x}/${y} failed (${response.status}).`)
  return decodeTerrariumTile(new Uint8Array(await response.arrayBuffer()))
}
