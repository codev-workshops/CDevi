# Lint fixtures — these files MUST fail

Each file here contains exactly one category of design-system violation. `fixtures.test.ts` runs the
real ESLint, Stylelint, class-prefix, token-drift and contrast checks against them and asserts that
the expected rule fires. If a fixture stops failing, the guardrail has regressed.

| File                   | Violates                               | Expected rule                                                                      |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `raw-color.css`        | DR-06 literal colour / spacing         | `scale-unlimited/declaration-strict-value`                                         |
| `inline-style.tsx`     | DR-07 inline style                     | `react/forbid-dom-props`                                                           |
| `div-onclick.tsx`      | DR-08 non-semantic clickable           | `jsx-a11y/no-static-element-interactions`, `jsx-a11y/click-events-have-key-events` |
| `icon-no-label.tsx`    | DR-08 icon-only control without a name | `jsx-a11y/control-has-associated-label`                                            |
| `unknown-cd-class.tsx` | DR-09 undefined `cd-` class            | `tools/check-class-prefix.mjs`                                                     |

These files are excluded from the normal `pnpm lint` / `pnpm lint:css` globs.
