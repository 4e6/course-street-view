---
type: Integration
title: AWS Terrain Tiles
description: Keyless, free elevation tiles on AWS Open Data, used for the optional terrain elevation. Which model a tile comes from varies by region (EU-DEM in Portugal); zoom 13 is enough for 25–30 m source data.
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
*terrarium* PNGs, where elevation in metres is `R·256 + G + B/256 − 32768`.[^formats]

* **No key, no billing**, and served with `Access-Control-Allow-Origin: *`, so
  a static site can fetch them straight from the browser.
* **The source model varies by tile.** The response header
  `x-amz-meta-x-imagery-sources` names it; around Vermelha, PT it is
  `eudem`. Elsewhere it may be SRTM or coarser, so quality is not uniform.

# Zoom

The app reads zoom 13 (≈15 m pixels at 39°N). Measured on Estrada do Atalho,
z13 is within 1 m of z14 and z15, and z14 matched OpenTopoData's EU-DEM 25 m
values to the metre: higher zooms only resample the same 25–30 m data, at four
times the tiles per step. An 80 km course needs a few dozen z13 tiles of about
100 KB each, cached by the browser between reloads.

# Used by

[Terrain elevation](/architecture/terrain.md).

[^registry]: [Terrain Tiles on the Registry of Open Data on AWS](https://registry.opendata.aws/terrain-tiles/)
[^formats]: [Joerd tile formats](https://github.com/tilezen/joerd/blob/master/docs/formats.md)
