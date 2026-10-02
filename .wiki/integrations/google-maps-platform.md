---
type: Integration
title: Google Maps Platform
description: How the app is billed, capped and protected by Google — what costs money, what is free, the GCP project behind the key, and the quirks of Street View lookups found in testing.
tags: [google, billing, street-view, api-key]
timestamp: 2026-10-02T12:31:45Z
---

# What costs money

| Event | Counted as | Free per month | After that |
|---|---|---|---|
| Creating a `google.maps.Map` | Dynamic Maps load | 10,000 | ~$7 / 1,000 |
| Creating a `StreetViewPanorama` | Dynamic Street View load | 5,000 | ~$14 / 1,000 |
| Each image from the Street View **Static** API | Static Street View | 10,000 | ~$7 / 1,000 |

Interactive Street View is billed **per panorama object**, not per image
shown: the billable event is instantiating it. Each *new* panorama object is
another load; the same object showing a thousand positions is one. The app
creates one map and one panorama per page load **that opens a course** —
chosen, or restored from the last visit — and reuses them for every course
after. So **a session that opens a course is the unit of cost**, and a
visitor who leaves the "choose a GPX" screen without opening one costs
nothing: the Maps script loads, but loading it is not billed. See
[one panorama per page](/decisions/0001-one-panorama-per-page.md).
The Static API, by contrast, bills every frame: a 100 km course at one image
per 20 m is ~5,000 images.

**Free:**

* `StreetViewService.getPanorama` — by location or by panorama id. Stepping,
  coverage scanning and imagery dates are all built on it.
* Moving within a panorama **as a user** — arrows, click-to-go, panning,
  zooming — per Google's docs.
* Whether moving it **from code** (`setPano`) is also free is implied rather
  than documented, and unverified: see
  [the open question](/questions/is-programmatic-setpano-billed.md).

# Cap and alerts — and what they do not cover

* **Quota:** "Map loads" per day is overridden to **600** (about 300 page
  loads). Lowering a quota that far needs `force=true`; Google refuses a
  decrease of more than 10% without it.
* **Street View has no quota.** The Maps JavaScript API exposes only
  "Map loads", "3D Map loads" and a grounding-widget quota. Cloud Monitoring
  for the project showed only map loads (method `loadMap`,
  `google.maps.BaseMap.Javascript`) — no Street View at all. So the daily cap
  does not limit Street View spend, and if the map's quota is exhausted the
  panorama is still created.
* **Budget alert:** "Course Street View EUR 1" on the billing account,
  filtered to this project: e-mails at 50% and 100% of actual spend and 100% of
  forecast. It alerts; it does not stop anything. The billing account is in
  EUR, so budgets must be too.

# Terms that shape the app

* **No Street View beside a non-Google map.** The service terms forbid showing
  Street View imagery and a non-Google map on the same screen, which rules out
  a free Leaflet/OpenStreetMap course map. The map is Google's.

# The project behind the key

* GCP project `course-street-view`, on the "Caixa Billing Account".
* Key "Course Street View (web)": referrers `https://4e6.github.io/*` and
  `http://localhost:5173/*`; API restricted to the Maps JavaScript API
  (`maps-backend.googleapis.com`). Local development reads it from
  `.env.local`; deployment from the `GOOGLE_MAPS_API_KEY` repository secret.
* A new origin (another dev port, a custom domain) must be added to the
  referrers or Google rejects the key on that page.

# Street View lookup quirks

* **Sources matter.** Without `sources`, or with `OUTDOOR` alone,
  `getPanorama` happily returns user-uploaded photo spheres: third-party
  copyright, no arrows, often years old. Including `GOOGLE` restricts it to
  official imagery.
* **Nearest is not continuous.** Adjacent nearest-panoramas often come from
  different capture years, and a walking capture beside a road can be nearer
  than the road itself. See
  [the gotcha](/gotchas/nearest-panorama-is-not-continuous.md).
* **Arrows can cross years too** — a link sometimes leads into an older capture.
* **A map linked to a panorama draws its own marker.** Setting the map's
  `streetView` to the app's panorama makes Google draw a position marker
  beside the app's own, so the map is deliberately left unlinked. The cost is
  pegman drag-and-drop on the map; tapping the course line does the same job.
* **The imagery date comes only from a lookup.** The panorama object does not
  expose it; looking the panorama up by id (free) does.

# Citations

[1] [Google Maps Platform SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)
[2] [Maps JavaScript API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
[3] [Street View Service](https://developers.google.com/maps/documentation/javascript/streetview)
[4] [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240422)
