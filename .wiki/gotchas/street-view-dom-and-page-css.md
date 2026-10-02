---
type: Gotcha
title: Page CSS and Google's Street View DOM collide both ways
description: A bare svg rule hides Street View's arrows, and Street View's own z-indexes cover overlays. Scope styles to the app and give the panorama container a stacking context.
tags: [street-view, css]
timestamp: 2026-10-02T11:05:28Z
---

# Symptoms

* **Street View shows no arrows** although the panorama has links and
  `linksControl` is on. Click-to-go still works, which makes it look like a
  Google setting.
* **HUD, buttons and banners vanish** over Street View though they are in the
  DOM, positioned and not hidden.

# Causes

* Google draws the arrows as inline SVG in the page's own DOM. A global
  `svg { fill: none; width: 20px; … }` meant for icon buttons styles them too,
  and they become invisible.
* The panorama's internal layers carry z-indexes. Without a stacking context on
  the panorama's container they compete with — and beat — sibling overlays.

# Fix

* Never style bare element selectors (`svg`, `canvas`, `img`, `div`) that
  also exist inside Google's widgets; scope to app classes.
* Give the panorama container its own stacking context (`z-index: 0` on a
  positioned element) and the overlays a higher one.

# Related

Google also draws the arrows **at the bottom centre** of the view, so app
controls must stay out of that area or they cover the back arrow. That is why
the ride buttons sit bottom-left.
