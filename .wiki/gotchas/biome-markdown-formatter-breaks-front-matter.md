---
type: Gotcha
title: Biome's Markdown formatter breaks the wiki's front matter
description: Biome formats Markdown by default and, without its front-matter parser, reads a page's YAML block as text. Formatting the wiki turns front matter into headings, so the Markdown formatter is off in biome.json.
tags: [biome, tooling, wiki]
---

# Symptoms

* After a Biome update, `bun run lint` fails with format errors in every
  `.wiki/*.md` page, though no page changed.
* `bun run format` (`biome check --write`) "fixes" them by rewriting the
  front matter: the closing `---` becomes a heading underline, so
  `okf_version: "0.2"` turns into a `##` heading, YAML lists are re-indented,
  and `*emphasis*` becomes `_emphasis_`. The bundle stops being valid OKF.

# Cause

Biome's Markdown support is on by default once a release has it, and its
front-matter parser is opt-in. Without that parser the YAML block is ordinary
Markdown to it: a thematic break, text, and a setext heading.

# What we do

The Markdown **formatter** is disabled in `biome.json`
(`markdown.formatter.enabled: false`). That also stops Biome formatting
`README.md` and `CLAUDE.md`, which is accepted. Markdown **linting** stays on;
its rules skip pages that open with `---`.

To let Biome format Markdown again, enable its front-matter parser and run
`okf.py lint` on the result before committing it.
