import type { Course } from "./course.ts"
import type { Gap } from "./coverage.ts"
import type { LatLng } from "./geo.ts"

interface HtmlMarker {
  setPosition(p: LatLng | null): void
}

/**
 * An HTML element pinned to a map position. Built on OverlayView, which needs
 * no Map ID, unlike AdvancedMarkerElement, and isn't deprecated, unlike Marker.
 */
function htmlMarker(map: google.maps.Map, el: HTMLElement): HtmlMarker {
  const overlay = new google.maps.OverlayView()
  let position: google.maps.LatLng | null = null
  el.classList.add("map-marker")
  overlay.onAdd = () => overlay.getPanes()?.overlayLayer.append(el)
  overlay.onRemove = () => el.remove()
  overlay.draw = () => {
    const point = position && overlay.getProjection()?.fromLatLngToDivPixel(position)
    el.hidden = !point
    if (point) el.style.transform = `translate(${point.x}px, ${point.y}px)`
  }
  overlay.setMap(map)
  return {
    setPosition(p) {
      position = p ? new google.maps.LatLng(p) : null
      overlay.draw()
    },
  }
}

function markerElement(className: string, html = ""): HTMLElement {
  const el = document.createElement("div")
  el.innerHTML = `<div class="${className}">${html}</div>`
  return el
}

const COURSE_COLOR = "#fc4c02"
const GAP_COLOR = "#8a8f98"

export class CourseMap {
  readonly map: google.maps.Map
  private readonly casing: google.maps.Polyline
  private readonly line: google.maps.Polyline
  // An invisible wide line over the course, so it is easy to tap on a phone.
  private readonly hitLine: google.maps.Polyline
  private gapLines: google.maps.Polyline[] = []
  private readonly start: HtmlMarker
  private readonly finish: HtmlMarker
  private readonly you: HtmlMarker
  private readonly youArrow: SVGElement
  private course: Course | null = null

  constructor(el: HTMLElement, onPick: (p: LatLng) => void) {
    this.map = new google.maps.Map(el, {
      center: { lat: 0, lng: 0 },
      zoom: 2,
      // Not linked to the panorama: Google would draw its own position marker
      // beside ours. Tapping the course does what dragging the pegman would.
      streetViewControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
      fullscreenControl: false,
      mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU },
    })
    this.casing = new google.maps.Polyline({
      map: this.map,
      strokeColor: "#ffffff",
      strokeWeight: 7,
      strokeOpacity: 0.9,
      clickable: false,
      zIndex: 1,
    })
    this.line = new google.maps.Polyline({
      map: this.map,
      strokeColor: COURSE_COLOR,
      strokeWeight: 4,
      clickable: false,
      zIndex: 2,
    })
    this.hitLine = new google.maps.Polyline({
      map: this.map,
      strokeOpacity: 0,
      strokeWeight: 24,
      zIndex: 4,
    })
    this.hitLine.addListener("click", (e: google.maps.PolyMouseEvent) => {
      if (e.latLng) onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })
    })
    this.start = htmlMarker(this.map, markerElement("marker-end marker-start", "S"))
    this.finish = htmlMarker(this.map, markerElement("marker-end marker-finish", "F"))
    const youEl = markerElement(
      "marker-you",
      `<svg viewBox="-20 -20 40 40" aria-hidden="true"><path class="cone" d="M0 0 L-11 -18 A21 21 0 0 1 11 -18 Z"/><circle r="6"/></svg>`,
    )
    this.youArrow = youEl.querySelector("svg")!
    this.you = htmlMarker(this.map, youEl)
  }

  setCourse(course: Course): void {
    this.course = course
    const path = course.points.map((p) => ({ lat: p.lat, lng: p.lng }))
    this.casing.setPath(path)
    this.line.setPath(path)
    this.hitLine.setPath(path)
    this.setGaps([])
    this.start.setPosition(course.points[0]!)
    this.finish.setPosition(course.points[course.points.length - 1]!)
    const bounds = new google.maps.LatLngBounds()
    for (const p of path) bounds.extend(p)
    this.map.fitBounds(bounds, 24)
  }

  setGaps(gaps: Gap[]): void {
    for (const line of this.gapLines) line.setMap(null)
    const course = this.course
    if (!course) return
    this.gapLines = gaps.map(
      ([from, to]) =>
        new google.maps.Polyline({
          map: this.map,
          path: course.between(from, to),
          strokeColor: GAP_COLOR,
          strokeWeight: 4,
          clickable: false,
          zIndex: 3,
        }),
    )
  }

  /** Where the viewer stands and which way they look; pans to keep them in view. */
  setYou(position: LatLng, heading: number): void {
    this.you.setPosition(position)
    this.youArrow.style.transform = `rotate(${heading}deg)`
    const bounds = this.map.getBounds()
    if (bounds && !shrink(bounds, 0.15).contains(position)) this.map.panTo(position)
  }

  setHeading(heading: number): void {
    this.youArrow.style.transform = `rotate(${heading}deg)`
  }
}

/** `bounds` with `fraction` of its span trimmed off each side. */
function shrink(bounds: google.maps.LatLngBounds, fraction: number): google.maps.LatLngBounds {
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  const dLat = (ne.lat() - sw.lat()) * fraction
  const dLng = (ne.lng() - sw.lng()) * fraction
  return new google.maps.LatLngBounds(
    { lat: sw.lat() + dLat, lng: sw.lng() + dLng },
    { lat: ne.lat() - dLat, lng: ne.lng() - dLng },
  )
}
