# CLAUDE.md

Course Street View: ride a GPX course in Google Street View, with the course
map and an elevation-profile slider below. A static Vite + TypeScript site with
no backend, deployed to GitHub Pages. See [README.md](README.md) for setup.

`bun run check` runs lint, typecheck and tests; `bun run dev` serves
http://localhost:5173 (the only local origin the Maps key accepts).

## Project knowledge

Durable knowledge about this project — architecture boundaries, decisions and
their rationale, invariants, domain vocabulary, gotchas — lives in an OKF
knowledge bundle at [.wiki/](.wiki/). **Start at [.wiki/index.md](.wiki/index.md)**
and drill down; don't read the whole bundle.

Wiki updates land in the same commit as the change, never as a follow-up.
