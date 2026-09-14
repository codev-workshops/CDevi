import { Button, Card, FocusLayout } from '../lib/ds';

export default function NotFound() {
  return (
    <FocusLayout>
      <h1>Page not found</h1>
      <Card>
        <p>There is nothing at this address.</p>
      </Card>
      <Button variant="ghost" href="/inbox">
        Back to Inbox
      </Button>
    </FocusLayout>
  );
}
