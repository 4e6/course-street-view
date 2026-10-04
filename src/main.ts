import "./style.css"
import { Course, type CoursePoint } from "./course.ts"
import { scanCoverage } from "./coverage.ts"
import { formatDistance, formatGrade, formatImageDate } from "./format.ts"
import { parseGpx } from "./gpx.ts"
import { activeKey, builtInKey, loadMaps, setUserKey, userKey } from "./maps.ts"
import { CourseMap } from "./mapview.ts"
import { once } from "./once.ts"
import { Profile } from "./profile.ts"
import { Rider, type RiderState, toLatLng } from "./rider.ts"
import { load, save } from "./storage.ts"

const COURSE_KEY = "csv.course"
const POSITION_KEY = "csv.position"
const SPLIT_KEY = "csv.split"
const SPEED_KEY = "csv.speed"

const NORMAL_SPEED = { label: "1×", interval: 1000 }
const SPEEDS = [{ label: "½×", interval: 2000 }, NORMAL_SPEED, { label: "2×", interval: 500 }]

interface SavedCourse {
  name: string | null
  points: [lat: number, lng: number, ele: number | null][]
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: A | null = null
  const run = () => {
    last = Date.now()
    timer = undefined
    const args = pending
    pending = null
    if (args) fn(...args)
  }
  const throttled = (...args: A) => {
    pending = args
    if (timer === undefined) timer = setTimeout(run, Math.max(0, ms - (Date.now() - last)))
  }
  throttled.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    pending = null
  }
  return throttled
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(message: string): void {
  const el = $("toast")
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
  }, 4000)
}

function openSettings(reason?: string): void {
  const reasonEl = $("key-reason")
  reasonEl.textContent = reason ?? ""
  reasonEl.hidden = !reason
  $<HTMLInputElement>("key-input").value = userKey() ?? ""
  $<HTMLDialogElement>("settings").showModal()
}

function setupSettings(): void {
  const input = $<HTMLInputElement>("key-input")
  $("open-settings").addEventListener("click", () => openSettings())
  $("key-builtin").textContent = !builtInKey
    ? "This copy of the app has no built-in key, so a key of your own is required."
    : userKey()
      ? "You are using your own key."
      : "You are using the site's built-in key."
  $("key-clear").hidden = !builtInKey || !userKey()
  $("key-clear").addEventListener("click", () => {
    setUserKey(null)
    location.reload()
  })
  $("key-save").addEventListener("click", () => {
    if (!input.value.trim()) {
      input.focus()
      return
    }
    setUserKey(input.value)
    location.reload()
  })
}

/** The draggable bar between Street View and the map. */
function setupDivider(): void {
  const divider = $("divider")
  const split = $("split")
  const apply = (fraction: number) => {
    const f = Math.max(0.2, Math.min(0.85, fraction))
    document.documentElement.style.setProperty("--split", String(f))
    divider.setAttribute("aria-valuenow", String(Math.round(f * 100)))
    return f
  }
  const saved = load<number>(SPLIT_KEY)
  if (saved) apply(saved)

  let dragging = false
  divider.addEventListener("pointerdown", (e) => {
    dragging = true
    divider.setPointerCapture(e.pointerId)
  })
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return
    const rect = split.getBoundingClientRect()
    apply((e.clientY - rect.top) / rect.height)
  })
  const end = () => {
    if (!dragging) return
    dragging = false
    save(SPLIT_KEY, Number(getComputedStyle(document.documentElement).getPropertyValue("--split")))
  }
  divider.addEventListener("pointerup", end)
  divider.addEventListener("pointercancel", end)
  divider.addEventListener("keydown", (e) => {
    const delta = { ArrowUp: -0.05, ArrowDown: 0.05 }[e.key]
    if (!delta) return
    e.preventDefault()
    const current = Number(getComputedStyle(document.documentElement).getPropertyValue("--split"))
    save(SPLIT_KEY, apply(current + delta))
  })
}

async function main(): Promise<void> {
  setupSettings()
  setupDivider()

  const key = activeKey()
  if (!key) {
    $("open-gpx").addEventListener("click", () => openSettings())
    openSettings("Add a Google Maps API key to get started.")
    return
  }
  try {
    await loadMaps(key, () =>
      openSettings(
        "Google rejected the API key. Check that the Maps JavaScript API is enabled for it and that its website restrictions include this address.",
      ),
    )
  } catch (e) {
    toast((e as Error).message)
    return
  }

  let course: Course | null = null
  let cancelScan = () => {}
  const savePosition = throttle((s: number) => save(POSITION_KEY, Math.round(s)), 1000)
  const speed = { index: load<number>(SPEED_KEY) ?? 1 }

  // The billable Google objects — the map and the Street View panorama — are
  // built on the first course, not on page load, so a visitor who lands on
  // the "choose a GPX" screen and leaves costs nothing. Built once and reused
  // for every course after: each new panorama object is a billable Dynamic
  // Street View load, while moving this one is not.
  const viewer = once(() => {
    const pano = new google.maps.StreetViewPanorama($("pano"), {
      visible: false,
      addressControl: false,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      motionTrackingControl: false,
      showRoadLabels: true,
      linksControl: true,
      clickToGo: true,
    })
    const service = new google.maps.StreetViewService()
    const rider = new Rider(pano, service, (state) => render(state))
    const courseMap = new CourseMap($("map"), (p) => {
      if (!course) return
      rider.pause()
      void rider.goTo(course.locate(p).s)
    })
    pano.addListener("pov_changed", () => courseMap.setHeading(pano.getPov().heading ?? 0))
    // For poking at from the console during development; stripped from builds.
    if (import.meta.env.DEV) Object.assign(window, { pano, rider })
    return { pano, service, rider, courseMap }
  })
  // Only reachable once a course is loaded: every control that moves along
  // the course is hidden or inert until then.
  const rider = () => viewer().rider

  const render = (state: Readonly<RiderState>) => {
    if (!course) return
    const { pano, courseMap } = viewer()
    $("hud-distance").textContent = `${formatDistance(state.s)} / ${formatDistance(course.length)}`
    const ele = course.elevationAt(state.s)
    $("hud-elevation").textContent = ele === null ? "" : `${Math.round(ele)} m`
    const grade = course.gradeAt(state.s)
    $("hud-grade").textContent = grade === null ? "" : formatGrade(grade)
    $("hud-date").textContent = state.imageDate ? `Imagery ${formatImageDate(state.imageDate)}` : ""

    $("off-course").hidden = state.offCourse === null
    if (state.offCourse !== null) {
      $("off-course-distance").textContent = `${Math.round(state.offCourse)} m`
    }
    const noImagery = $("no-imagery")
    noImagery.hidden = state.noImagery === null
    noImagery.textContent =
      state.noImagery === "here"
        ? "No Street View within 50 m of this point."
        : "No Street View for the next kilometre. Drag along the profile to skip ahead."

    const play = $("play")
    play.classList.toggle("playing", state.playing)
    play.setAttribute("aria-label", state.playing ? "Pause" : "Play")

    profile.setPosition(state.s)
    const panoPosition = pano.getPosition()
    const you =
      state.offCourse !== null && panoPosition ? toLatLng(panoPosition) : course.pointAt(state.s)
    courseMap.setYou(you, pano.getPov().heading ?? 0)
    savePosition(state.s)
  }

  const applySpeed = () => {
    const s = SPEEDS[speed.index] ?? NORMAL_SPEED
    $("speed").textContent = s.label
    return s.interval
  }
  applySpeed()

  const scrub = throttle((s: number) => void rider().goTo(s), 250)
  const profile = new Profile($("profile"), {
    onScrub(s) {
      rider().pause()
      scrub(s)
    },
    onCommit(s) {
      scrub.cancel()
      void rider().goTo(s)
    },
  })

  const loadCourse = async (name: string | null, points: CoursePoint[], s = 0) => {
    // Parsed before anything billable is built, so a broken file costs nothing.
    const next = new Course(points)
    const { service, courseMap, rider } = viewer()
    rider.interval = applySpeed()
    course = next
    $("course-name").textContent = name ?? "Untitled course"
    document.title = name ? `${name} · Course Street View` : "Course Street View"
    courseMap.setCourse(next)
    profile.setCourse(next)
    cancelScan()
    cancelScan = scanCoverage(next, service, (gaps) => {
      courseMap.setGaps(gaps)
      profile.setGaps(gaps)
    })
    $("empty").hidden = true
    $("hud").hidden = false
    $("controls").hidden = false
    await rider.setCourse(next, s)
  }

  const openFile = async (file: File) => {
    try {
      const gpx = parseGpx(await file.text())
      const name = gpx.name ?? file.name.replace(/\.gpx$/i, "")
      await loadCourse(name, gpx.points)
      const saved: SavedCourse = {
        name,
        points: gpx.points.map((p) => [
          Math.round(p.lat * 1e6) / 1e6,
          Math.round(p.lng * 1e6) / 1e6,
          p.ele === null ? null : Math.round(p.ele * 10) / 10,
        ]),
      }
      save(COURSE_KEY, saved)
    } catch (e) {
      toast(`Could not open ${file.name}: ${(e as Error).message}`)
    }
  }

  // Opening files: picker, and drag-and-drop anywhere on the page.
  const fileInput = $<HTMLInputElement>("file")
  for (const id of ["open-gpx", "choose-gpx"]) {
    $(id).addEventListener("click", () => fileInput.click())
  }
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0]
    if (file) void openFile(file)
    fileInput.value = ""
  })
  const drop = $("drop")
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    drop.hidden = false
  })
  window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) drop.hidden = true
  })
  window.addEventListener("drop", (e) => {
    e.preventDefault()
    drop.hidden = true
    const file = e.dataTransfer?.files[0]
    if (file) void openFile(file)
  })

  // Ride controls.
  const step = async (dir: 1 | -1) => {
    rider().pause()
    const result = await rider().step(dir)
    if (result === "end") toast(dir > 0 ? "That's the finish." : "That's the start.")
  }
  const togglePlay = () => {
    if (rider().current.playing) rider().pause()
    else rider().play()
  }
  $("step-forward").addEventListener("click", () => void step(1))
  $("step-back").addEventListener("click", () => void step(-1))
  $("play").addEventListener("click", togglePlay)
  $("speed").addEventListener("click", () => {
    speed.index = (speed.index + 1) % SPEEDS.length
    save(SPEED_KEY, speed.index)
    rider().interval = applySpeed()
  })
  $("back-to-course").addEventListener("click", () => void rider().goTo(rider().current.s))

  document.addEventListener("keydown", (e) => {
    if (!course || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.closest("input, textarea, dialog")) return
    // Space on a focused button already clicks it.
    if (e.key === " " && !target.closest("button")) {
      e.preventDefault()
      togglePlay()
    } else if (e.key === ".") void step(1)
    else if (e.key === ",") void step(-1)
  })

  const saved = load<SavedCourse>(COURSE_KEY)
  if (saved?.points?.length) {
    try {
      const points = saved.points.map(([lat, lng, ele]) => ({ lat, lng, ele }))
      await loadCourse(saved.name, points, load<number>(POSITION_KEY) ?? 0)
      return
    } catch {
      save(COURSE_KEY, null)
    }
  }
  $("empty").hidden = false
}

void main()
