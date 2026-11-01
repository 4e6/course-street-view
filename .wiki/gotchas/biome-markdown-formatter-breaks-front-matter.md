---
type: Gotcha
title: Biome must parse front matter to format the wiki
description: Without its front-matter parser Biome reads a page's YAML block as Markdown and turns it into headings. With the parser on, it formats the front matter as YAML and the body as Markdown, and agrees with okf.py's output.
tags: [biome, tooling, wiki]
---

# Symptoms

- After a Biome update, or with the front-matter parser turned off, `bun run lint`
  fails with format errors in every wiki page, though no page changed.
- `bun run format` (`biome check --write`) then rewrites every `.wiki/*.md` page's
  front matter: the closing `---` becomes a heading underline, so
  `okf_version: "0.2"` turns into a `##` heading, and YAML lists lose their indent.
  The bundle stops being valid OKF.

# Cause

Biome's Markdown support is on by default once a release has it, and its
front-matter parser is opt-in. Without that parser the YAML block is ordinary
Markdown to it: a thematic break, text, and a setext heading.

# What we do

`biome.json` sets `markdown.parser.frontmatter: true`, so Biome formats the front
matter as YAML (layout only; keys and values are untouched) and the rest of the
page as Markdown. Never turn the parser off while the formatter is on.

`okf.py` writes index bullets as `-`, as Biome does, and pins unquoted, which
Biome leaves as they are, so `bun run format` and `okf.py index --write` converge and do not
fight over the same lines.

After upgrading Biome, run `bun run format`, then `okf.py index --write` and
`okf.py lint`, and check they still converge: a second `bun run format` should
report no fixes.
