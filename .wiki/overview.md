---
type: Overview
title: Course Street View
description: Ride a GPX course in Google Street View, with the course map and an elevation-profile slider below. A static site with no backend, meant for GitHub Pages.
tags: [overview]
---

# What it is

A road cyclist's preview tool: open a GPX course and see what the roads look
like before riding them. Street View fills the top of the screen; a Google map
with the course and an elevation profile (which doubles as the slider) fill the
bottom.

It exists because the tools that do this let you move only by dragging a
slider. Here the rider can also move the way Street View itself allows —
Google's arrows and click-to-go — and the app keeps track of where on the
course that leaves them.

# Shape

* **Client only.** The GPX never leaves the browser; there is no server and no
  storage beyond the visitor's own `localStorage`. The Maps key therefore ships
  in the page, protected by its restrictions rather than secrecy — see
  [Google Maps Platform](/integrations/google-maps-platform.md).
* **One idea at the centre:** a single position, [s](/domain/s.md), that every
  control reads and writes. [Rider](/architecture/rider.md) keeps Street View
  and `s` in step; [Course](/architecture/course.md) turns points into `s` and
  back.
* **Google Maps Platform is the only dependency that costs money**, and the
  design is bent around its billing model. See
  [Google Maps Platform](/integrations/google-maps-platform.md) and
  [one panorama per page](/decisions/0001-one-panorama-per-page.md).
* **Google's terms also shape the screen:** the course map has to be a Google
  map, because Street View may not share a screen with any other.

# Audience and scale

Built for its author and friends. Every cost decision assumes personal-scale
traffic that stays inside Google's monthly free allowance.
