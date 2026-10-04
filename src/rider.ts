import type { Course } from "./course.ts"
import { angleDiff, bearing, distance, type LatLng } from "./geo.ts"

export interface RiderState {
  /** Metres along the course. */
  s: number
  /** Metres from the course when the viewer has wandered off it, else null. */
  offCourse: number | null
  /** Capture month of the imagery on screen, "YYYY-MM". */
  imageDate: string | null
  /** Why there is no imagery for the current position, when there isn't. */
  noImagery: "here" | "ahead" | null
  playing: boolean
}

export type StepResult = "moved" | "stale" | "end" | "gap"

// Further from the course than this counts as having left it.
const OFF_COURSE = 30
// Offsets tried, in order, when stepping along the course. Street View
// panoramas are roughly 10 m apart; the long tail skips coverage gaps.
const STEP_OFFSETS = [10, 20, 30, 45, 60, 80, 100, 150, 200, 300, 450, 600, 800, 1000]
// How far a Street View arrow may point away from the course and still be followed.
const LINK_MAX_ANGLE = 50
// Walking captures (parks, pedestrian streets) have panoramas ~3 m apart. A
// step chains through arrows until it has covered this much, at most
// LINK_MAX_HOPS arrows, so steps and play move at a steady pace everywhere.
const MIN_ADVANCE = 8
const LINK_MAX_HOPS = 4
// Arrows can lead into imagery from another year. Leaving the current
// capture costs this many degrees of misalignment when ranking arrows, so the
// view only changes year when no arrow from the same capture goes the right way.
const OTHER_CAPTURE_PENALTY = 25

/** Panorama data that says where it is, which is all the rider ever shows. */
type LocatedPanorama = google.maps.StreetViewPanoramaData & {
  location: google.maps.StreetViewLocation & { latLng: google.maps.LatLng }
}

function isLocated(data: google.maps.StreetViewPanoramaData): data is LocatedPanorama {
  return !!data.location?.pano && !!data.location.latLng
}

export function toLatLng(p: google.maps.LatLng): LatLng {
  return { lat: p.lat(), lng: p.lng() }
}

/**
 * The nearest official outdoor Google panorama within `radius` metres, or null
 * when there is none. Other failures (quota, network) throw, so that callers
 * can tell "no imagery here" from "could not ask".
 */
export async function findPanorama(
  service: google.maps.StreetViewService,
  location: LatLng,
  radius: number,
): Promise<LocatedPanorama | null> {
  try {
    const { data } = await service.getPanorama({
      location,
      radius,
      preference: google.maps.StreetViewPreference.NEAREST,
      sources: [google.maps.StreetViewSource.GOOGLE, google.maps.StreetViewSource.OUTDOOR],
    })
    return isLocated(data) ? data : null
  } catch (e) {
    if ((e as { code?: string }).code === google.maps.StreetViewStatus.ZERO_RESULTS) return null
    throw e
  }
}

/**
 * Moves one Street View panorama along a course and keeps a position `s`
 * (metres along the course) in step with it, whichever way the move started:
 * the slider, the step buttons, play, or Google's own arrows and pegman.
 *
 * The panorama object is created once and only ever re-pointed with
 * `setPano`. Google bills per panorama object loaded, not per image viewed,
 * so a whole session costs one Dynamic Street View load.
 */
export class Rider {
  private course: Course | null = null
  private state: RiderState = {
    s: 0,
    offCourse: null,
    imageDate: null,
    noImagery: null,
    playing: false,
  }
  // The panorama this class itself last asked for, so its own moves are not
  // mistaken for the viewer clicking an arrow.
  private expectedPano: string | null = null
  private lastPos: LatLng | null = null
  // Bumped by every move; an async lookup that finds it changed was overtaken.
  private seq = 0
  private playToken = 0
  interval = 1000

  constructor(
    private readonly pano: google.maps.StreetViewPanorama,
    private readonly service: google.maps.StreetViewService,
    private readonly onChange: (state: Readonly<RiderState>) => void,
  ) {
    pano.addListener("position_changed", () => this.onPositionChanged())
  }

  get current(): Readonly<RiderState> {
    return this.state
  }

  setCourse(course: Course, s = 0): Promise<void> {
    this.pause()
    this.course = course
    this.byIdCache.clear()
    this.expectedPano = null
    this.lastPos = null
    return this.goTo(s)
  }

  /** Jumps to the panorama nearest `s`, facing along the course. */
  async goTo(s: number): Promise<void> {
    const course = this.course
    if (!course) return
    s = course.clamp(s)
    const my = ++this.seq
    this.update({ s })
    const data = await this.find(course.pointAt(s), 50)
    if (my !== this.seq) return
    if (!data) {
      this.update({ offCourse: null, imageDate: null, noImagery: "here" })
      return
    }
    const hit = course.locate(toLatLng(data.location.latLng), { near: s })
    this.show(course, data, hit.s)
  }

  /**
   * Moves to the next panorama along the course in direction `dir`. Unlike
   * Google's arrows this never turns off at a junction.
   *
   * It follows the Street View arrow that points along the course when there
   * is one, which keeps to a single capture run, just as clicking the arrows
   * does. Searching by position instead would pick whichever panorama is
   * nearest, and those come from different years and flicker between them.
   * The search is the fallback, and what skips coverage gaps.
   */
  async step(dir: 1 | -1): Promise<StepResult> {
    const course = this.course
    if (!course) return "end"
    const start = this.state.s
    const current = this.pano.getPano()
    const my = ++this.seq

    if (current && this.state.offCourse === null) {
      const linked = await this.followLink(course, dir, start, current, my)
      if (linked) return linked
    }

    for (const offset of STEP_OFFSETS) {
      const target = course.clamp(start + dir * offset)
      const data = await this.find(course.pointAt(target), 25)
      if (my !== this.seq) return "stale"
      if (data && data.location.pano !== current) {
        const hit = course.locate(toLatLng(data.location.latLng), { near: target })
        // The nearest panorama can sit behind us, or on a road crossing the course.
        if ((hit.s - start) * dir > 1 && hit.dist <= OFF_COURSE) {
          this.show(course, data, hit.s)
          return "moved"
        }
      }
      if (target === 0 || target === course.length) return "end"
    }
    this.update({ noImagery: "ahead" })
    return "gap"
  }

  play(): void {
    if (this.state.playing || !this.course) return
    const token = ++this.playToken
    this.update({ playing: true })
    void this.loop(token)
  }

  pause(): void {
    this.playToken++
    if (this.state.playing) this.update({ playing: false })
  }

  private async loop(token: number): Promise<void> {
    while (token === this.playToken) {
      const result = await this.step(1)
      if (token !== this.playToken) return
      if (result === "end" || result === "gap") {
        this.pause()
        return
      }
      await new Promise((r) => setTimeout(r, this.interval))
    }
  }

  /** Moves through the arrows that best match the course, if any do. */
  private async followLink(
    course: Course,
    dir: 1 | -1,
    start: number,
    current: string,
    my: number,
  ): Promise<StepResult | null> {
    let from = current
    let at = start
    let reached: { data: LocatedPanorama; s: number } | null = null
    for (let hop = 0; hop < LINK_MAX_HOPS && (at - start) * dir < MIN_ADVANCE; hop++) {
      const next = await this.nextByLink(course, dir, at, from)
      if (my !== this.seq) return "stale"
      if (!next) break
      reached = next
      from = next.data.location.pano
      at = next.s
    }
    if (!reached) return null
    this.show(course, reached.data, reached.s)
    return "moved"
  }

  /** The panorama behind the arrow from `from` that leads along the course, if one does. */
  private async nextByLink(
    course: Course,
    dir: 1 | -1,
    at: number,
    from: string,
  ): Promise<{ data: LocatedPanorama; s: number } | null> {
    const here = await this.byId(from)
    const want =
      dir > 0 ? course.headingAt(at) : (course.headingAt(Math.max(0, at - 30)) + 180) % 360
    const arrows = (here?.links ?? []).flatMap((l) =>
      l.pano && l.heading != null && angleDiff(l.heading, want) <= LINK_MAX_ANGLE
        ? [{ pano: l.pano, heading: l.heading }]
        : [],
    )
    const candidates = await Promise.all(
      arrows.map(async (a) => ({ heading: a.heading, data: await this.byId(a.pano) })),
    )
    const rank = (c: (typeof candidates)[number]) =>
      angleDiff(c.heading, want) +
      (c.data?.imageDate === here?.imageDate ? 0 : OTHER_CAPTURE_PENALTY)
    candidates.sort((a, b) => rank(a) - rank(b))
    for (const { data } of candidates) {
      if (!data) continue
      const hit = course.locate(toLatLng(data.location.latLng), { near: at, travel: want })
      if ((hit.s - at) * dir > 1 && hit.dist <= OFF_COURSE) return { data, s: hit.s }
    }
    return null
  }

  // Here a failed lookup and a missing panorama mean the same thing: nothing to show.
  private async find(location: LatLng, radius: number) {
    try {
      return await findPanorama(this.service, location, radius)
    } catch {
      return null
    }
  }

  // Panorama data never changes for an id, and arrows lead back and forth
  // between the same few panoramas, so lookups by id are cached per course.
  private readonly byIdCache = new Map<string, Promise<LocatedPanorama | null>>()

  private byId(pano: string): Promise<LocatedPanorama | null> {
    let data = this.byIdCache.get(pano)
    if (!data) {
      data = this.service.getPanorama({ pano }).then(
        (r) => (isLocated(r.data) ? r.data : null),
        () => null,
      )
      this.byIdCache.set(pano, data)
    }
    return data
  }

  private show(course: Course, data: LocatedPanorama, s: number): void {
    const id = data.location.pano
    this.expectedPano = id
    this.lastPos = toLatLng(data.location.latLng)
    if (this.pano.getPano() !== id) this.pano.setPano(id)
    this.pano.setPov({ heading: course.headingAt(s), pitch: this.pano.getPov().pitch ?? 0 })
    this.pano.setVisible(true)
    this.update({ s, offCourse: null, imageDate: data.imageDate ?? null, noImagery: null })
  }

  /** Google's arrows, click-to-go, keyboard and pegman all land here. */
  private onPositionChanged(): void {
    const course = this.course
    const position = this.pano.getPosition()
    if (!course || !position) return
    const here = toLatLng(position)
    const id = this.pano.getPano()
    if (id === this.expectedPano) {
      this.lastPos = here
      return
    }
    this.expectedPano = null
    const my = ++this.seq
    const travel =
      this.lastPos && distance(this.lastPos, here) > 2 ? bearing(this.lastPos, here) : undefined
    this.lastPos = here
    const hit = course.locate(here, { near: this.state.s, travel })
    this.update({
      s: hit.s,
      offCourse: hit.dist > OFF_COURSE ? hit.dist : null,
      imageDate: null,
      noImagery: null,
    })
    // Looking a panorama up by id is free and is the only way to get its date.
    void this.byId(id).then((data) => {
      if (my === this.seq) this.update({ imageDate: data?.imageDate ?? null })
    })
  }

  private update(patch: Partial<RiderState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }
}
