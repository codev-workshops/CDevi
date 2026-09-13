// FIXTURE: must fail DR-08 (click handler on a non-interactive element)
export function Bad({ onApprove }: { onApprove: () => void }) {
  return <div onClick={onApprove}>Approve</div>;
}
