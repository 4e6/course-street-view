# Fixtures

- `terrarium-13-3888-3123.png`: one z13 terrarium tile around Vermelha, PT, from the default (v1) tiles.
- `terrarium-v1-13-*.png`, `terrarium-v2-13-*.png`: the same four z13 tiles (3888/3125, 3888/3126, 3888/3122, 3889/3122) from the bucket's default build (v1, EU-DEM) and its `v2` build (SRTM). Source headers at fetch time: v1 `eudem/eudem_dem_5deg_n35w010.tif`, v2 `srtm/N39W010.tif`. Fetched from `https://s3.amazonaws.com/elevation-tiles-prod/{terrarium,v2/terrarium}/13/{x}/{y}.png`.
- `route-crops.json`: node coordinates (`[lat, lng]`) of two stretches of the EN 115 road near Vermelha, PT, taken from OpenStreetMap (way 139520941, and way 159034731). Data (c) OpenStreetMap contributors, available under the Open Database License (ODbL, https://www.openstreetmap.org/copyright). Not derived from any personal GPX file.
