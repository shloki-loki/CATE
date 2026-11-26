'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isStaleOrOffline } from '@/lib/safe';

// Shown only if a page itself fails. A dropped connection or a fresh deploy (the usual causes) retries by
// itself; setup advice appears only when the error really is about the GitHub connection.
export default function Error({ error, reset }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const message = String(error?.message || '');
  const transient = isStaleOrOffline(error);
  const setup = /GITHUB_TOKEN|GITHUB_REPO|GitHub read|Could not save|401|403|404/.test(message);

  const retry = () => {
    setTries((n) => n + 1);
    if (/Failed to find Server Action/i.test(message)) { window.location.reload(); return; }
    router.refresh();
    reset();
  };

  useEffect(() => {
    if (!transient || tries >= 2) return undefined;
    const id = setTimeout(retry, 1500 * (tries + 1));
    return () => clearTimeout(id);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page"><div className="page-inner">
      <div className="page-head">
        <h1>{transient ? 'Lost the connection to CATE' : 'Something went wrong'}</h1>
        <p>{transient
          ? (tries < 2 ? 'Reconnecting… This happens when the network drops or CATE was just updated while this tab was open. Nothing was lost.' : 'Still can’t reach CATE. Check your connection, then reload.')
          : message || 'The page could not load.'}</p>
      </div>
      {setup ? (
        <ul className="muted" style={{ marginTop: 16 }}>
          <li>On Vercel, check Settings → Environment Variables: <code className="inline">GITHUB_TOKEN</code> (fine-grained, Contents read/write on the CATE repo), <code className="inline">GITHUB_REPO</code>, <code className="inline">DATA_BRANCH</code> = <code className="inline">data</code>, <code className="inline">SITE_PASSWORD</code>.</li>
          <li>The token may have expired: create a new one and replace it in Vercel, then redeploy.</li>
        </ul>
      ) : null}
      <div className="button-row" style={{ marginTop: 16 }}>
        <button className="button primary" onClick={retry}>Try again</button>
        <button className="button" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    </div></div>
  );
}
