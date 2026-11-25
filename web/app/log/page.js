import Link from 'next/link';
import TopBar from '@/components/TopBar';
import { requireSignIn } from '@/lib/auth';
import { loadAll, when } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Log() {
  await requireSignIn();
  const { journal } = await loadAll();
  const entries = journal.slice(-300).reverse();
  return (
    <>
      <TopBar current="/log" />
      <main>
        <div className="page-head">
          <h1>Log</h1>
          <p>Every check-in, claim, hand-in, review and fix, newest first.</p>
        </div>
        <section className="section">
          {entries.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td title={e.at}>{when(e.at)}</td>
                      <td>{e.by}</td>
                      <td>{e.title}{e.ref ? <> · <Link prefetch={false} className="link" href={`/task/${e.ref}`}>{e.ref}</Link></> : null}</td>
                      <td>{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">Nothing yet.</p>}
        </section>
      </main>
    </>
  );
}
