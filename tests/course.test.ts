import { describe, expect, test } from "bun:test"
import { Course } from "../src/course.ts"
import { distance } from "../src/geo.ts"
import { ORIGIN, offset, path } from "./helpers.ts"

describe("Course geometry", () => {
  const east = new Course(
    path([
      [0, 0],
      [1000, 0],
    ]),
  )

  test("length and pointAt follow the track", () => {
    expect(east.length).toBeCloseTo(1000, 0)
    expect(distance(east.pointAt(250), offset(ORIGIN, 250, 0))).toBeLessThan(0.5)
    expect(distance(east.pointAt(-5), ORIGIN)).toBeLessThan(0.01)
    expect(distance(east.pointAt(5000), offset(ORIGIN, 1000, 0))).toBeLessThan(0.5)
  })

  test("drops repeated fixes", () => {
    const pts = path([
      [0, 0],
      [100, 0],
    ])
    const doubled = pts.flatMap((p) => [p, { ...p }])
    expect(new Course(doubled).points.length).toBe(pts.length)
  })

  test("rejects a course with a single distinct point", () => {
    expect(
      () =>
        new Course([
          { ...ORIGIN, ele: null },
          { ...ORIGIN, ele: null },
        ]),
    ).toThrow()
  })

  test("headingAt looks along the course, and backwards from the finish", () => {
    expect(east.headingAt(0)).toBeCloseTo(90, 0)
    expect(east.headingAt(east.length)).toBeCloseTo(90, 0)
    const corner = new Course(
      path([
        [0, 0],
        [100, 0],
        [100, 100],
      ]),
    )
    // 30 m before the corner it already looks at the corner, then turns north.
    expect(corner.headingAt(150)).toBeCloseTo(0, 0)
  })

  test("elevation and grade", () => {
    // Climbs 1 m per 10 m point: a steady 10 % grade.
    const climb = new Course(
      path(
        [
          [0, 0],
          [1000, 0],
        ],
        10,
        (i) => 100 + i,
      ),
    )
    expect(climb.hasElevation).toBe(true)
    expect(climb.elevationAt(505)!).toBeCloseTo(150.5, 1)
    expect(climb.gradeAt(500)!).toBeCloseTo(10, 0)
    expect(climb.gradeAt(0)!).toBeCloseTo(10, 0)
    expect(east.hasElevation).toBe(false)
    expect(east.gradeAt(500)).toBeNull()
  })
})

describe("Course.locate", () => {
  test("projects onto a straight course", () => {
    const c = new Course(
      path([
        [0, 0],
        [1000, 0],
      ]),
    )
    const hit = c.locate(offset(ORIGIN, 420, 8))
    expect(hit.s).toBeCloseTo(420, 0)
    expect(hit.dist).toBeCloseTo(8, 0)
  })

  // Out 1 km east and back on the same road: every point is on the course twice.
  const outAndBack = new Course(
    path([
      [0, 0],
      [1000, 0],
      [0, 0],
    ]),
  )

  test("out-and-back resolves to the leg the rider is on", () => {
    const p = offset(ORIGIN, 300, 0)
    expect(outAndBack.locate(p, { near: 290 }).s).toBeCloseTo(300, 0)
    expect(outAndBack.locate(p, { near: 1690 }).s).toBeCloseTo(1700, 0)
  })

  test("direction of travel picks the leg near the turnaround", () => {
    // 50 m before the turn both legs are inside the search window.
    const p = offset(ORIGIN, 950, 0)
    expect(outAndBack.locate(p, { near: 1000, travel: 90 }).s).toBeCloseTo(950, 0)
    expect(outAndBack.locate(p, { near: 1000, travel: 270 }).s).toBeCloseTo(1050, 0)
  })

  test("laps resolve to the current lap", () => {
    // A 400 m square ridden twice.
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]
    const laps = new Course(path([...square, ...square.slice(1)]))
    const p = offset(ORIGIN, 100, 50)
    expect(laps.locate(p, { near: 140 }).s).toBeCloseTo(150, 0)
    expect(laps.locate(p, { near: 540 }).s).toBeCloseTo(550, 0)
  })

  test("falls back to the whole course when the window has nothing close", () => {
    const c = new Course(
      path([
        [0, 0],
        [5000, 0],
      ]),
    )
    const hit = c.locate(offset(ORIGIN, 4000, 5), { near: 100 })
    expect(hit.s).toBeCloseTo(4000, 0)
    expect(hit.dist).toBeCloseTo(5, 0)
  })

  test("reports how far off course a point is", () => {
    const c = new Course(
      path([
        [0, 0],
        [1000, 0],
      ]),
    )
    expect(c.locate(offset(ORIGIN, 500, 120), { near: 500 }).dist).toBeCloseTo(120, 0)
  })
})

describe("Course.between", () => {
  test("cuts a stretch with interpolated ends and the corners inside it", () => {
    const c = new Course(
      path(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        100,
      ),
    )
    const piece = c.between(50, 150)
    expect(piece.length).toBe(3)
    expect(distance(piece[0]!, offset(ORIGIN, 50, 0))).toBeLessThan(0.5)
    expect(distance(piece[1]!, offset(ORIGIN, 100, 0))).toBeLessThan(0.5)
    expect(distance(piece[2]!, offset(ORIGIN, 100, 50))).toBeLessThan(0.5)
  })
})
