import { load, save } from "./storage.ts"

declare global {
  interface Window {
    /** Called by the Maps JavaScript API when it rejects the key. */
    gm_authFailure?: () => void
  }
}

const USER_KEY = "csv.apiKey"

/** The key baked into this build, if any (see README: GitHub Actions secret). */
export const builtInKey: string | null = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null

/** A key the visitor pasted into Settings; it takes precedence over the built-in one. */
export function userKey(): string | null {
  return load<string>(USER_KEY)
}

export function setUserKey(key: string | null): void {
  save(USER_KEY, key?.trim() || null)
}

export function activeKey(): string | null {
  return userKey() ?? builtInKey
}

/**
 * Loads the Maps JavaScript API and the libraries this app uses. The key can
 * only be chosen once per page, so changing it means reloading.
 */
export async function loadMaps(key: string, onAuthFailure: () => void): Promise<void> {
  window.gm_authFailure = onAuthFailure
  await new Promise<void>((resolve, reject) => {
    const callback = "__courseStreetViewMapsLoaded"
    ;(window as unknown as Record<string, () => void>)[callback] = resolve
    const script = document.createElement("script")
    const params = new URLSearchParams({ key, v: "weekly", loading: "async", callback })
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => reject(new Error("Could not load Google Maps. Check your connection."))
    document.head.append(script)
  })
  await Promise.all([
    google.maps.importLibrary("core"),
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("streetView"),
  ])
}
