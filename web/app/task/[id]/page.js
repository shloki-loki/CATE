import Link from 'next/link';
import { notFound } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { TaskButtons } from '@/components/Forms';
import { requireSignIn } from '@/lib/auth';
import { PROVIDERS, fmt, loadAll, when } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }) {
  await requireSignIn();
  const { id } = await params;
  const { tasks } = await loadAll();
  const task = tasks.find((t) => t.id === id);
  if (!task) notFound();
  const r = task.result;
  const children = tasks.filter((t) => t.parent === task.id || (t.after || []).includes(task.id));

  return (
    <>
      <TopBar current="/tasks" />
      <main>
        <div className="page-head">
          <p><Link className="link" href="/tasks">← Tasks</Link></p>
          <h1>{task.id} · {task.title}</h1>
          <p>
            <span className="pill tone-ready">{task.status}</span>{' '}
            {task.kind} · priority {task.priority} · {task.prefer === 'any' ? 'any agent' : `${PROVIDERS[task.prefer] || task.prefer} first`}
            {' · '}review: {task.review?.mode || 'none'}{task.review?.mode !== 'none' ? ` (pass ≥ ${task.review?.pass_score})` : ''}
            {' · '}attempts {task.attempts || 0}
            {task.claimed_by ? ` · held by ${task.claimed_by} since ${when(task.claimed_at)}` : ''}
            {task.reviewer ? ` · being reviewed by ${task.reviewer}` : ''}
          </p>
          <TaskButtons id={task.id} status={task.status} hasResult={Boolean(r)} />
        </div>

        <section className="section two">
          <div>
            <div className="section-label">Brief</div>
            <div className="result">{task.brief}</div>
            {task.review?.checks?.length ? (<><div className="section-label" style={{ marginTop: 16 }}>Checks</div><ul>{task.review.checks.map((c) => <li key={c}>{c}</li>)}</ul></>) : null}
            {task.inputs?.length ? (<><div className="section-label" style={{ marginTop: 16 }}>Inputs</div><ul>{task.inputs.map((i) => <li key={i}><code className="inline">{i}</code></li>)}</ul></>) : null}
            {task.after?.length ? <p>Starts after: {task.after.map((a) => <Link key={a} className="link" href={`/task/${a}`}>{a} </Link>)}</p> : null}
            {children.length ? <p>Next: {children.map((c) => <Link key={c.id} className="link" href={`/task/${c.id}`}>{c.id} </Link>)}</p> : null}
          </div>
          <div>
            <div className="section-label">History</div>
            <ul className="list">
              {(task.history || []).slice().reverse().map((h, i) => (
                <li key={i}><span className="when">{when(h.at)}</span> <b>{h.actor}</b> {h.event}{h.detail ? <span className="detail">{h.detail}</span> : null}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="section-label">Result {r ? `· by ${r.by}, ${when(r.at)} · ${fmt((r.tokens_in || 0) + (r.tokens_out || 0))} tokens` : ''}</div>
          {r ? <div className="result">{r.text}</div> : <p className="empty">Nothing handed in yet.</p>}
        </section>

        {task.reviews?.length ? (
          <section className="section">
            <div className="section-label">Reviews</div>
            {task.reviews.slice().reverse().map((rv, i) => (
              <details key={i} className="box" open={i === 0}>
                <summary>{rv.verdict === 'pass' ? '✓ Passed' : '✗ Sent back'} · score {rv.score} · {rv.by} · {when(rv.at)}</summary>
                <div className="result" style={{ marginTop: 10 }}>{rv.notes}</div>
              </details>
            ))}
          </section>
        ) : null}
      </main>
    </>
  );
}
