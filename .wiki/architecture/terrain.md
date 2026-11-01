---
type: Module
title: Terrain elevation
description: Optional elevation from a terrain model instead of the GPX file, chosen in Settings. Feeds only the profile and the HUD elevation and grade; the course geometry always stays the GPX's.
tags: [elevation, gradient, terrain]
sources:
  - resource: src/terrain.ts
  - resource: src/main.ts
sources_digest: a143a9584a52f678
---

# Responsibility

Turns a course's points into the same points densified to at most 10 m apart,
each with an elevation sampled from a terrain model
([AWS Terrain Tiles](/integrations/aws-terrain-tiles.md)), so a
[Course](/architecture/course.md) built from them can stand in for the GPX's
elevation. It decodes the tiles itself and knows nothing of the page.

**Boundary:** only the elevation `Course` is replaced. Street View
([Rider](/architecture/rider.md)), the map, the coverage scan and map-tap matching keep
the GPX course, so switching the source never moves the rider, re-finds a
panorama or forgets the coverage gaps. The densified points lie on the original
segments, so [s](/domain/s.md) means the same distance in both.

The choice is a global preference (default: the GPX). A course always opens
with the GPX elevation first and swaps when the terrain has loaded. A newer
file or a newer choice cancels a load still in progress.

# Why

Elevation exported with a course can be smoothed until real features are gone.
On Estrada do Atalho near Vermelha, PT, the Garmin Connect course export climbs
steadily through a 5–10 m dip the rider can see in Street View. EU-DEM and SRTM
both show the dip. No gradient window can show a descent that is not in the
data, so the fix has to be a different source.

Tiles are decoded from the PNG bytes in JavaScript, not through a canvas.
Canvas readback is deliberately noised by fingerprinting protection (Brave,
Firefox `resistFingerprinting`, Safari Private Browsing), which would turn into
random elevation noise, and colour management could alter the bytes.

# Rejected alternatives

* **Google Elevation API** — not enabled on the project's key, billed per
  request, and a spend decision for whoever owns the key.
* **OpenTopoData's public API** — shared limits of 1 request/s and 1,000/day;
  fine for an investigation, not for an app.
* **Sampling only at the GPX's own points** — route-planner files can have
  hundreds of metres between points, which loses the detail this exists for.

# Limits

Terrain models are not the road: features can sit 25–50 m from where they are,
bridges, tunnels and cuttings come out wrong, and some cells include buildings
or trees. That is why it is an option and not the default.
