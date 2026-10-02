// A small stand-in for Google's Street View, so Rider and the coverage scan
// can be tested without a browser or an API key. It models only what the app
// relies on: panoramas with a position, a capture date and arrow links; a
// lookup service; and a panorama viewer that fires `position_changed`
// asynchronously after `setPano`, as Google's does.

import { bearing, distance, type LatLng } from "../src/geo.ts"

export interface FakePano {
  id: string
  at: LatLng
  date: string
  links: { pano: string; heading: number }[]
}

class FakeLatLng {
  constructor(private readonly p: LatLng) {}
  lat() {
    return this.p.lat
  }
  lng() {
    return this.p.lng
  }
}

/** The enums the app reads from the `google.maps` namespace at runtime. */
export function installGoogle(): void {
  ;(globalThis as Record<string, unknown>).google = {
    maps: {
      StreetViewPreference: { NEAREST: "nearest" },
      StreetViewSource: { GOOGLE: "google", OUTDOOR: "outdoor" },
      StreetViewStatus: { ZERO_RESULTS: "ZERO_RESULTS" },
    },
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export class FakeWorld {
  readonly panos = new Map<string, FakePano>()
  lookups = 0
  /** When set, every lookup fails the way a quota error does. */
  failing = false
  /** Extra milliseconds before a lookup answers, so answers can arrive out of order. */
  latency: (req: { pano?: string; location?: LatLng }) => number = () => 0

  /**
   * Adds a capture run: one panorama per point, each linked to its
   * neighbours with the headings between them.
   */
  run(prefix: string, points: LatLng[], date: string): FakePano[] {
    const run = points.map((at, i) => ({
      id: `${prefix}${i}`,
      at,
      date,
      links: [] as FakePano["links"],
    }))
    run.forEach((p, i) => {
      for (const n of [run[i - 1], run[i + 1]]) {
        if (n) p.links.push({ pano: n.id, heading: bearing(p.at, n.at) })
      }
      this.panos.set(p.id, p)
    })
    return run
  }

  /** A one-way arrow from `from` to `to`. */
  link(from: string, to: string): void {
    const a = this.panos.get(from)!
    const b = this.panos.get(to)!
    a.links.push({ pano: b.id, heading: bearing(a.at, b.at) })
  }

  private data(p: FakePano) {
    return {
      location: { pano: p.id, latLng: new FakeLatLng(p.at) },
      imageDate: p.date,
      links: p.links.map((l) => ({ ...l })),
    }
  }

  readonly service = {
    getPanorama: async (req: { pano?: string; location?: LatLng; radius?: number }) => {
      this.lookups++
      await new Promise((r) => setTimeout(r, this.latency(req)))
      if (this.failing) throw Object.assign(new Error("quota"), { code: "OVER_QUERY_LIMIT" })
      const zero = Object.assign(new Error("none"), { code: "ZERO_RESULTS" })
      if (req.pano) {
        const p = this.panos.get(req.pano)
        if (!p) throw zero
        return { data: this.data(p) }
      }
      let best: FakePano | null = null
      let bestDist = req.radius ?? 50
      for (const p of this.panos.values()) {
        const d = distance(p.at, req.location!)
        if (d <= bestDist) {
          best = p
          bestDist = d
        }
      }
      if (!best) throw zero
      return { data: this.data(best) }
    },
  }

  asService(): google.maps.StreetViewService {
    return this.service as unknown as google.maps.StreetViewService
  }
}

export class FakePanorama {
  private pano: string | null = null
  private pov = { heading: 0, pitch: 0 }
  private readonly listeners = new Map<string, (() => void)[]>()
  visible = false

  constructor(private readonly world: FakeWorld) {}

  addListener(event: string, fn: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn])
  }

  /** Both the app's moves and the user's arrow clicks end up here. */
  setPano(id: string) {
    this.pano = id
    setTimeout(() => {
      for (const fn of this.listeners.get("position_changed") ?? []) fn()
    }, 0)
  }

  /** What clicking one of Google's arrows (or click-to-go) does. */
  userMovesTo(id: string) {
    this.setPano(id)
  }

  getPano() {
    return this.pano as string
  }
  getPosition() {
    const p = this.pano ? this.world.panos.get(this.pano) : undefined
    return p ? (new FakeLatLng(p.at) as unknown as google.maps.LatLng) : null
  }
  getPov() {
    return this.pov
  }
  setPov(pov: { heading: number; pitch: number }) {
    this.pov = pov
  }
  setVisible(v: boolean) {
    this.visible = v
  }

  asPanorama(): google.maps.StreetViewPanorama {
    return this as unknown as google.maps.StreetViewPanorama
  }
}

/** Lets pending fake lookups and `position_changed` events run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick()
}
