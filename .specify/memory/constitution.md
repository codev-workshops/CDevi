<!--
Sync Impact Report
Version change: 1.0.0 -> 1.1.0 (MINOR: expanded obligations under Principle III)
Modified principles:
- III. Consistent and Accessible User Experience: adds two bullets making @cdevi/design-system
  tokens and components mandatory and requiring new visual patterns to land in the package first
Added sections: none
Removed sections: none
Templates synchronized:
- .specify/templates/plan-template.md: added "Design System Compliance" section
- .specify/templates/tasks-template.md: tests now REQUIRED; added design-system component task pattern
Related artifacts: packages/design-system/DESIGN.md (normative rules), AGENTS.md,
.devin/skills/cdevi-design-system/SKILL.md, specs/002-adopt-design-system
Deferred TODOs: none
History: 1.0.0 ratified 2026-09-11 (initial adoption of principles I-IV, Quality Requirements,
Development Workflow and Review, Governance)
-->

# CDevi Constitution

## Core Principles

### I. Maintainable Code Quality

- Changes MUST follow the project's established language, formatting, naming, and architectural
  conventions. Where no convention exists, the implementation plan MUST establish one before coding.
- Modules MUST have a cohesive responsibility and explicit interfaces. Implementations MUST favor
  the simplest design that meets current requirements; new abstractions, dependencies, and
  architectural exceptions MUST include a documented justification in the plan or pull request.
- Changes MUST pass the configured formatter, linter, type checks where applicable, and build.
  New code MUST NOT introduce warnings or suppress checks without an approved, scoped exception.
- External input MUST be validated at trust boundaries. Failures MUST be handled explicitly, and
  diagnostics MUST NOT expose credentials, secrets, or sensitive user data.
- Behavioral or interface changes MUST update affected documentation and contracts in the same
  change. Obsolete code introduced or superseded by that change MUST NOT be left behind.

Rationale: Readable, cohesive code and automated checks reduce defects and maintenance costs.

### II. Risk-Based, Reliable Testing

- Every behavior change MUST include automated tests that fail without the intended behavior and
  pass with it. Bug fixes MUST begin with a reproducing regression test before the fix is applied.
- Tests MUST cover acceptance criteria, relevant boundary conditions, and failure paths. Unit tests
  MUST cover business logic; integration or contract tests MUST cover changed system boundaries;
  end-to-end tests MUST cover new or changed critical user journeys.
- Tests MUST be deterministic, isolated, and repeatable. External services, time, randomness, and
  shared state MUST be controlled; live dependencies MUST be confined to explicitly identified
  integration suites with reproducible setup and cleanup.
- Required tests MUST pass before merge. Flaky tests MUST NOT be hidden by retries or silent skips;
  any quarantine MUST have maintainer approval, an owner, an expiry, and replacement verification
  for the affected behavior.
- Test selection MUST follow risk and behavior, not a coverage percentage alone. Untested paths
  in changed code MUST be identified and justified during review; critical behavior MUST NOT
  be accepted solely on manual verification.

Rationale: Tests provide evidence of correctness only when they exercise meaningful behavior and
produce trustworthy results.

### III. Consistent and Accessible User Experience

- User-facing changes MUST reuse established components, terminology, navigation, interaction
  patterns, and design tokens. A new pattern MUST be justified and reviewed before adoption.
- Every affected flow MUST define applicable loading, empty, success, error, and disabled states.
  Messages MUST use consistent language, explain failures without leaking internals, and provide
  an actionable next step when recovery is possible.
- Web interfaces MUST meet WCAG 2.2 AA for changed experiences, including keyboard operation,
  visible focus, semantic labeling, and contrast. Other interfaces MUST follow the accessibility
  conventions of their platform and document their verification criteria.
- UI changes MUST be checked on the supported viewport sizes and input methods. Critical flows
  MUST include automated accessibility checks plus manual keyboard and assistive-technology
  verification where automated checks cannot establish compliance.
- Destructive actions MUST require explicit confirmation or provide a reliable undo. Recoverable
  failures MUST preserve user input. Breaking changes to established workflows MUST include a
  migration or communication plan.
- User interfaces MUST be built from `@cdevi/design-system` tokens and components as specified in
  `packages/design-system/DESIGN.md`. Application code MUST NOT declare colours, typography,
  spacing, radii or shadows outside those tokens, MUST NOT use inline styles, and MUST NOT
  reference design-system class names the package does not define.
- A new visual pattern MUST be added to the design-system package first (component, test, gallery
  entry, accessibility contract, changelog entry) and only then consumed by an application. Plans
  MUST list the design-system components they use and any they propose.

Rationale: Predictable, accessible behavior is part of correctness, not optional visual polish.

### IV. Measurable Performance

- Before implementation, each feature plan MUST define numeric budgets for its performance-critical
  paths. Each budget MUST name the metric, threshold, workload or data size, measurement environment,
  and verification method. Any claim that performance is not applicable MUST be justified in review.
- Budgets MUST cover applicable user-visible latency, throughput, and resource limits. Request or
  interaction latency MUST include a tail percentile such as p95; batch work MUST define completion
  time and dataset size. Memory, payload, startup, and storage limits MUST be included where relevant.
- Performance-sensitive changes MUST be benchmarked against the accepted baseline under comparable
  conditions. Results MUST satisfy both the numeric budget and any regression tolerance declared
  in the plan. Without a declared tolerance, a repeatable regression MUST block merge pending review.
- Operations over growing datasets MUST use explicit bounds, pagination, batching, or justified
  alternatives. Remote calls MUST have timeouts and bounded retries; concurrency MUST be limited
  according to the resource budget.
- Deployed performance-critical paths MUST expose measurements sufficient to verify their budgets
  without recording sensitive data. Optimization MUST follow profiling or benchmark evidence and
  MUST preserve correctness and user experience.

Rationale: Explicit budgets and reproducible measurements make performance an acceptance criterion
rather than an assumption.

## Quality Requirements

Every feature specification and implementation plan MUST identify:

- Testable acceptance criteria, critical user journeys, and relevant failure scenarios.
- Applicable code conventions, system boundaries, and compatibility requirements.
- Supported user interfaces, platforms, accessibility criteria, and interaction states.
- Numeric performance budgets and the workloads used to verify them.
- Required automated checks, manual verification, and evidence needed for acceptance.

A requirement marked not applicable MUST include a rationale approved during review. Missing
requirements MUST be resolved before implementation, not deferred until release. The first
implementation for a stack MUST establish reproducible build, lint, and test commands and configure
continuous integration to run its required automated checks before merge.

## Development Workflow and Review

1. Define acceptance criteria and quality requirements in the specification; record architecture,
   testing strategy, UX decisions, performance budgets, and a constitution check in the plan.
2. Break work into reviewable tasks that include implementation and its verification. For bug fixes,
   reproduce the failure with a regression test before changing production behavior.
3. Implement the smallest coherent change and run relevant checks during development. Before merge,
   run all required checks and attach test, accessibility, and benchmark evidence as applicable.
4. A maintainer MUST review correctness, maintainability, test adequacy, UX consistency, security,
   and performance compliance. Required checks MUST pass; unresolved violations MUST block merge
   unless covered by an approved exception under Governance.
5. Before release, verify critical journeys and applicable budgets in a representative environment.
   User-visible or operationally risky changes MUST include a rollback or recovery procedure.

## Governance

This constitution takes precedence over conflicting local conventions, templates, plans, and task
lists. Specifications, plans, implementation reviews, and release reviews MUST check compliance with
all four principles and record either evidence or an approved exception for each applicable rule.

Amendments MUST be proposed as a reviewed change describing the rationale, affected principles,
compatibility impact, and any migration work. A project maintainer MUST approve the amendment before
it takes effect. The amendment MUST update the version and last-amended date while preserving the
original ratification date.

Versioning MUST follow semantic versioning: MAJOR for incompatible removals or redefinitions of
principles or governance; MINOR for new principles, sections, or materially expanded obligations;
PATCH for clarifications and corrections that do not change obligations.

Exceptions MUST be explicit, narrowly scoped, and approved by a maintainer before merge. Each MUST
record the violated rule, justification, risk, compensating verification, accountable owner,
remediation task, and expiry date. Expired exceptions MUST block affected merges or releases until
resolved or explicitly renewed through review. Exceptions MUST NOT silently redefine a principle;
permanent policy changes require an amendment.

**Version**: 1.1.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
