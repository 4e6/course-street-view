---
type: Open Question
title: Is a programmatic setPano billed as a new Street View load?
description: The cost model assumes moving the one panorama with setPano is free, as user navigation is. Google's docs only say that about user navigation, and usage metrics do not show Street View at all.
status: open
tags: [billing, street-view]
timestamp: 2026-10-02T12:31:45Z
---

# Question

[One panorama per page](/decisions/0001-one-panorama-per-page.md) assumes that
moving the panorama with `setPano` costs nothing after the first load. Google
documents that *user* navigation within a panorama is not billed and that the
billable event is instantiating the panorama object; it does not explicitly
cover the app moving it from code.

It could not be checked from usage metrics: the project's Cloud Monitoring
shows map loads only, with no Street View series at all (see
[Google Maps Platform](/integrations/google-maps-platform.md)).

# How to answer

After a few days of real use, compare the **Dynamic Street View** SKU count in
the billing reports with the number of map loads — one per session that opens
a course, the same sessions that create the panorama. Equal means
`setPano` is free; many times larger means each step is billed, and the cost
model — and the [budget alert](/integrations/google-maps-platform.md) — matter a
great deal more.
