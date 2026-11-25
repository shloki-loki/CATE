import Link from 'next/link';
import TopBar from '@/components/TopBar';
import { requireSignIn } from '@/lib/auth';
import { PROVIDERS, agentState, fmt, limitRows, loadAll, usage, when } from '@/lib/data';
import { WakeButton } from '@/components/Forms';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  await requireSignIn();
  const { agents, tasks, ledger, journal, week } = await loadAll();
  const count = (s) => tasks.filter((t) => t.status === s).length;
  const totalWeek = agents.reduce((sum, a) => sum + usage(ledger, week, a.id).used, 0);
  const recent = journal.slice(-12).reverse();
  const needsYou = tasks.filter((t) => ['failed', 'blocked'].includes(t.status));

  return (
    <>
      <TopBar current="/" />
      <main>
        <div className="page-head">
          <h1>Your AI team</h1>
          <p>Agents start only when there is work for them, take the task that fits them best, and hand it in for review by a different model. Tokens and subscription limits are read from each run ({week}).</p>
        </div>

        {!agents.length ? <div className="banner">No agents yet. <Link prefetch={false} className="link" href="/agents">Add your Claude and ChatGPT accounts</Link> to get started.</div> : null}
        {needsYou.length ? <div className="banner bad">{needsYou.length} task{needsYou.length > 1 ? 's need' : ' needs'} you: {needsYou.slice(0, 3).map((t) => `${t.id} ${t.title}`).join('; ')}. <Link prefetch={false} className="link" href="/tasks">Open tasks</Link></div> : null}

        <section className="section">
          <div className="section-label">Work</div>
          <dl className="kpis">
            <div className="kpi"><dt>Queued</dt><dd>{count('queued')}</dd><span className="hint">waiting for an agent</span></div>
            <div className="kpi"><dt>Working</dt><dd>{count('claimed') + count('reviewing')}</dd><span className="hint">claimed by an agent</span></div>
            <div className="kpi"><dt>Awaiting review</dt><dd>{count('review')}</dd><span className="hint">checked by another model</span></div>
            <div className="kpi good"><dt>Done</dt><dd>{count('done')}</dd><span className="hint">passed review</span></div>
            <div className="kpi"><dt>Tokens this week</dt><dd>{fmt(totalWeek)}</dd><span className="hint">all agents, estimated</span></div>
          </dl>
          <div className="button-row" style={{ marginTop: 10 }}><Link prefetch={false} className="button primary" href="/tasks#new">New task</Link><WakeButton /></div>
        </section>

        <section className="section">
          <div className="section-label">Agents</div>
          {agents.length ? (
            <div className="agents">
              {agents.map((a) => {
                const u = usage(ledger, week, a.id);
                const state = agentState(a, ledger, week);
                const budget = a.weekly_budget_tokens || 0;
                return (
                  <div key={a.id} className="agent">
                    <h3>{a.label || a.id}<span className="prov">{PROVIDERS[a.provider] || a.provider}</span></h3>
                    <div className="sub"><span className={`dot ${state.tone}`} />{state.label}</div>
                    {limitRows(a).map((r) => (
                      <div key={r.label} className="sub" style={{ marginTop: 6 }}>
                        <div className="meter" style={{ marginTop: 2 }}><span style={{ width: `${Math.min(100, r.used)}%` }} /></div>
                        {r.label}: {r.left.toFixed(0)}% left{r.resets ? ` · resets ${when(r.resets)}` : ''}
                      </div>
                    ))}
                    <div className="sub" style={{ marginTop: 6 }}>{fmt(u.used)} tokens this week{u.cached ? ` (+${fmt(u.cached)} cached)` : ''}{budget ? ` of ${fmt(budget)} budget` : ''} · {u.tasks} jobs</div>
                  </div>
                );
              })}
            </div>
          ) : <p className="empty">Agents appear here once added.</p>}
        </section>

        <section className="section">
          <div className="section-label">Latest</div>
          {recent.length ? (
            <ul className="list">
              {recent.map((e) => (
                <li key={e.id}><span className="when">{when(e.at)}</span> <b>{e.by}</b> {e.title}{e.ref ? <> · <Link prefetch={false} className="link" href={`/task/${e.ref}`}>{e.ref}</Link></> : null}{e.detail ? <span className="detail">{e.detail}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="empty">Nothing has happened yet.</p>}
        </section>
      </main>
    </>
  );
}
