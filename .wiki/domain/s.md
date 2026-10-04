---
type: Glossary Term
title: s (position along the course)
description: Metres travelled along the course from its start — the one position every control reads and writes. Not a map coordinate, and not unique to a place.
tags: [domain, geometry]
---

**`s`** is distance along the course, in metres, from the start of the GPX
track. Slider, step buttons, play, map taps and the HUD all speak in `s`;
latitude/longitude appears only at the edges, where Street View or the map
hands a point in or takes one out.

A place on the map can correspond to **several** values of `s` — an
out-and-back passes every point twice, a lap course once per lap. Turning a
point back into `s` therefore needs context (where the rider was, which way
they were going), which is what [Course](/architecture/course.md) `locate`
supplies.

When the rider wanders off the course in Street View, `s` stays at the nearest
course position and the distance off course is reported alongside it, rather
than `s` becoming undefined.
