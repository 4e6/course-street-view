/** `value` itself, or a thrown error naming `what` when it is missing. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Expected ${what}.`)
  return value
}

/** `xs[i]`, for indices that the caller's own arithmetic keeps in range. */
export function nth<T>(xs: readonly T[], i: number): T {
  return defined(xs[i], `an item at index ${i}`)
}
