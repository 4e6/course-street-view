---
type: Gotcha
title: Hidden tabs do not render Street View
description: In a background or hidden browser tab Street View paints black and timers are throttled, so automated tests there look like app bugs. Test with the window visible.
tags: [testing, street-view]
timestamp: 2026-10-02T11:05:28Z
---

# Symptom

Under browser automation, Street View stays **black** while the HUD shows a
position and an imagery date; play or scripted step loops crawl (a handful of
steps in half a minute). The map may render, slowly.

# Cause

The tab is not visible (`document.visibilityState === "hidden"`) — for
example, the automated Chrome window is behind other windows. Chrome skips
WebGL painting and throttles timers in hidden tabs.

# Fix

Check `document.visibilityState` first. Bring the window to the front before
testing anything visual or timed. Logic (positions, dates, off-course) can
still be checked in a hidden tab; appearance and pacing cannot.
