import { beforeAll, expect, test } from "bun:test"
import { Course } from "../src/course.ts"
import { type Gap, scanCoverage } from "../src/coverage.ts"
import { FakeWorld, installGoogle, settle } from "./fake-street-view.ts"
import { ORIGIN, offset, path } from "./helpers.ts"

beforeAll(installGoogle)

const course = () =>
  new Course(
    path([
      [0, 0],
      [1000, 0],
    ]),
  )
const along = (from: number, to: number) => {
  const out = []
  for (let x = from; x <= to; x += 10) out.push(offset(ORIGIN, x, 0))
  return out
}

async function scan(world: FakeWorld, until: () => boolean) {
  let reported: Gap[] | null = null
  const cancel = scanCoverage(course(), world.asService(), (gaps) => {
    reported = gaps
  })
  for (let i = 0; i < 400 && !until(); i++) await settle(1)
  return { reported: reported as Gap[] | null, cancel }
}

test("reports the stretch without imagery, and nothing else", async () => {
  const world = new FakeWorld()
  world.run("a", along(0, 300), "2024-07")
  world.run("b", along(600, 1000), "2024-07")
  // One sample every 50 m: 21 lookups for 1 km.
  const { reported } = await scan(world, () => world.lookups >= 21)
  await settle()
  expect(reported!).toHaveLength(1)
  const [from, to] = reported![0]!
  expect(from).toBeGreaterThan(300)
  expect(from).toBeLessThan(350)
  expect(to).toBeGreaterThan(550)
  expect(to).toBeLessThan(600)
})

test("a full-coverage course has no gaps", async () => {
  const world = new FakeWorld()
  world.run("a", along(0, 1000), "2024-07")
  const { reported } = await scan(world, () => world.lookups >= 21)
  await settle()
  expect(reported!).toEqual([])
})

test("cancelling stops the scan", async () => {
  const world = new FakeWorld()
  world.run("a", along(0, 1000), "2024-07")
  const cancel = scanCoverage(course(), world.asService(), () => {})
  cancel()
  await settle(20)
  // Each of the parallel workers may have one lookup in flight; no more start.
  expect(world.lookups).toBeLessThanOrEqual(3)
})

test(
  "a failing service ends the scan without painting the course as a gap",
  async () => {
    const world = new FakeWorld()
    world.run("a", along(0, 1000), "2024-07")
    world.failing = true
    let reported: Gap[] | null = null
    scanCoverage(course(), world.asService(), (gaps) => {
      reported = gaps
    })
    // Each failure is retried once after a pause, then the scan gives up.
    await new Promise((r) => setTimeout(r, 2500))
    expect(reported!).toEqual([])
    expect(world.lookups).toBeLessThanOrEqual(6)
  },
  { timeout: 5000 },
)
