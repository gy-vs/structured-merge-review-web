import { useEffect, useState } from 'react';
import Home from './components/Home';
import Review from './components/Review';

function parseHash(): { view: 'home' } | { view: 'review'; id: string } {
  const m = /^#\/session\/(.+)$/.exec(window.location.hash);
  return m ? { view: 'review', id: decodeURIComponent(m[1]) } : { view: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route.view === 'review' ? <Review sessionId={route.id} /> : <Home />;
}
