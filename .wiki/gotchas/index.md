# Gotcha

* [Biome's Markdown formatter breaks the wiki's front matter](biome-markdown-formatter-breaks-front-matter.md) - Biome formats Markdown by default and, without its front-matter parser, reads a page's YAML block as text. Formatting the wiki turns front matter into headings, so the Markdown formatter is off in biome.json.
* [Hidden tabs do not render Street View](hidden-tab-street-view.md) - In a background or hidden browser tab Street View paints black and timers are throttled, so automated tests there look like app bugs. Test with the window visible.
* [Page CSS and Google's Street View DOM collide both ways](street-view-dom-and-page-css.md) - A bare svg rule hides Street View's arrows, and Street View's own z-indexes cover overlays. Scope styles to the app and give the panorama container a stacking context.
* [The nearest Street View panorama is not the next one along the road](nearest-panorama-is-not-continuous.md) - Stepping by "nearest panorama" flickers between capture years and drifts onto footpaths beside the road. Follow the current panorama's arrows instead, and search only as a fallback.
