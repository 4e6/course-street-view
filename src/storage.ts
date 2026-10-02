// localStorage can be missing or throw (private windows, blocked site data),
// and nothing stored here is essential, so every access degrades to a no-op.

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage unavailable: the app works without it.
  }
}
