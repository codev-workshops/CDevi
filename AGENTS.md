# AGENTS.md — working in the CDevi repository

CDevi (සීදේවි) is an SDLC Control Plane: an enterprise web app for supervising autonomous engineering agents through requirement → analysis → implementation → testing → review → PR, with humans intervening at approval and clarification points. Product intent: `docs/SDLC Control Plane — High-Level UI Specification.md`. Specifications: `specs/`. Governance: `.specify/memory/constitution.md` (v1.1.0) — it wins over anything else in this file.

## Toolchain

- Node 26 (`.nvmrc`), pnpm 10 (`npm i -g pnpm`). Monorepo: `packages/*`, `apps/*` (`pnpm-workspace.yaml`).
- TypeScript strict (`tsconfig.base.json`), ESLint 9 flat config (`eslint.config.js`), Stylelint (`.stylelintrc.json`), Prettier (`.prettierrc.json`), Vitest (`vitest.config.ts` runs the `design-system` and `tools` projects), Playwright for visual/a11y.

## Commands

```bash
pnpm i                      # install (frozen lockfile in CI)
pnpm check                  # lint + lint:css + typecheck + check:classes + test + check:size — run before every commit
pnpm test                   # unit + component axe + token drift + contrast + lint fixtures
pnpm test:visual            # Playwright: page-level axe + screenshots for gallery and reference screens, LCP budget
pnpm build                  # tokens → css bundle → library dist
pnpm format                 # Prettier
pnpm -F @cdevi/design-system gallery   # component gallery at http://127.0.0.1:5173/gallery/
pnpm -F @cdevi/design-system build:tokens   # after editing tokens/tokens.json (never edit generated files)
```

CI (`.github/workflows/ci.yml`) runs four required jobs on every PR: `lint`, `unit`, `build`, `visual`. A red job blocks merge; do not weaken a rule to get green — fix the code or, if a rule is wrong, change it in the package with a CHANGELOG entry.

## Spec Kit workflow

Features are specified before they are built: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`. The active feature is recorded in `.specify/feature.json`. Every plan must pass the Constitution Check and fill the **Design System Compliance** section. Every behaviour change ships with a failing-then-passing test; bug fixes start with a regression test (Principle II).

## UI work — read this first

All user interfaces are built from `@cdevi/design-system` (`packages/design-system`). The normative rules are in **`packages/design-system/DESIGN.md`**; the skill `.devin/skills/cdevi-design-system/SKILL.md` is the short form and loads automatically for UI tasks.

- Import components from `@cdevi/design-system` and the stylesheet from `@cdevi/design-system/css`. Do not hand-write `cd-` markup.
- State is always a word in a pill (`StatePill` for the nine workflow states; `RiskBadge` for the four risk levels). `WAITING_FOR_HUMAN` and `BLOCKED` are never hidden.
- Saffron is reserved for "a person is needed" and for exactly one primary `Button variant="saffron"` per screen.
- Agent claims (`Message`) and platform evidence (`GateCheck` + `source`) are visually separate; overrides are never green.
- No inline `style=`, no literal colours/sizes/spacing (tokens only), no `<div onClick>`; every control has an accessible name and visible focus. `pnpm check` enforces all of this and will fail otherwise.
- Missing a pattern? Add it to the package first (DESIGN.md §8: CSS → component + test → gallery entry → DESIGN.md row → CHANGELOG), then consume it.
- Reference screens in `packages/design-system/reference-screens/` are pattern references, not CDevi screens; the screen inventory comes from `specs/001-sdlc-control-plane-mvp/spec.md`.

## Repository layout

```
packages/design-system/   @cdevi/design-system — tokens, CSS, React components, gallery, reference screens, DESIGN.md
tools/                    repo checks: check-class-prefix.mjs, check-size.mjs, lint fixtures (must fail), governance tests
specs/                    Spec Kit features (001 control-plane MVP, 002 design-system adoption)
docs/                     product and architecture documents
.specify/                 constitution, templates, scripts
.devin/skills/            agent skills (speckit-*, cdevi-design-system)
```

## Conventions

- Commit after each task or logical group; describe _why_. Update `CHANGELOG.md` in the same commit as a design-system change.
- Pin dependencies to versions published ≥ 7 days ago; commit `pnpm-lock.yaml`.
- Never commit secrets. `.env*` is ignored.
- Generated files (`css/tokens.css`, `css/cdevi.css`, `tailwind/preset.cjs`, `src/tokens.generated.ts`) are committed but never edited by hand; `pnpm check:tokens` catches drift.
