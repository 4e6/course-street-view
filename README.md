# Course Street View

Preview a cycling course in Google Street View before you ride it. Open a GPX
file and the screen splits: Street View on top, the course on a map below,
and an elevation profile at the bottom that doubles as a slider.

Move along the course any way you like:

- **Google's own Street View arrows** and click-to-go. The app works out where
  you are on the course after every move, and warns you when a turn takes you
  off it.
- **Step buttons** (or `,` and `.`) that follow the course, so they never take
  a wrong turn at a junction. They follow Street View's arrows where those
  point along the course, which keeps the imagery from one capture instead of
  flickering between years.
- **Play** (`space`), at ½×, 1× or 2×.
- **Dragging along the elevation profile**, or tapping the course on the map.

It is a static site with no backend: the GPX never leaves the browser, and
GitHub Pages hosts it for free.

## How it works

Everything is driven by one number, `s`: metres along the course
([`src/course.ts`](src/course.ts)). The slider, step buttons and play mode
turn `s` into a point, find the nearest Street View panorama, and show it
facing along the course. Moves made inside Street View go the other way: the
new position is projected back onto the course to update `s`.

That projection is the subtle part. A course that uses a road twice
(out-and-back, laps) has two equally good matches for one position, so
`Course.locate` searches near the current `s` first and penalises segments
facing against the direction of travel. It only falls back to the whole
course when nothing nearby fits. The tests in
[`tests/course.test.ts`](tests/course.test.ts) cover these cases.

### Cost

Google bills Street View per **panorama object**, not per image. The app
creates one `StreetViewPanorama` per page load and only ever re-points it with
`setPano`, so a ride, however long, is a single
[Dynamic Street View](https://developers.google.com/maps/billing-and-pricing/sku-details)
load, plus one Dynamic Maps load for the map. Looking panoramas up with
`StreetViewService` is not billed, which is what makes stepping and the
background coverage scan (grey stretches on the map and profile) free.
Google's monthly free allowance is far above what personal use needs.

Google's terms don't allow Street View imagery and a non-Google map on the
same screen, so the map is Google's too.

## Google Maps API key

1. In the [Google Cloud console](https://console.cloud.google.com/google/maps-apis),
   create a project, enable the **Maps JavaScript API**, and create an API key.
2. Restrict the key:
   - **Application restrictions → Websites**: `https://<user>.github.io/*`
     and, for development, `http://localhost:5173/*`.
   - **API restrictions**: Maps JavaScript API only.
3. Cap the spend: under **Quotas**, set daily limits on Dynamic Street View
   and Dynamic Maps (a few hundred a day is plenty). Google has no automatic
   spending limit, so quotas are what keep a leaked key cheap.

A key in a browser app is always visible to visitors. The referrer
restriction and quotas, not secrecy, are what protect it.

Visitors can also paste their own key under **Settings**. It is stored only in
their browser and replaces the built-in one.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env         # then put your key in it
bun run dev                  # http://localhost:5173
bun run check                # lint, typecheck, tests
bun run build                # static site in dist/
```

## Deploying to GitHub Pages

1. Push to GitHub, then in **Settings → Pages** set the source to
   **GitHub Actions**.
2. Optionally add the key as the repository secret `GOOGLE_MAPS_API_KEY`.
   Without it, the site deploys and asks each visitor for a key.

Every push to `main` runs the checks and publishes
`https://<user>.github.io/<repo>/`.

## License

[MIT](LICENSE). Google Maps and Street View content shown by the app is
Google's and remains under the
[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms).
