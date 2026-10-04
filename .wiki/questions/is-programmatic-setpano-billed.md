---
type: Open Question
title: Is a programmatic setPano billed as a new Street View load?
description: Answered — no. Five course switches, each moving the panorama to new imagery with setPano, counted 0 against the billable quota; one panorama showing imagery counted 1.
status: deprecated
tags: [billing, street-view]
---

# Question

[One panorama per page](/decisions/0001-one-panorama-per-page.md) assumes that
moving the panorama with `setPano` costs nothing after the first load. Google
documents that *user* navigation within a panorama is not billed and that the
billable event is instantiating the panorama object; it does not explicitly
cover the app moving it from code.

# Answer (2026-10-02)

**Not billed.** It first looked uncheckable, because usage metrics show no
Street View series — but Street View loads are reported under the same name as
map loads, so they were there all along. Measured minute by minute with nobody
else using the key: a panorama showing its first imagery counted 1 against the
`billable_default` quota; five course switches, each moving that same
panorama to new imagery with `setPano`, counted 0. See
[Google Maps Platform](/integrations/google-maps-platform.md).

Quota usage is not the invoice, so the billing reports' **Dynamic Street View**
count remains the final word; the method below still applies.

# How to answer

After a few days of real use, compare the **Dynamic Street View** SKU count in
the billing reports with the number of map loads — one per session that opens
a course, the same sessions that create the panorama. Equal means
`setPano` is free; many times larger means each step is billed, and the cost
model — and the [budget alert](/integrations/google-maps-platform.md) — matter a
great deal more.
