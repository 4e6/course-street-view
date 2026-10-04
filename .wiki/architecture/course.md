---
type: Module
title: Course
description: The course as geometry — distance along it, points, headings, gradient, and matching an arbitrary point back to a position s. Pure TypeScript, no Google, fully unit-tested.
tags: [geometry, gpx]
sources:
  - resource: src/course.ts
  - resource: src/geo.ts
  - resource: src/gpx.ts
sources_digest: 1fe5cd2a22a6b23c
---

# Responsibility

Owns everything that can be answered from the GPX alone: converting between
[s](/domain/s.md) and points, the heading to look along at a position,
elevation and gradient, and cutting stretches out for drawing. Also parses GPX.

Does **not** know Street View or the map exists. That boundary is what lets the
hardest logic in the app run under `bun test` with no browser and no API key.

# Matching a point to the course

`locate` is the subtle part. A course that uses a road twice has two equally
good answers for one point, and picking the merely-closer one teleports the
rider to the other leg. So it:

* searches a window around the current `s` first (a little behind, more
  ahead), and widens to the whole course only when nothing in the window is
  close — the window is what separates the two legs of an out-and-back or two
  laps;
* penalises segments that face against the direction of travel, which settles
  the case the window cannot: near a turnaround both legs are inside it;
* adds a slight preference for staying near the current `s`, to break exact
  ties between passes.

The penalties are in metres, so they trade off directly against distance. The
tests cover out-and-back, laps, the turnaround, and the fallback.

# GPX parsing

Done with patterns rather than `DOMParser`, so it runs in tests without a DOM.
GPX is regular enough for this. Track points win over route points when a file
has both; segments and tracks are concatenated in file order.

# Used by

* [Rider](/architecture/rider.md) — every Street View move goes through `locate`.
* The map and profile, for drawing and for turning taps into `s`.
