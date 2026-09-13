# Reference screens — pattern references only

These static pages were shipped with the original design system as full-screen compositions. They are kept as **pattern references**: examples of how components combine, how density and hierarchy should feel, and how the five core rules (see `../DESIGN.md` §2) look in practice.

They do **not** define CDevi's screens, navigation, or product vocabulary. The screen inventory and navigation for CDevi come from `docs/SDLC Control Plane — High-Level UI Specification.md` and `specs/001-sdlc-control-plane-mvp/spec.md`. Concepts shown here that are not in those documents (personal API keys, laptop vs cloud runtime, per-run budgets, Spec Kit stepper) are not CDevi features unless a specification adopts them.

Rules for this folder:

- Pages load only `../css/cdevi.css` (fonts are self-hosted through it) and `demo.css`; no third-party requests.
- Interactive elements must be real `<button>`, `<a>`, or `role="tab"` elements so page-level accessibility scans pass.
- These pages are part of the visual-regression baseline (`tests/visual/reference-screens.spec.ts`). A change in appearance fails CI until baselines are updated intentionally.
- Do not copy markup from here into application code; use the React components exported by `@cdevi/design-system`.
