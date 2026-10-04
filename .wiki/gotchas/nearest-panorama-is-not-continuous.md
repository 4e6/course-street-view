---
type: Gotcha
title: The nearest Street View panorama is not the next one along the road
description: Stepping by "nearest panorama" flickers between capture years and drifts onto footpaths beside the road. Follow the current panorama's arrows instead, and search only as a fallback.
tags: [street-view, navigation]
---

# Symptom

Stepping along a course by looking up the panorama nearest to a point a little
further on:

* **Imagery jumps between years** on consecutive steps — tested on the
  Champs-Élysées it went 2026 → 2023 → 2021 → 2008.
* **Steps barely move.** A Google walking capture on a park path beside the
  road was nearer than the road, and its panoramas are ~3 m apart.

Clicking Google's own arrows on the same road does neither.

# Cause

`getPanorama` by location returns whichever panorama is closest, from any
capture run. Street View keeps many runs of the same road from different years,
plus walking captures of nearby paths. An arrow (panorama link) instead leads
to the next panorama of the same drive — though occasionally an arrow, too,
crosses into another year.

# Fix

What [Rider](/architecture/rider.md)'s step does:

1. Follow the current panorama's arrow that points along the course, ranking
   arrows into another capture year below same-capture ones unless they are
   clearly better aligned.
2. Chain through several arrows until the step has covered a minimum distance,
   so ~3 m walking captures still move at a steady pace.
3. Only when no arrow leads along the course, search by location at growing
   offsets ahead — which is also how coverage gaps get skipped. Arrows alone
   cannot cross a gap or continue where a capture run ends.

Lookups by panorama id are free and are cached per course, since arrows lead
back and forth between the same few panoramas.

# Still visible

A jump that does not start from a panorama on the course — the slider, a map
tap, "Back to course" — still has to use the nearest search, so the first step
after one can briefly show another year before the arrows take over.
