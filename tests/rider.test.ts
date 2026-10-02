import { beforeAll, describe, expect, test } from "bun:test"
import { Course } from "../src/course.ts"
import type { LatLng } from "../src/geo.ts"
import { Rider, type RiderState } from "../src/rider.ts"
import { FakePanorama, FakeWorld, installGoogle, settle } from "./fake-street-view.ts"
import { ORIGIN, offset, path } from "./helpers.ts"

beforeAll(installGoogle)

/** Points every `step` metres from `from` to `to` metres east of ORIGIN, `north` metres up. */
function east(from: number, to: number, step: number, north = 0): LatLng[] {
  const out: LatLng[] = []
  const dir = to >= from ? 1 : -1
  for (let x = from; dir * (to - x) >= -1e-9; x += dir * step) out.push(offset(ORIGIN, x, north))
  return out
}

function setup() {
  const world = new FakeWorld()
  const pano = new FakePanorama(world)
  const states: RiderState[] = []
  const rider = new Rider(pano.asPanorama(), world.asService(), (s) => states.push({ ...s }))
  return { world, pano, rider, states }
}

// A straight 1 km road east, with a 2024 capture every 10 m.
const straight = () =>
  new Course(
    path([
      [0, 0],
      [1000, 0],
    ]),
  )

describe("jumping to a position", () => {
  test("shows the nearest panorama, facing along the course", async () => {
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(straight(), 503)
    await settle()
    expect(pano.getPano()).toBe("a50")
    expect(rider.current.s).toBeCloseTo(500, 0)
    expect(rider.current.imageDate).toBe("2024-07")
    expect(rider.current.noImagery).toBeNull()
    expect(pano.getPov().heading).toBeCloseTo(90, 0)
    expect(pano.visible).toBe(true)
  })

  test("reports no imagery when nothing is near", async () => {
    const { world, rider } = setup()
    world.run("a", east(0, 200, 10), "2024-07")
    await rider.setCourse(straight(), 700)
    expect(rider.current.noImagery).toBe("here")
    expect(rider.current.s).toBeCloseTo(700, 0)
  })

  test("a later jump overtakes an earlier one still in flight", async () => {
    const course = straight()
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 0)
    // The first lookup answers last, as a slow network might.
    world.latency = (req) =>
      req.location && req.location.lng < offset(ORIGIN, 400, 0).lng ? 30 : 0
    const first = rider.goTo(100)
    const second = rider.goTo(800)
    await Promise.all([first, second])
    await settle()
    expect(pano.getPano()).toBe("a80")
    expect(rider.current.s).toBeCloseTo(800, 0)
  })
})

describe("stepping", () => {
  test("follows the arrows along the course, about one panorama per step", async () => {
    const course = straight()
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 500)
    for (let i = 0; i < 3; i++) expect(await rider.step(1)).toBe("moved")
    expect(pano.getPano()).toBe("a53")
    expect(rider.current.s).toBeCloseTo(530, 0)
    expect(await rider.step(-1)).toBe("moved")
    expect(rider.current.s).toBeCloseTo(520, 0)
  })

  test("stays on the same capture even when another year's arrow is better aligned", async () => {
    const course = straight()
    const { world, rider } = setup()
    // This year's run zigzags 1.5 m either side of the line, so its arrows are
    // ~17° off the course; an older run lies exactly on it, and every panorama
    // has an arrow into it.
    const zigzag = east(0, 1000, 10).map((p, i) => offset(p, 0, i % 2 ? 1.5 : -1.5))
    const road = world.run("a", zigzag, "2024-07")
    const old = world.run("old", east(5, 1005, 10), "2008-04")
    road.forEach((p, i) => {
      if (old[i]) world.link(p.id, old[i].id)
    })
    await rider.setCourse(course, 300)
    for (let i = 0; i < 5; i++) await rider.step(1)
    expect(rider.current.imageDate).toBe("2024-07")
    expect(rider.current.s).toBeCloseTo(350, 0)
  })

  test("chains through a dense walking capture so a step still covers ground", async () => {
    const course = straight()
    const { world, rider } = setup()
    world.run("w", east(0, 1000, 3), "2021-10")
    await rider.setCourse(course, 300)
    const start = rider.current.s
    await rider.step(1)
    expect(rider.current.s - start).toBeGreaterThanOrEqual(8)
    expect(rider.current.s - start).toBeLessThan(15)
  })

  test("searches past a gap in coverage when no arrow crosses it", async () => {
    const course = straight()
    const { world, rider } = setup()
    world.run("a", east(0, 300, 10), "2024-07")
    world.run("b", east(600, 1000, 10), "2023-05")
    await rider.setCourse(course, 300)
    expect(await rider.step(1)).toBe("moved")
    expect(rider.current.s).toBeCloseTo(600, 0)
    expect(rider.current.imageDate).toBe("2023-05")
  })

  test("gives up on a gap longer than a kilometre", async () => {
    const course = new Course(
      path([
        [0, 0],
        [3000, 0],
      ]),
    )
    const { world, rider } = setup()
    world.run("a", east(0, 200, 10), "2024-07")
    await rider.setCourse(course, 200)
    expect(await rider.step(1)).toBe("gap")
    expect(rider.current.noImagery).toBe("ahead")
  })

  test("stops at the finish", async () => {
    const course = straight()
    const { world, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 1000)
    expect(await rider.step(1)).toBe("end")
  })
})

describe("moves made inside Street View", () => {
  test("an arrow click moves s", async () => {
    const course = straight()
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 500)
    await settle()
    pano.userMovesTo("a51")
    await settle()
    expect(rider.current.s).toBeCloseTo(510, 0)
    expect(rider.current.offCourse).toBeNull()
    expect(rider.current.imageDate).toBe("2024-07")
  })

  test("the app's own moves are not mistaken for arrow clicks", async () => {
    const course = straight()
    const { world, rider, states } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 500)
    await settle()
    const before = states.length
    await rider.step(1)
    await settle()
    // Exactly the step's own update: the panorama's position_changed echo of
    // the app's setPano must not be re-processed as a user move.
    expect(states.length - before).toBe(1)
  })

  test("turning off the course is reported, with the distance", async () => {
    const course = straight()
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    // A side road north from 500 m.
    const side = world.run(
      "n",
      [10, 20, 30, 40, 50, 60].map((y) => offset(ORIGIN, 500, y)),
      "2024-07",
    )
    world.link("a50", side[0]!.id)
    await rider.setCourse(course, 500)
    await settle()
    for (const p of side.slice(0, 3)) {
      pano.userMovesTo(p.id)
      await settle()
    }
    expect(rider.current.offCourse).toBeNull()
    for (const p of side.slice(3)) {
      pano.userMovesTo(p.id)
      await settle()
    }
    expect(rider.current.offCourse).toBeCloseTo(60, 0)
    expect(rider.current.s).toBeCloseTo(500, 0)

    await rider.goTo(rider.current.s)
    expect(rider.current.offCourse).toBeNull()
    expect(pano.getPano()).toBe("a50")
  })

  test("on an out-and-back, an arrow click stays on the leg being ridden", async () => {
    // 1 km east and back on the same road; x = 300 m is s = 300 and s = 1700.
    const course = new Course(
      path([
        [0, 0],
        [1000, 0],
        [0, 0],
      ]),
    )
    const { world, pano, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 1700)
    await settle()
    expect(pano.getPano()).toBe("a30")
    pano.userMovesTo("a29")
    await settle()
    expect(rider.current.s).toBeCloseTo(1710, 0)
  })
})

describe("moves made inside Street View, on laps", () => {
  test("an arrow click stays on the current lap", async () => {
    // A 400 m square ridden twice, same direction both times, so direction of
    // travel cannot tell the laps apart; only the current position can.
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]
    const course = new Course(path([...square, ...square.slice(1)]))
    const { world, pano, rider } = setup()
    world.run("q", path(square), "2024-07")
    await rider.setCourse(course, 550)
    await settle()
    expect(pano.getPano()).toBe("q15")
    pano.userMovesTo("q16")
    await settle()
    expect(rider.current.s).toBeCloseTo(560, 0)
  })
})

describe("play", () => {
  test("rides to the finish and stops", async () => {
    const course = new Course(
      path([
        [0, 0],
        [100, 0],
      ]),
    )
    const { world, rider } = setup()
    world.run("a", east(0, 100, 10), "2024-07")
    await rider.setCourse(course, 0)
    rider.interval = 0
    rider.play()
    expect(rider.current.playing).toBe(true)
    for (let i = 0; i < 200 && rider.current.playing; i++) await settle(1)
    expect(rider.current.playing).toBe(false)
    expect(rider.current.s).toBeCloseTo(100, 0)
  })

  test("pause stops it where it is", async () => {
    const course = straight()
    const { world, rider } = setup()
    world.run("a", east(0, 1000, 10), "2024-07")
    await rider.setCourse(course, 0)
    rider.interval = 0
    rider.play()
    await settle(10)
    rider.pause()
    const at = rider.current.s
    await settle(20)
    expect(rider.current.playing).toBe(false)
    expect(rider.current.s).toBe(at)
    expect(at).toBeGreaterThan(0)
  })
})
