// FIXTURE: must fail DR-07 (inline style)
export function Bad() {
  return <div style={{ color: 'red' }}>needs you</div>;
}
