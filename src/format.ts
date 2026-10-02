/** Two decimals below 10 km, where one ~10 m Street View step should still show. */
export function formatDistance(m: number): string {
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`
}

/** "2019-05" → "May 2019". */
export function formatImageDate(date: string): string {
  const [year, month] = date.split("-").map(Number)
  if (!year || !month) return date
  return new Date(Date.UTC(year, month - 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatGrade(grade: number): string {
  const rounded = Math.round(grade * 10) / 10
  return `${rounded === 0 ? 0 : rounded.toFixed(1)} %`
}
