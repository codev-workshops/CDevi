import { redirect } from 'next/navigation';

/** The Inbox is the home page (FR-001); the app layout redirects to sign-in when there is no session. */
export default function Home() {
  redirect('/inbox');
}
