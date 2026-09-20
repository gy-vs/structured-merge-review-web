import { useState } from 'react';
import type { SessionRecord } from '../../shared/types';
import { Home } from './components/Home';
import { Review } from './components/Review';

export function App() {
  const [session, setSession] = useState<SessionRecord | null>(null);

  return session ? (
    <Review
      key={session.id}
      session={session}
      onBack={() => setSession(null)}
    />
  ) : (
    <Home onOpen={setSession} />
  );
}
