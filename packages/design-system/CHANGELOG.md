# Changelog

Tokens and class names are the public API. Additive changes bump the minor version; renames or
removals bump the major version and carry a migration note.

## 1.0.1 — 2026-09-11

### Fixed

- `table.cd-table` rule was written as `table.cd-cd-table`, so the table component was never styled
  (gallery and reference screens use `cd-table`). Regression test: `tests/unit/css-classes.test.ts`.

## 1.0.0 — 2026-09-13

Initial release: tokens, base, components, Tailwind preset, gallery, ten demo pages.
