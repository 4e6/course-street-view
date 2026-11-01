# Module

* [Course](course.md) - The course as geometry — distance along it, points, headings, gradient, and matching an arbitrary point back to a position s. Pure TypeScript, no Google, fully unit-tested.
* [Rider](rider.md) - Keeps the one Street View panorama and the position s in step, whichever way a move started — slider, step, play, map tap, or Google's own arrows. Owns stepping, play and off-course detection.
* [Terrain elevation](terrain.md) - Optional elevation from a terrain model instead of the GPX file, chosen in Settings. Feeds only the profile and the HUD elevation and grade; the course geometry always stays the GPX's.
