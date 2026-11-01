---
type: Integration
title: AWS Terrain Tiles
description: Keyless, free elevation tiles on AWS Open Data for the optional terrain elevation. The default build is EU-DEM in Portugal and the undocumented v2 build is SRTM there; zoom 13 is enough for 25–30 m data.
tags: [elevation, terrain, aws]
sources:
  - id: registry
    resource: https://registry.opendata.aws/terrain-tiles/
    title: Terrain Tiles on the Registry of Open Data on AWS
  - id: formats
    resource: https://github.com/tilezen/joerd/blob/master/docs/formats.md
    title: Joerd tile formats (terrarium encoding)
---

# What it is

A public S3 bucket of Web-Mercator elevation tiles, built by Mapzen's joerd
from several models and kept on AWS Open Data.[^registry] The app uses the
_terrarium_ PNGs, where elevation in metres is `R·256 + G + B/256 − 32768`.[^formats]

- **No key, no billing**, and served with `Access-Control-Allow-Origin: *`, so
  a static site can fetch them straight from the browser.
- **The source model varies by tile.** The response header
  `x-amz-meta-x-imagery-sources` names it; around Vermelha, PT it is `eudem`
  in the default build. Elsewhere it may be SRTM or coarser, so quality is not
  uniform. The bucket lists that header in `Access-Control-Expose-Headers`, so
  the page can read it.

# Two builds: `terrarium` and `v2/terrarium`

The bucket holds a second, older build under `v2/terrarium/{z}/{x}/{y}.png`:
the same encoding and decoder, a different mix of models. Joerd's documentation
does not mention it, so what follows is observed, not promised, and the app
treats it as optional.

- **Measured on Vermelha, PT (all 23 tiles of an 80 km course) and by header
  sampling elsewhere:** where the default
  tiles are EU-DEM, the `v2` z13 tiles are SRTM 1 arc-second, whole metres
  (no fractional values), the header reads `srtm/N39W010.tif`. They are about
  27 KB a tile against about 105 KB.
- **It is older, not newer:** `Last-Modified` is 2017-09 for `v2` and 2017-11
  for the default build. An orphaned older build, so it can disappear, and the
  app must work without it.
- **It is not better everywhere.** Headers sampled at about a dozen places, not
  mapped: Finland at 62.5 °N is GMTED (about
  230 m) in `v2` where the default has 5 m national data; Reykjavik loses its
  5 m data; Stockholm, Nice and the Algarve are `srtm` plus `eudem` mixed. London,
  Norway, the US and Japan are identical in both. So the choice is made per
  course from the header, never per tile (an edge between two models is an
  elevation step) — see [Terrain elevation](/architecture/terrain.md).
- **Skadi** (`skadi/N39/N39W010.hgt.gz`, the original SRTMGL1 files) is pure SRTM
  too, but is 5–10 MB of gzip per degree square with no range requests and
  no `Cache-Control`, so it was not used. `v2/skadi` is something else again:
  a mixed-source build.

# Zoom

The app reads zoom 13 (≈15 m pixels at 39°N). Measured on Estrada do Atalho,
z13 is within 1 m of z14 and z15, and z14 matched OpenTopoData's EU-DEM 25 m
values to the metre: higher zooms only resample the same 25–30 m data, at four
times the tiles per step. An 80 km course needs a few dozen z13 tiles of about
100 KB each (about 26 KB in `v2`). The bucket sends no `Cache-Control`, only a `Last-Modified`
from 2017, so whether a reload refetches them is down to the browser's
heuristic freshness; the app keeps no copy of its own.

# Used by

[Terrain elevation](/architecture/terrain.md).

[^registry]: [Terrain Tiles on the Registry of Open Data on AWS](https://registry.opendata.aws/terrain-tiles/)
[^formats]: [Joerd tile formats](https://github.com/tilezen/joerd/blob/master/docs/formats.md)
