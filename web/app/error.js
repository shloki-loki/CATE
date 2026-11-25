'use client';

export default function Error({ error, reset }) {
  return (
    <main>
      <div className="page-head">
        <h1>Something went wrong</h1>
        <p>{error?.message || 'The page could not load.'}</p>
      </div>
      <ul>
        <li>On Vercel, check these exist in Settings → Environment Variables: <code>GITHUB_TOKEN</code> (a fine-grained token with Contents read/write on the CATE repo), <code>GITHUB_REPO</code> (e.g. <code>shloki-loki/CATE</code>), <code>DATA_BRANCH</code> = <code>data</code>, and <code>SITE_PASSWORD</code>.</li>
        <li>The <code>data</code> branch must exist: run <code>bash scripts/setup_data.sh</code> once (SETUP.md).</li>
      </ul>
      <button className="button" onClick={() => reset()}>Try again</button>
    </main>
  );
}
