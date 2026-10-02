---
type: Module
title: Rider
description: Keeps the one Street View panorama and the position s in step, whichever way a move started — slider, step, play, map tap, or Google's own arrows. Owns stepping, play and off-course detection.
tags: [street-view, navigation]
timestamp: 2026-10-02T12:10:56Z
sources: [src/rider.ts, src/main.ts, tests/fake-street-view.ts]
source_commit: f0cd6cc9beaf7f57e8d5ef27012b57531af751ae
---

# Responsibility

The only code that moves the Street View panorama. Every input — the profile
slider, step buttons, play, a map tap, "Back to course" — becomes a request to
Rider, and every move made *inside* Street View (Google's arrows, click-to-go)
arrives back at Rider through the panorama's position change. Rider resolves
both into one state: [s](/domain/s.md), distance off course, imagery date, and
whether there is imagery at all. The UI only renders that state.

Does **not** own geometry (that is [Course](/architecture/course.md)) or any
drawing.

# Two directions, one state

* **App → Street View:** turn `s` into a point, find a panorama, show it facing
  along the course. A *step* follows Street View's arrows rather than the
  nearest panorama — why is
  [the nearest panorama is not continuous](/gotchas/nearest-panorama-is-not-continuous.md).
* **Street View → app:** project the new position onto the course with the
  rider's previous position as context, then flag off-course when it lands too
  far from the line.

Rider must tell these apart, because its own `setPano` also fires the position
event. It remembers the panorama it last asked for; a position change to any
other panorama was the rider's doing.

Every move invalidates in-flight lookups from earlier moves, so a slow lookup
for a slider position the user has already dragged past never lands.

# Testing

Rider runs in tests against a fake Street View: panoramas with positions,
capture dates and arrow links, a lookup service, and a viewer that fires
`position_changed` asynchronously after `setPano`, as Google's does. Lookups
can be slowed per request (to test overtaken moves) or made to fail like a
quota error.

The suite was checked by breaking Rider deliberately — dropping the
same-capture preference, the minimum step, the own-move check, the overtaken-
lookup check, off-course detection, the position window — and confirming a
test fails for each. Keep that property when adding behaviour.

What the fake does **not** model, so tests cannot vouch for it: rendering
(arrows, the view), Google's real link quirks and capture data, and billing.
Those are checked by hand in a visible browser window — see
[hidden tabs](/gotchas/hidden-tab-street-view.md).

# Decisions

* [One panorama per page](/decisions/0001-one-panorama-per-page.md) — why
  Rider re-points a single panorama and never creates another.

# Gotchas

* [The nearest panorama is not the next one along the road](/gotchas/nearest-panorama-is-not-continuous.md)
* [Page CSS and Google's Street View DOM collide](/gotchas/street-view-dom-and-page-css.md)
* [Hidden tabs do not render Street View](/gotchas/hidden-tab-street-view.md)
