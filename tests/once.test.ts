import { expect, test } from "bun:test"
import { once } from "../src/once.ts"

test("does nothing until first asked", () => {
  let calls = 0
  once(() => ++calls)
  expect(calls).toBe(0)
})

test("builds once and returns the same value every time", () => {
  let calls = 0
  const get = once(() => ({ n: ++calls }))
  const first = get()
  expect(get()).toBe(first)
  expect(get()).toBe(first)
  expect(calls).toBe(1)
})

test("a failed build is retried on the next call", () => {
  let calls = 0
  const get = once(() => {
    calls++
    if (calls === 1) throw new Error("not yet")
    return "ok"
  })
  expect(() => get()).toThrow("not yet")
  expect(get()).toBe("ok")
  expect(get()).toBe("ok")
  expect(calls).toBe(2)
})
