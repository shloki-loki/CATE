import Link from 'next/link';
import { MenuButton } from '@/components/AppFrame';
import { loadAll, when } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Logs() {
  const { journal, tasks } = await loadAll();
  const chatOf = Object.fromEntries(tasks.map((t) => [t.id, t.chat]));
  const entries = journal.slice(-400).reverse();
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head" style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
          <MenuButton />
          <div><h1>Logs</h1><p>Every run, hand-in, review, hand-back and change, newest first.</p></div>
        </div>
        <div className="section table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td title={e.at} style={{ whiteSpace: 'nowrap' }} className="faint">{when(e.at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{e.by}</td>
                  <td>{e.title}{e.ref && chatOf[e.ref] ? <> · <Link prefetch={false} className="link" href={`/c/${chatOf[e.ref]}`}>open project</Link></> : null}</td>
                  <td className="muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
