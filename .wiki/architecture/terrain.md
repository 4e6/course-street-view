---
type: Module
title: Terrain elevation
description: Optional elevation from a terrain model (SRTM where possible, else EU-DEM), smoothed along the road, chosen in Settings. Feeds only the profile and the HUD elevation and grade; the course geometry stays the GPX's.
tags: [elevation, gradient, terrain]
sources:
  - resource: src/terrain.ts
  - resource: src/main.ts
sources_digest: fbfdc668e6ffb711
---

# Responsibility

Turns a course's points into the same points densified to at most 10 m apart,
each with an elevation sampled from a terrain model
([AWS Terrain Tiles](/integrations/aws-terrain-tiles.md)) and then smoothed
along the road, so a [Course](/architecture/course.md) built from them can
stand in for the GPX's elevation. It decodes the tiles itself and knows
nothing of the page.

**One model per course.** The SRTM-era tiles are tried first and used only if
every tile the course needs says it is built from SRTM alone (a missing or
empty source header fails the check). Otherwise, or if any of those tiles fails
to load, the whole course is loaded again from the default tiles. A source
change inside a course would be an elevation step that the grade turns into a
spike. A load the user cancelled never falls back.

**Smoothing** is a Gaussian over distance along the course (not over point
index: the spacing is uneven), cut off at three standard deviations, with the
ends padded by point reflection so a straight slope stays straight there.
Standard deviation 35 m for SRTM; 60 m for the default tiles, but only when
they are EU-DEM, since national high-resolution models (LiDAR-class) are
better left as they are. The grade window stays 100 m, shared with GPX mode.
The status line under the Settings choice names the model used.

**Boundary:** only the elevation `Course` is replaced. Street View
([Rider](/architecture/rider.md)), the map, the coverage scan and map-tap matching keep
the GPX course, so switching the source never moves the rider, re-finds a
panorama or forgets the coverage gaps. The densified points lie on the original
segments, so [s](/domain/s.md) means the same distance in both.

The choice is a global preference (default: the GPX). A course always opens
with the GPX elevation first and swaps when the terrain has loaded. A newer
file or a newer choice cancels a load still in progress. In Settings the
choice applies the moment it is picked, with no Save.

# Why

The choice is instant while the API key beside it has a button of its own,
because a new key needs a page reload, which is a new billed Maps load. A
dialog-wide Save/Cancel pair read as covering both and confused users.

Elevation exported with a course can be smoothed until real features are gone.
On Estrada do Atalho near Vermelha, PT, the Garmin Connect course export climbs
steadily through a 5–10 m dip the rider can see in Street View. EU-DEM and SRTM
both show the dip. No gradient window can show a descent that is not in the
data, so the fix has to be a different source. That still holds against the
GPX; but the choice _between_ terrain models matters as well.

**Raw terrain gave false descents.** EU-DEM, the default model in Europe, has
about 2 m of vertical noise at the 25 m scale. A 100 m grade differences two
elevations, so that noise reads as several percent: on a Portuguese course
(EN 115 near Vermelha) the grade fell to about -2 % where the road climbs, at
about km 38.25, and to about -6 % at about km 39.2. SRTM disagrees less with
an independent model (Copernicus) and needs about half the smoothing for the
same retention of a real dip; smoothing removes the rest. The widths, 35 and
60 m, are the smallest that turned the false descents into climbs while
keeping most of the one real dip on that course. Smoothing alone clears km
38.25 on EU-DEM, but km 39.2 needs the SRTM data: EU-DEM only turns positive
there at a width near 100 m, which flattens the real dip.

Tiles are decoded from the PNG bytes in JavaScript, not through a canvas.
Canvas readback is deliberately noised by fingerprinting protection (Brave,
Firefox `resistFingerprinting`, Safari Private Browsing), which would turn into
random elevation noise, and colour management could alter the bytes.

# Rejected alternatives

- **Google Elevation API** — not enabled on the project's key, billed per
  request, and a spend decision for whoever owns the key.
- **OpenTopoData's public API** — shared limits of 1 request/s and 1,000/day;
  fine for an investigation, not for an app.
- **Sampling only at the GPX's own points** — route-planner files can have
  hundreds of metres between points, which loses the detail this exists for.
- **Skadi** (the raw SRTM 1 arc-second files in the same bucket) — pure SRTM,
  but about 15 MB of gzip for an 80 km course, with no range access, and it
  needs `DecompressionStream`; the `v2` terrarium tiles carry the same data at
  about 25 KB a tile.
- **Blending two models, or switching where they disagree** — worse than SRTM
  alone: EU-DEM's deep false dips drag the mean negative.
- **Copernicus GLO-30** — no CORS, and a surface model with trees in it.
- **Open-Meteo's elevation API** — 90 m, whole metres.
- **A longer grade window** — the 160 m or so needed is shared with GPX mode
  and still leaves 1 m steps in the data.
- **Sampling beside the road** (lateral offsets, minima, medians) — the
  GPX matches OpenStreetMap to about 1 m, and parallel lines up to 30 m aside
  fall just as the road does: the dip is a feature of the model.

# Limits

Terrain models are not the road: features can sit 25–50 m from where they are,
bridges, tunnels and cuttings come out wrong, and some cells include buildings
or trees. That is why it is an option and not the default.

- **Smoothing softens real dips.** The one real dip tested (Vermelha) is 5.9 m
  deep in the raw SRTM and 4.5 m after smoothing, about three quarters;
  shorter dips lose more.
- **SRTM has its own errors.** At about km 49.34 of that course it has a 12 m
  bump the other models lack, giving a false +7.7 % climb in a descent, and it
  overshoots to about +10 % near km 74.97, where Copernicus has the bump instead.
  No model is right everywhere.
- **Unfixable by any model:** a cutting or bridge at about km 50.85–51.0 puts a
  hump in every terrain model while the GPX descends steadily.
- **The gate rejects many European courses.** The `v2` tiles _can_ be SRTM
  where the default ones are EU-DEM, but not everywhere; near Nice they are
  mixed (`srtm` plus `eudem`). Coastal, mixed and northern tiles fail it and fall back to EU-DEM, where the false
  descents are only damped (60 m), not cured.
- **Provisional numbers.** 35 and 60 m were tuned on one Portuguese course,
  against one real dip; treat them as evidence-level, not as a measured optimum.
