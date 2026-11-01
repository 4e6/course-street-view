# Gotcha

- [Biome must parse front matter to format the wiki](biome-markdown-formatter-breaks-front-matter.md) - Without its front-matter parser Biome reads a page's YAML block as Markdown and turns it into headings. With the parser on, it formats the front matter as YAML and the body as Markdown, and agrees with okf.py's output.
- [Hidden tabs do not render Street View](hidden-tab-street-view.md) - In a background or hidden browser tab Street View paints black and timers are throttled, so automated tests there look like app bugs. Test with the window visible.
- [Page CSS and Google's Street View DOM collide both ways](street-view-dom-and-page-css.md) - A bare svg rule hides Street View's arrows, and Street View's own z-indexes cover overlays. Scope styles to the app and give the panorama container a stacking context.
- [The nearest Street View panorama is not the next one along the road](nearest-panorama-is-not-continuous.md) - Stepping by "nearest panorama" flickers between capture years and drifts onto footpaths beside the road. Follow the current panorama's arrows instead, and search only as a fallback.
