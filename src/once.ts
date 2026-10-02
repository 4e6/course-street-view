/**
 * Defers `make` until the result is first asked for, then returns that same
 * result ever after. A `make` that throws is not remembered, so the next call
 * tries again.
 */
export function once<T>(make: () => T): () => T {
  let made: { value: T } | null = null
  return () => {
    made ??= { value: make() }
    return made.value
  }
}
