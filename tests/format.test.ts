import { expect, test } from "bun:test"
import { formatDistance, formatGrade, formatImageDate } from "../src/format.ts"

test("formats", () => {
  expect(formatDistance(12_345)).toBe("12.3 km")
  expect(formatDistance(1_234)).toBe("1.23 km")
  expect(formatGrade(4.26)).toBe("4.3 %")
  expect(formatGrade(-0.01)).toBe("0 %")
  expect(formatImageDate("2019-05")).toMatch(/2019/)
  expect(formatImageDate("garbage")).toBe("garbage")
})
