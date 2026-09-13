# CDevi (සීදේවි) design system

Plain CSS design tokens and components for the CDevi web application. Framework agnostic,
no build step required, every class prefixed `cd-` so it can sit beside any existing stylesheet.

## Contents

```
css/tokens.css        CSS custom properties (light, dark via [data-theme] or prefers-color-scheme)
css/base.css          scoped reset and typography under .cd-root
css/components.css    all components (app shell, pills, buttons, rows, cards, decision, checks, diff, …)
css/cdevi.css         the three files above concatenated — include this one
tokens/tokens.json    the same tokens in W3C design-token format for Style Dictionary, Figma Tokens, etc.
tailwind/preset.js    Tailwind preset that maps colours, fonts, radii and sizes to the tokens
docs/index.html       component gallery with copyable markup
demo/*.html           full screens (inbox, spec session, new task, run, review, keys, repository, usage, cli)
```

## Install

Copy the folder into your repository, or install as a package:

```
npm install ./cdevi-design-system      # or publish as @cdevi/design-system
```

```html
<link rel="stylesheet" href="node_modules/@cdevi/design-system/css/cdevi.css" />
<body class="cd-root">
  …
</body>
```

React, Vue, Svelte: import the CSS once (`import '@cdevi/design-system'`) and use the class names.
Tailwind: add `presets: [require('@cdevi/design-system/tailwind/preset')]` to `tailwind.config.js`;
utilities like `bg-saffron text-ink-2 rounded-lg` then resolve to the tokens.

## Fonts

Instrument Sans (UI), JetBrains Mono (paths, fingerprints, logs), Noto Sans Sinhala (wordmark).
Load them from Google Fonts or self-host; the token `--ui`, `--mono`, `--sinhala` stacks fall back
to system fonts.

## Dark mode

Follows `prefers-color-scheme` by default. Force with `<html data-theme="dark">` or
`data-theme="light"`.

## Rules the components encode (from spec 200)

- Run state is always a word in a pill (`cd-pill cd-run|cd-wait|cd-done|cd-fail|cd-neutral`).
- Runtime (`cd-rt` with the laptop or cloud glyph) and the paying credential (`cd-key`) appear on
  every run surface.
- Saffron is reserved for "needs you" and the one primary action on a screen.
- Agent claims and platform evidence are visually separated: `cd-msg` for the agent, `cd-check`
  rows with a `cd-src` source for evidence. `cd-box cd-override` is saffron, never green.
- No sticky headers; the shell is `cd-app` (optionally `cd-with-panel`) and scrolls with the page.

## Versioning

Tokens and class names are the public API. Additive changes bump the minor version; renames or
removals bump the major version and are listed in CHANGELOG.md.
