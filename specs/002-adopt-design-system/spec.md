# Feature Specification: Adopt the CDevi Design System as the Governed UI Foundation

**Feature Branch**: `002-adopt-design-system`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "Adopt the cdevi-design-system folder as CDevi's governed UI foundation: import and repair the package, codify its rules so AI agents adhere to them, and enforce them in CI."

**Source material**: `/Users/praveen/Downloads/cdevi-design-system` (v1.0.0: tokens, CSS, Tailwind preset, gallery, ten reference screens), `docs/SDLC Control Plane — High-Level UI Specification.md`, `specs/001-sdlc-control-plane-mvp/spec.md`, `.specify/memory/constitution.md`

## Overview

CDevi has a hand-crafted design system (tokens, plain-CSS components, a gallery and reference screens) that encodes the product's core UX rules: state is always a word in a pill, saffron is reserved for "needs a person" and the single primary action, agent claims are visually separated from platform evidence, and overrides are never shown as verified. It currently lives outside the repository, describes a different screen inventory than the product specification, has accessibility and consistency defects, and nothing prevents a contributor — human or AI agent — from ignoring it.

This feature brings the design system into the repository as a versioned package, repairs it, extends it to cover the vocabulary of the SDLC Control Plane (workflow states, risk levels, approvals, findings, audit), codifies its rules in the places contributors and AI agents read before doing UI work, and makes the rules machine-enforced so a violation blocks a merge rather than relying on review.

**Phase 0 decisions (confirmed with the product owner on 2026-09-11)**

| Topic | Decision |
|-------|----------|
| Governing product vision | The UI specification and `specs/001` define screens, navigation and vocabulary; the design system supplies tokens, components and interaction rules. Its reference screens are pattern references, not a screen inventory. |
| Consumption model | Accessible React components exported from the package render the design system's classes; application code composes components rather than hand-writing markup. |
| Fonts | Self-hosted inside the package; no third-party font requests at runtime. |
| `docs/architecture.md` | Rewritten for CDevi, keeping transferable patterns and removing content from the unrelated product. |
| State and risk semantics | Extend the palette minimally: one additional "blocked" state variant and a risk badge built from existing hues. |
| Package identity | `packages/design-system`, published internally as `@cdevi/design-system`. |
| Enforcement | Violations fail continuous integration: colour/spacing outside tokens, inline styles, non-semantic interactive elements, accessibility failures, and token drift are all blocking. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An AI agent builds a new screen that conforms without being told (Priority: P1)

An AI coding agent is asked to implement a screen from `specs/001` (for example the Approval Center). Before writing UI code it is automatically pointed at the design system's rules, component catalogue and state/risk mappings. It composes the screen from the package's components, uses only token-backed colours and spacing, and the result passes every design-system check on the first attempt.

**Why this priority**: The whole point of codifying the system is that future agents adhere to it by default. If this story fails, the design system is documentation nobody reads.

**Independent Test**: Give an agent with no prior context the instruction "implement the Approval Center list from specs/001" in a scratch branch; the produced code imports only design-system components, contains no raw colour values or inline styles, and passes the design-system and accessibility checks without human correction.

**Acceptance Scenarios**:

1. **Given** an agent starts a task that touches UI, **When** it loads the repository's contributor guidance, **Then** it finds the design-system rules, the component catalogue, the workflow-state-to-pill and risk-level-to-badge mappings, and the verification commands within the first documents it reads (repository guidance file and an auto-invoked skill).
2. **Given** the agent needs a pattern that already exists (state pill, decision card, gate checklist, list row, stat card, tabs), **When** it implements the screen, **Then** it uses the package component rather than re-implementing the markup or styling.
3. **Given** the agent needs a pattern that does not exist, **When** it follows the guidance, **Then** it adds the component to the design-system package first (with gallery entry, accessibility contract and changelog line) and consumes it from the application, rather than styling it locally.
4. **Given** the agent's change is opened as a pull request, **When** continuous integration runs, **Then** the design-system checks pass with zero violations.

---

### User Story 2 - A contributor is blocked from bypassing the design system (Priority: P1)

A contributor (human or agent) writes application UI that uses a raw hex colour, an inline style, a clickable `<div>`, a Tailwind default-palette utility, or a class name that is not part of the design system. Continuous integration fails with a message that names the rule and the sanctioned alternative.

**Why this priority**: Enforcement is what turns guidance into a guarantee; without it every rule in this feature is optional.

**Independent Test**: Commit a fixture file containing each category of violation; every category produces a failing check with an actionable message, and removing the violations makes the checks pass.

**Acceptance Scenarios**:

1. **Given** application code declares a colour, font size, radius or spacing value that is not a design token, **When** checks run, **Then** the check fails and the message names the token category to use instead.
2. **Given** application code sets an inline style on an element (other than an explicitly allow-listed dynamic property such as a meter width), **When** checks run, **Then** the check fails.
3. **Given** application code attaches a click handler to a non-interactive element, omits a label on an icon-only control, or removes visible focus, **When** checks run, **Then** the accessibility check fails.
4. **Given** the generated token outputs (stylesheet variables, utility preset) do not match the token source file, **When** checks run, **Then** the drift check fails and reports the differing tokens.
5. **Given** a class name outside the design-system package uses the design system's reserved prefix but is not defined by the package, **When** checks run, **Then** the check fails.
6. **Given** all violations are removed, **When** checks run, **Then** every design-system check passes and the pull request is mergeable on that axis.

---

### User Story 3 - The design system is imported, repaired and made accessible (Priority: P1)

A maintainer imports the external design-system folder into the repository as `packages/design-system`, fixes its known defects, brings its colour contrast and interactive states up to WCAG 2.2 AA, self-hosts its fonts, and can open a component gallery that demonstrates every component in light and dark themes with copyable usage.

**Why this priority**: Everything else builds on a correct, accessible package. Adopting it with known defects would codify the defects.

**Independent Test**: Open the gallery; every component renders in light and dark, the table component is styled, all text/background pairs meet contrast thresholds, every interactive component is keyboard-operable with visible focus, no network request leaves the origin for fonts, and the gallery passes automated accessibility scanning.

**Acceptance Scenarios**:

1. **Given** the package is installed in the repository, **When** the maintainer views the gallery, **Then** every component listed in the package's catalogue appears with a rendered example, its usage, and its accessibility notes, in both themes.
2. **Given** the shipped table component mismatch (style rule name differs from the class used in examples), **When** the package is imported, **Then** the defect is fixed and the table example renders styled.
3. **Given** the tertiary text colour currently falls below the 4.5:1 contrast ratio on light surfaces, **When** repairs are complete, **Then** every text/background token pair used by the components meets WCAG 2.2 AA contrast in both themes, verified by automated measurement.
4. **Given** buttons, tabs, navigation items, segmented controls, option rows and chips, **When** repairs are complete, **Then** each is a semantic interactive element with hover, active, focus-visible, selected/current and disabled states, and is fully operable by keyboard.
5. **Given** a page using the package, **When** the page loads, **Then** the three typefaces load from the package's own assets and the fallback stacks apply if they fail.
6. **Given** the reference screens, **When** imported, **Then** they live under the package as clearly labelled pattern references with a note that they do not define CDevi's screens or navigation.

---

### User Story 4 - Tokens are the single source of truth (Priority: P2)

A designer or maintainer changes a value in the token source (for example the saffron hue in dark mode). Running one command regenerates the stylesheet variables and the utility preset; nothing else needs hand-editing, and a stale generated file is caught by the drift check.

**Why this priority**: The current package claims its stylesheet is generated but has no generator, and its three token representations already disagree. Drift will grow with every change unless generation is real.

**Independent Test**: Change one token value, run the generate command, confirm both generated outputs contain the new value and the drift check passes; revert only the generated files and confirm the drift check fails.

**Acceptance Scenarios**:

1. **Given** the token source, **When** the generate command runs, **Then** the stylesheet variables (light, dark override, and dark preference) and the utility preset are produced from it and contain no values not present in the source.
2. **Given** tokens that exist only in the stylesheet today (code-log colours, shadow), **When** the source is completed, **Then** they are present in the token source with the same naming scheme as the rest.
3. **Given** the utility preset, **When** generated, **Then** it replaces (not extends) the default colour, font, radius and font-size scales so that only token-backed utilities exist, and colour utilities resolve through the theme variables so dark mode follows the tokens.
4. **Given** new semantic tokens for workflow states and risk levels, **When** generated, **Then** they resolve to existing base hues and are documented in the token source with their intended meaning.

---

### User Story 5 - The design system speaks the product's vocabulary (Priority: P2)

A contributor implementing `specs/001` needs to show a `BLOCKED` workflow, a `CRITICAL`-risk approval, a review finding with severity and blocking class, and an audit event row. The design system provides a component and a documented mapping for each, so they do not have to invent one.

**Why this priority**: The shipped system covers a different product's vocabulary. Without these additions, agents will improvise for exactly the states the specification says must never be hidden.

**Independent Test**: For each of the nine workflow states and four risk levels, render the mapped component in the gallery; each is visually distinct where the specification requires it, `BLOCKED` and `WAITING_FOR_HUMAN` are the most prominent, and `CRITICAL` is visually prominent without reusing the "failed" appearance.

**Acceptance Scenarios**:

1. **Given** the nine workflow states (`QUEUED`, `RUNNING`, `WAITING`, `WAITING_FOR_HUMAN`, `BLOCKED`, `FAILED`, `RETRYING`, `COMPLETED`, `CANCELLED`), **When** a state pill is rendered for each, **Then** each maps to a documented variant; `BLOCKED` has its own variant distinct from `FAILED`; `WAITING_FOR_HUMAN` uses the "needs a person" treatment.
2. **Given** the four risk levels (LOW, MEDIUM, HIGH, CRITICAL), **When** a risk badge is rendered for each, **Then** HIGH and CRITICAL are visually prominent, CRITICAL is distinguishable from FAILED, and the badge always contains the level as a word.
3. **Given** a review finding, **When** rendered, **Then** severity (CRITICAL/HIGH/MEDIUM/LOW/INFO) and blocking class (BLOCKING/NON-BLOCKING/SUGGESTION) are shown as words, with evidence location, impact and recommended fix regions and the actions Apply Fix / Dismiss / Create Issue.
4. **Given** an audit event, **When** rendered as a row, **Then** timestamp, actor, action, target, workflow, policy applied, risk level and result each have a defined slot.
5. **Given** the approval and clarification concepts in `specs/001`, **When** the vocabulary glossary is read, **Then** each is mapped to a design-system component (decision card with actions; decision card with options), and evidence is mapped to the gate checklist with a source label.
6. **Given** a full-page application shell, **When** rendered, **Then** a full-viewport variant exists (no framed border or corner radius) with defined behaviour at desktop, tablet and narrow widths.

---

### User Story 6 - Governance documents make the design system mandatory (Priority: P2)

A reviewer or planning agent checks a feature plan against the constitution and finds an explicit obligation to use the design system, a plan-template section that asks which components are used or proposed, and a task-template pattern for adding a component. The repository's contributor guidance, a skill, and a normative design document all point to the same rules.

**Why this priority**: Enforcement covers what lint can see; governance covers design decisions (new patterns, vocabulary) that lint cannot.

**Independent Test**: Run the constitution check on a plan that introduces a locally styled component; the check flags it and points to the design-system obligation.

**Acceptance Scenarios**:

1. **Given** the constitution, **When** amended, **Then** the user-experience principle states that user interfaces MUST use the design system's tokens and components and that new visual patterns MUST be added to the design system before being consumed, with a minor version bump and amendment record.
2. **Given** the plan template, **When** a plan is created, **Then** it contains a design-system compliance section (components used, components proposed, accessibility verification) that the analysis step checks.
3. **Given** the repository guidance file and an auto-invoked skill, **When** a UI task starts, **Then** both direct the reader to the normative design document, the gallery, the state/risk mappings and the verification commands.
4. **Given** the normative design document, **When** read, **Then** every rule is phrased as MUST/MUST NOT, each component lists its accessibility contract (role, keyboard behaviour, focus, states), and a do/don't example accompanies each of the five core rules.

---

### User Story 7 - The architecture document describes CDevi (Priority: P3)

A planning agent reads `docs/architecture.md` and finds a description of CDevi's services, repository layout (including `packages/design-system`), tenancy and permission patterns — with no references to another product's data engine, workbooks or billing.

**Why this priority**: Wrong architecture guidance misleads every subsequent plan; it is lower priority only because it does not block the design-system work itself.

**Independent Test**: Search the rewritten document for the unrelated product's terms (workbook, spreadsheet import, query worker, credits, checkout) and its repository name; none appear, and every path it cites exists or is reserved in this feature or `specs/001`.

**Acceptance Scenarios**:

1. **Given** the rewritten document, **When** read, **Then** it retains the transferable patterns (single image with multiple start commands, transactional outbox, row-level tenancy enforcement, single permission check per agent tool call) re-expressed for CDevi's specifications.
2. **Given** the repository layout section, **When** read, **Then** `packages/design-system` appears with its responsibility and the previous `packages/ui` entry is gone.

---

### Edge Cases

- A component genuinely needs a dynamic value (meter width, bar height, progress percentage): an allow-listed mechanism exists (a data attribute or custom property set from code) so the inline-style rule does not force a workaround or a suppression.
- A third-party widget (for example a diff viewer or chart) must be embedded: guidance defines how to theme it through tokens and where the exception is recorded; its internals are exempt from class-prefix checks but not from accessibility checks.
- A token is renamed or removed: the package's versioning rule requires a major version, a changelog entry and a migration note; the drift check and a class-usage check surface every consumer.
- Dark mode is forced on a page while the operating system prefers light (or vice versa): components follow the explicit setting; a page with no explicit setting follows the operating system.
- Reduced-motion preference is set: the running-state pulse and any transitions are disabled.
- The fonts fail to load (offline, blocked): fallback stacks apply with no layout breakage.
- An agent proposes a new component but the design-system checks cannot run on its gallery entry (for example a build failure): the pull request is blocked and the failure message identifies the gallery entry, not just the check.
- The reference screens drift from the real components after a refactor: they are part of the visual-regression set, so a change in appearance fails the check until the screens are updated intentionally.
- Sinhala wordmark glyphs are missing on a platform: the wordmark falls back to the Latin brand text without shifting layout.

## Requirements *(mandatory)*

### Functional Requirements

**Package and repair**

- **FR-001**: The design system MUST live in the repository as a versioned package at `packages/design-system` named `@cdevi/design-system`, containing the token source, generated stylesheet and utility preset, the React component library, self-hosted font assets, the component gallery, and the reference screens with a note stating they are pattern references only.
- **FR-002**: The package MUST fix the table style-rule/class-name mismatch and record it in the changelog as a patch.
- **FR-003**: Every text/background token pair used by a component MUST meet WCAG 2.2 AA contrast (4.5:1 for body text, 3:1 for large text and UI boundaries) in both light and dark themes, verified by an automated measurement that is part of the package's checks.
- **FR-004**: Every interactive component MUST be a semantic interactive element with defined hover, active, focus-visible, selected/current and disabled states, MUST be fully keyboard-operable, and MUST expose the state to assistive technology.
- **FR-005**: The package MUST self-host its three typefaces with fallback stacks and MUST NOT make third-party network requests at runtime.
- **FR-006**: The package MUST provide a full-viewport application shell variant with documented behaviour at desktop (≥1200px), tablet (≥768px) and narrow (<768px) widths, in addition to the framed variant used by the reference screens.

**Tokens**

- **FR-007**: The token source file MUST be the single source of truth; the stylesheet variables and the utility preset MUST be generated from it by one command, and a check MUST fail when generated outputs differ from the source.
- **FR-008**: The token source MUST include every token currently present only in the stylesheet (code-log colours, shadow) using the same naming scheme as the rest, and MUST add semantic tokens for the nine workflow states and four risk levels that resolve to existing base hues.
- **FR-009**: The generated utility preset MUST replace the default colour, font-family, radius and font-size scales (not extend them) so that only token-backed utilities exist, and colour utilities MUST resolve through theme variables so dark mode follows the tokens.

**Components and vocabulary**

- **FR-010**: The package MUST export a React component for every component in the gallery, rendering the design system's classes, with a typed interface and an accessibility contract documented in the gallery.
- **FR-011**: The state pill MUST support all nine workflow states from `specs/001` through a documented mapping, MUST render the state as a word, and MUST provide a distinct `blocked` variant separate from `failed`.
- **FR-012**: The package MUST provide a risk badge for LOW, MEDIUM, HIGH and CRITICAL that renders the level as a word, makes HIGH and CRITICAL visually prominent, and keeps CRITICAL distinguishable from the failed state, using only the existing hue families (a darker shade of an existing hue may be added where needed for contrast; no new hue family).
- **FR-013**: The package MUST provide components for a review finding (severity, blocking class, description, impact, evidence location, recommended fix, actions), an audit event row (timestamp, actor, action, target, workflow, policy, risk, result), a page action bar, a page metadata line, and a stat grid, replacing the inline styling used for these in the reference screens.
- **FR-014**: The normative design document MUST include a vocabulary glossary mapping `specs/001` concepts (approval, clarification, evidence, gate, override, agent claim, artifact) to design-system components.
- **FR-015**: The package MUST preserve the five core rules of the shipped system: state is always a word in a pill; the "needs a person" colour is reserved for human-required states and the single primary action on a screen; agent claims and platform evidence are visually separated; overrides are never rendered as verified; no sticky headers.

**Codification**

- **FR-016**: The package MUST contain a normative design document in which every rule is phrased as MUST/MUST NOT, each of the five core rules has a do/don't example, and each component lists its accessibility contract.
- **FR-017**: The constitution MUST be amended (minor version) so that the user-experience principle requires use of the design system's tokens and components and requires new visual patterns to be added to the design system before consumption.
- **FR-018**: The plan template MUST gain a design-system compliance section (components used, components proposed, accessibility verification), and the task template MUST gain a pattern for adding a component to the design system.
- **FR-019**: The repository MUST contain a contributor guidance file and an auto-invoked skill that direct anyone doing UI work to the normative design document, the gallery, the state and risk mappings, and the verification commands.
- **FR-020**: The package MUST follow the shipped versioning rule (additive changes minor, renames or removals major with changelog and migration note) and MUST record every change in the changelog.

**Enforcement**

- **FR-021**: Application code outside the design-system package MUST fail a check when it declares a colour, font size, radius or spacing value that is not a design token.
- **FR-022**: Application code MUST fail a check when it sets an inline style, except through an allow-listed mechanism for dynamic values documented in the normative design document.
- **FR-023**: Application code MUST fail a check when an interactive handler is attached to a non-interactive element, an icon-only control lacks a label, or visible focus is removed.
- **FR-024**: Code outside the package MUST fail a check when it uses the design system's reserved class prefix for a class the package does not define.
- **FR-025**: Every gallery entry and reference screen MUST pass automated accessibility scanning and MUST be part of a visual-regression set covering both themes; a change in appearance MUST fail until the baseline is intentionally updated.
- **FR-026**: All checks in FR-007, FR-003 and FR-021 through FR-025 MUST run in continuous integration and MUST be required for merge; each failure message MUST name the violated rule and the sanctioned alternative.

**Architecture document**

- **FR-027**: `docs/architecture.md` MUST be rewritten to describe CDevi, retaining the transferable patterns (single image with multiple start commands, transactional outbox and notification split, row-level tenancy enforcement, single permission check per agent tool call), listing `packages/design-system` in the repository layout in place of `packages/ui`, and containing no references to the unrelated product's data engine, workbooks, billing or repository name.

### Key Entities

- **Design Token**: A named design value (colour, font family, dimension, or semantic alias) with light and dark values where applicable; the unit of the package's public contract.
- **Component**: A reusable UI element exported by the package with a typed interface, rendered classes, an accessibility contract, gallery entry and states.
- **Gallery Entry**: A rendered example of a component with usage, accessibility notes and both themes; the input to accessibility and visual-regression checks.
- **Reference Screen**: A full-page composition of components kept as a pattern reference; explicitly not a definition of CDevi's screens.
- **State Mapping**: The documented relationship between a `specs/001` workflow state or risk level and a component variant.
- **Design Rule**: A MUST/MUST NOT statement in the normative design document, with a do/don't example and, where possible, an enforcing check.
- **Design-System Check**: An automated verification (token drift, contrast, lint, accessibility scan, visual regression) that runs in continuous integration and blocks merge on failure.
- **Version and Changelog Entry**: The package version and the record of what changed, following the additive-minor / breaking-major rule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An AI agent given a `specs/001` screen to implement, with no design-system instructions beyond the repository's standard guidance, produces code that passes all design-system checks on the first CI run in at least 4 of 5 trials.
- **SC-002**: A violation fixture containing one instance of each rule category (non-token value, inline style, non-semantic clickable, missing label, undefined prefixed class, token drift, contrast failure) yields 100% detection — every category fails its check with a message naming the rule and the alternative.
- **SC-003**: 100% of components in the gallery pass automated accessibility scanning and keyboard-only manual operation in both themes.
- **SC-004**: 100% of text/background token pairs used by components meet WCAG 2.2 AA contrast in both themes, as measured by the automated check.
- **SC-005**: All nine workflow states and four risk levels have a mapped, gallery-demonstrated component variant; `BLOCKED`, `WAITING_FOR_HUMAN`, `HIGH` and `CRITICAL` are each identified as "most prominent on the page" by at least 90% of participants in a five-second recognition test.
- **SC-006**: Changing one token value and running the generate command updates every generated output; zero hand edits to generated files are needed, and the drift check catches a stale generated file 100% of the time.
- **SC-007**: A page built from the package makes zero third-party network requests for fonts or styles.
- **SC-008**: The gallery renders all components in under 2 seconds on a mid-range laptop, and the full stylesheet plus font assets transferred on first load stay under 250 KB.
- **SC-009**: A search of the rewritten `docs/architecture.md` for the unrelated product's terms returns zero matches, and every path it cites exists or is reserved by a specification.
- **SC-010**: The constitution, plan template, task template, contributor guidance and skill all reference the same normative design document; a reviewer can locate the design-system obligation from any of them in one hop.

## Assumptions

- The existing token values, component set and five core rules are accepted as the visual foundation; this feature repairs and extends rather than redesigns.
- The application front end will be built with React (per the UI specification's recommended architecture), so React components are the delivery form; the plain CSS layer remains available for non-React surfaces such as emails or static pages.
- The utility framework referenced by the shipped preset (Tailwind) will be used for layout only, restricted to token-backed scales; component appearance comes from the package.
- The reference screens' product concepts (personal API keys, laptop-versus-cloud runtime, per-run budgets, Spec-Kit stepper) are not adopted as CDevi features by this work; if `specs/001` later adds them, their components already exist.
- Contrast repair prefers adjusting the tertiary text token's value; if a value cannot meet 4.5:1 on all surfaces, the alternative is to restrict that token to large or bold text by rule and lint.
- Dynamic values (meter widths, bar heights, progress) are passed through data attributes or component properties that set custom properties; this is the single allow-listed exception to the inline-style rule.
- The package is consumed from the monorepo workspace and is not published to a public registry in this feature.
- Visual-regression baselines are stored in the repository and updated only through an intentional, reviewed change.
- The constitution amendment follows the governance process already defined there (maintainer approval, minor version bump to 1.1.0, amendment date updated, ratification date preserved).
- Numeric performance budgets beyond SC-008 (for example component render cost) will be set in the implementation plan per Principle IV.
- The `.DS_Store` file and any operating-system artifacts in the source folder are excluded from the import.
