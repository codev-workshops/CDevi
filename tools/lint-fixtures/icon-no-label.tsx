// FIXTURE: must fail DR-08 (icon-only control without an accessible name)
export function Bad() {
  return (
    <button type="button">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16v16H4z" />
      </svg>
    </button>
  );
}
