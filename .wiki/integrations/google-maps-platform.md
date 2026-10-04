---
type: Integration
title: Google Maps Platform
description: How the app is billed, capped and protected by Google — what costs money, what is free, the GCP project behind the key, and the quirks of Street View lookups found in testing.
tags: [google, billing, street-view, api-key]
sources:
  - id: sku-details
    resource: https://developers.google.com/maps/billing-and-pricing/sku-details
    title: Google Maps Platform SKU details
  - id: usage-and-billing
    resource: https://developers.google.com/maps/documentation/javascript/usage-and-billing
    title: Maps JavaScript API usage and billing
  - id: street-view-service
    resource: https://developers.google.com/maps/documentation/javascript/streetview
    title: Street View Service
  - id: service-terms
    resource: https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240422
    title: Google Maps Platform Service Specific Terms
---

# What costs money

| Event | Counted as | Free per month | After that |
|---|---|---|---|
| Creating a `google.maps.Map` | Dynamic Maps load | 10,000 | ~$7 / 1,000 |
| Creating a `StreetViewPanorama` | Dynamic Street View load | 5,000 | ~$14 / 1,000 |
| Each image from the Street View **Static** API | Static Street View | 10,000 | ~$7 / 1,000 |

Prices and allowances per Google's SKU list.[^sku-details]

Interactive Street View is billed **per panorama object**, not per image
shown.[^usage-and-billing] Each *new* panorama object is another load; the same object showing a
thousand positions is one. Measured: the load is counted when the object shows
its **first panorama** — constructing a hidden one that shows nothing counted
0. The app
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
  zooming — per Google's docs.[^street-view-service]
* Moving it **from code** with `setPano` — measured: five course switches, each
  moving the panorama to new imagery, counted 0 against the billable quota.
  See [the question that asked](/questions/is-programmatic-setpano-billed.md).

# Cap and alerts — and what they do not cover

* **Quota:** "Map loads" per day is overridden to **600**. Lowering a quota
  that far needs `force=true`; Google refuses a decrease of more than 10%
  without it.
* **"Map loads" counts Street View too.** There is no separate Street View
  quota; a panorama's load is counted against "Map loads" and reported under
  the same name as a map's (method `loadMap`, `google.maps.BaseMap.Javascript`,
  quota metric `billable_default`). Measured minute by minute: a map counted 1,
  a panorama showing imagery counted 1, and a page load that opens a course
  counted 2. So the cap limits both, at about **300 sessions that open a
  course** per day.
* **Budget alert:** "Course Street View EUR 1" on the billing account,
  filtered to this project: e-mails at 50% and 100% of actual spend and 100% of
  forecast. It alerts; it does not stop anything. The billing account is in
  EUR, so budgets must be too.

# Measuring usage

Cloud Monitoring's `serviceruntime.googleapis.com/api/request_count` and
`quota/rate/net_usage` for `maps-backend.googleapis.com` show loads within a
few minutes. Read them **per minute, from raw points**: an aggregation with a
long alignment period (say an hour) fills its first bucket from before the
requested start time, so "since 12:33" silently includes the hour before.
Every origin sharing the key — localhost and the live site — lands in the same
numbers, so a measurement needs nobody else using the app.

# Terms that shape the app

* **No Street View beside a non-Google map.** The service terms[^service-terms] forbid
  showing Street View imagery and a non-Google map on the same screen, which rules out
  a free Leaflet/OpenStreetMap course map. The map is Google's.

# The project behind the key

* GCP project `course-street-view`, on the "Caixa Billing Account".
* Key "Course Street View (web)": referrers `https://4e6.github.io/*` and
  `http://localhost:5173/*`; API restricted to the Maps JavaScript API
  (`maps-backend.googleapis.com`). Local development reads it from
  `.env` (git-ignored); deployment from the `GOOGLE_MAPS_API_KEY` repository secret.
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

[^sku-details]: [Google Maps Platform SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)
[^usage-and-billing]: [Maps JavaScript API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
[^street-view-service]: [Street View Service](https://developers.google.com/maps/documentation/javascript/streetview)
[^service-terms]: [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240422)
