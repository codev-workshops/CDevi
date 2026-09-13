// FIXTURE: must fail DR-09 (cd- class that the design system does not define)
export function Bad() {
  return <span className="cd-pill cd-sparkle">shiny</span>;
}
