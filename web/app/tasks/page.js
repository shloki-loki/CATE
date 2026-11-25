import Link from 'next/link';
import TopBar from '@/components/TopBar';
import { TaskForm } from '@/components/Forms';
import { requireSignIn } from '@/lib/auth';
import { COLUMNS, KINDS, PROVIDERS, loadAll, when } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function Tasks() {
  await requireSignIn();
  const { agents, tasks, conf } = await loadAll();
  const column = (key) => tasks
    .filter((t) => (key === 'failed' ? ['failed', 'blocked'].includes(t.status) : t.status === key))
    .sort((a, b) => (a.priority - b.priority) || String(b.updated_at).localeCompare(String(a.updated_at)));

  return (
    <>
      <TopBar current="/tasks" />
      <main>
        <div className="page-head">
          <h1>Tasks</h1>
          <p>Add work here. Each agent checks in on its schedule (about hourly), takes the best task for it, and another model reviews the result.</p>
        </div>

        <section className="section">
          <div className="board">
            {COLUMNS.map(([key, label]) => {
              const items = column(key);
              return (
                <div key={key} className="column">
                  <h3>{label} · {items.length}</h3>
                  {items.slice(0, key === 'done' ? 12 : 50).map((t) => (
                    <Link key={t.id} href={`/task/${t.id}`} className="ticket">
                      <b>{t.id}</b> {t.title}
                      <span className="meta">
                        {t.kind} · P{t.priority}
                        {t.prefer && t.prefer !== 'any' ? ` · ${PROVIDERS[t.prefer] || t.prefer}` : ''}
                        {t.claimed_by || t.reviewer ? ` · ${t.claimed_by || t.reviewer}` : ''}
                        {t.after?.length && t.status === 'queued' ? ` · after ${t.after.join(', ')}` : ''}
                        {' · '}{when(t.updated_at)}
                      </span>
                    </Link>
                  ))}
                  {!items.length ? <p className="empty" style={{ margin: 4 }}>–</p> : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section" id="new">
          <div className="section-label">New task</div>
          <TaskForm providers={PROVIDERS} agents={agents.map((a) => ({ id: a.id }))} kinds={KINDS} passScore={conf.passScore} />
        </section>
      </main>
    </>
  );
}
