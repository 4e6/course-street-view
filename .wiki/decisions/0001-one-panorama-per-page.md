---
type: Decision
title: One Street View panorama per page, re-pointed with setPano
description: Create a single StreetViewPanorama per page load and move it with setPano, because Google bills per panorama object loaded rather than per image viewed.
status: accepted
tags: [street-view, billing]
timestamp: 2026-10-02T11:05:28Z
---

# Context

The app shows hundreds of Street View positions per course. Google Maps
Platform bills interactive Street View per **panorama load** — creating a
`StreetViewPanorama` — and states that moving within it is not billed. The
Static Street View API bills per image. Locating panoramas with
`StreetViewService` is free. See [Google Maps Platform](/integrations/google-maps-platform.md).

# Decision

Create exactly one `StreetViewPanorama` per page load and reuse it for every
position and every course, moving it with `setPano`.

# Alternatives considered

* **Static Street View images, one per step** — rejected: a 100 km course
  sampled every 20 m is ~5,000 images, the whole monthly free allowance in two
  rides. Also loses Google's arrows, which are the point of the app.
* **A new panorama object per position or per course** — rejected: each is a
  billable load, turning a free session into a paid one.

# Consequences

* A whole session costs one Dynamic Street View load plus one map load.
* Nothing may construct a second panorama, including for previews or a new
  GPX — the reuse is what the cost model rests on.
* The panorama fires the same event for the app's own moves and the rider's,
  so [Rider](/architecture/rider.md) has to tell them apart.
* Whether a *programmatic* `setPano` is free is Google's docs' implication, not
  something verified — see [the open question](/questions/is-programmatic-setpano-billed.md).

> **Note, 2026-10-02.** "Per page load" and "a whole session" above now mean a
> page load that opens a course: the panorama and the map are created on the
> first course rather than on arrival, so a session that never opens one costs
> nothing. The decision itself — one panorama, re-pointed — is unchanged.
> Current cost model: [Google Maps Platform](/integrations/google-maps-platform.md).

# Citations

[1] [Google Maps Platform SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)
[2] [Street View Service](https://developers.google.com/maps/documentation/javascript/streetview)
