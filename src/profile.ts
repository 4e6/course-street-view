import { defined } from "./assert.ts"
import type { Course } from "./course.ts"
import type { Gap } from "./coverage.ts"
import { formatDistance } from "./format.ts"

export interface ProfileHandlers {
  /** Called continuously while dragging. */
  onScrub(s: number): void
  /** Called once when the drag, tap or key press ends. */
  onCommit(s: number): void
}

const PAD_TOP = 16
const PAD_BOTTOM = 6
const GAP_BAND = 4
const KEY_STEP = 100

/**
 * The elevation profile, which doubles as the slider: drag or tap anywhere on
 * it to move along the course. Courses without elevation get a flat bar that
 * works the same way.
 */
export class Profile {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private course: Course | null = null
  private s = 0
  private hover: number | null = null
  private gaps: Gap[] = []
  private dragging = false
  // Elevation per CSS pixel column, rebuilt on resize or a new course.
  private columns: (number | null)[] = []
  private range: [number, number] = [0, 1]

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: ProfileHandlers,
  ) {
    this.canvas = document.createElement("canvas")
    el.append(this.canvas)
    this.ctx = defined(this.canvas.getContext("2d"), "a 2D canvas context")
    new ResizeObserver(() => this.resize()).observe(el)

    el.addEventListener("pointerdown", (e) => {
      if (!this.course) return
      this.dragging = true
      el.setPointerCapture(e.pointerId)
      this.handlers.onScrub(this.sAt(e.clientX))
    })
    el.addEventListener("pointermove", (e) => {
      if (!this.course) return
      const s = this.sAt(e.clientX)
      if (this.dragging) this.handlers.onScrub(s)
      else if (e.pointerType === "mouse") {
        this.hover = s
        this.draw()
      }
    })
    const end = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      this.handlers.onCommit(this.sAt(e.clientX))
    }
    el.addEventListener("pointerup", end)
    el.addEventListener("pointercancel", end)
    el.addEventListener("pointerleave", () => {
      this.hover = null
      this.draw()
    })
    el.addEventListener("keydown", (e) => {
      if (!this.course) return
      const delta = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP, PageDown: -1000, PageUp: 1000 }[
        e.key
      ]
      const to =
        e.key === "Home" ? 0 : e.key === "End" ? this.course.length : delta && this.s + delta
      if (to === undefined) return
      e.preventDefault()
      this.handlers.onCommit(this.course.clamp(to))
    })
  }

  setCourse(course: Course): void {
    this.course = course
    this.gaps = []
    this.el.setAttribute("aria-valuemax", String(Math.round(course.length)))
    this.resize()
  }

  setPosition(s: number): void {
    this.s = s
    this.el.setAttribute("aria-valuenow", String(Math.round(s)))
    this.el.setAttribute("aria-valuetext", formatDistance(s))
    this.draw()
  }

  setGaps(gaps: Gap[]): void {
    this.gaps = gaps
    this.draw()
  }

  private sAt(clientX: number): number {
    const rect = this.el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return t * (this.course?.length ?? 0)
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const course = this.course
    const cols = Math.max(1, Math.round(width))
    this.columns = []
    if (course?.hasElevation) {
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      for (let x = 0; x < cols; x++) {
        const ele = course.elevationAt((x / Math.max(1, cols - 1)) * course.length)
        this.columns.push(ele)
        if (ele !== null) {
          lo = Math.min(lo, ele)
          hi = Math.max(hi, ele)
        }
      }
      // Keep at least 50 m of vertical range, so a flat course looks flat.
      const span = Math.max(50, hi - lo)
      this.range = [lo - span * 0.05, lo + span * 1.05]
    }
    this.draw()
  }

  private draw(): void {
    const { ctx } = this
    const width = this.canvas.width / (window.devicePixelRatio || 1)
    const height = this.canvas.height / (window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, width, height)
    const course = this.course
    if (!course) return

    const style = getComputedStyle(this.el)
    const color = (name: string) => style.getPropertyValue(name).trim()
    const xOf = (s: number) => (s / course.length) * width
    const plotBottom = height - PAD_BOTTOM - GAP_BAND
    const [lo, hi] = this.range
    const yOf = (ele: number) => plotBottom - ((ele - lo) / (hi - lo)) * (plotBottom - PAD_TOP)

    // Elevation, or a flat bar when there is none.
    ctx.beginPath()
    if (this.columns.length > 0) {
      ctx.moveTo(0, plotBottom)
      this.columns.forEach((ele, x) => {
        ctx.lineTo(x, ele === null ? plotBottom : yOf(ele))
      })
      ctx.lineTo(width, plotBottom)
    } else {
      ctx.rect(0, plotBottom - 10, width, 10)
    }
    ctx.closePath()
    ctx.fillStyle = color("--profile-fill")
    ctx.fill()
    if (this.columns.length > 0) {
      ctx.beginPath()
      this.columns.forEach((ele, x) => {
        const y = ele === null ? plotBottom : yOf(ele)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = color("--profile-line")
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Done so far, tinted.
    ctx.save()
    ctx.globalCompositeOperation = "source-atop"
    ctx.fillStyle = color("--profile-done")
    ctx.fillRect(0, 0, xOf(this.s), height)
    ctx.restore()

    // Coverage gaps, as a band under the plot.
    ctx.fillStyle = color("--gap")
    for (const [from, to] of this.gaps) {
      ctx.fillRect(xOf(from), plotBottom + 2, Math.max(2, xOf(to) - xOf(from)), GAP_BAND)
    }

    ctx.font = `11px ${style.fontFamily}`
    ctx.textBaseline = "top"
    ctx.fillStyle = color("--muted")
    if (this.columns.length > 0) {
      ctx.textAlign = "left"
      ctx.fillText(`${Math.round(hi - (hi - lo) * 0.05)} m`, 4, 2)
    }
    ctx.textAlign = "right"
    ctx.fillText(formatDistance(course.length), width - 4, 2)

    if (this.hover !== null) this.cursor(xOf(this.hover), color("--muted"), 1, height)
    this.cursor(xOf(this.s), color("--accent"), 2, height)
  }

  private cursor(x: number, color: string, lineWidth: number, height: number): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.moveTo(x, PAD_TOP - 4)
    ctx.lineTo(x, height - PAD_BOTTOM)
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
}
