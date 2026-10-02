import { expect, test } from "bun:test"
import { gapsFrom } from "../src/coverage.ts"

test("runs of missing samples become gaps half a spacing either side", () => {
  const covered = [true, false, false, true, undefined, false]
  expect(gapsFrom(covered, 50, 260)).toEqual([
    [25, 125],
    [225, 260],
  ])
})

test("a gap at the start is clamped to the course", () => {
  expect(gapsFrom([false, true], 50, 60)).toEqual([[0, 25]])
})

test("unknown samples are not gaps", () => {
  expect(gapsFrom([undefined, undefined, true], 50, 100)).toEqual([])
})
