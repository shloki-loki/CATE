'use client';

import { useActionState, useState, useTransition } from 'react';
import { addAgent, removeAgent, setAgent, wakeNow } from '@/app/actions';
import { Limit } from '@/components/Chat';

const KIND_LABELS = { plan: 'Planning', research: 'Research', write: 'Writing', code: 'Development', review: 'Review', data: 'Data', other: 'Other' };

function Feedback({ state }) {
  if (!state) return null;
  return <span className={`feedback ${state.ok === false ? 'bad' : ''}`} role="status">{state.error || state.message || 'Saved.'}</span>;
}

function Score({ value }) {
  return <span className="score" title={`${value}/5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}</span>;
}

function Connect({ agent, repo }) {
  const url = `https://github.com/${repo}/settings/secrets/actions/new`;
  const save = <li>Open <a className="link" href={url} target="_blank" rel="noreferrer">GitHub → Secrets → New repository secret</a>, name it <code className="inline">{agent.secret}</code>, paste, save. Never paste it into a chat.</li>;
  if (agent.runner === 'claude-actions') return (
    <ol className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
      <li>On your Mac, in Terminal: <code className="inline">npm install -g @anthropic-ai/claude-code</code></li>
      <li>Run <code className="inline">claude setup-token</code> and sign in with this Claude account. Copy the token it prints.</li>
      {save}
      <li>Press <b>Resume</b> on this card.</li>
    </ol>
  );
  if (agent.runner === 'codex-actions') return (
    <ol className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
      <li><code className="inline">npm install -g @openai/codex</code></li>
      <li><code className="inline">mkdir -p ~/.codex &amp;&amp; echo &apos;cli_auth_credentials_store = &quot;file&quot;&apos; &gt;&gt; ~/.codex/config.toml</code></li>
      <li><code className="inline">codex logout; codex login</code> and sign in with this ChatGPT account.</li>
      <li><code className="inline">pbcopy &lt; ~/.codex/auth.json</code></li>
      {save}
      <li>Press <b>Resume</b> on this card.</li>
    </ol>
  );
  return (
    <ol className="muted" style={{ fontSize: 13, paddingLeft: 20 }}>
      <li>Get a free key{agent.keyUrl ? <> at <a className="link" href={agent.keyUrl} target="_blank" rel="noreferrer">{agent.keyUrl.replace('https://', '')}</a></> : ''}.</li>
      {save}
      <li>Press <b>Resume</b> on this card. To also use it as the instant chat supervisor, add the same key in Vercel → Settings → Environment Variables as <code className="inline">{agent.secret}</code>.</li>
    </ol>
  );
}

function AgentCard({ agent, catalogModels, usage, repo }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  const [enabled, setEnabled] = useState(agent.models);
  const [budget, setBudget] = useState(agent.budget || 0);
  const run = (changes) => start(async () => setState(await setAgent(agent.id, changes)));
  const toggle = (id) => {
    const next = enabled.includes(id) ? enabled.filter((m) => m !== id) : [...enabled, id];
    if (!next.length) return;
    setEnabled(next);
    run({ models: next });
  };
  const notConnected = agent.status === 'paused' && agent.note;
  return (
    <div className="card agent-card">
      <div className="agent-top">
        <h3>{agent.label} <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>· {agent.id}</span></h3>
        <span className="pill">{agent.planLabel}</span>
        {notConnected ? <span className="pill bad">Not connected</span> : agent.status === 'paused' ? <span className="pill warn">Paused</span> : <span className="pill ok">Connected</span>}
        {agent.status === 'paused'
          ? <button className="button small primary" disabled={pending} onClick={() => run({ status: 'active' })}>Resume</button>
          : <button className="button small" disabled={pending} onClick={() => run({ status: 'paused' })}>Pause</button>}
      </div>
      {notConnected ? <div className="banner warn" style={{ marginTop: 0 }}>{agent.note}</div> : null}
      <div className="agent-grid">
        <div>
          <div className="section-label">Limits left</div>
          <div className="limits">
            {usage?.windows.map((w) => <Limit key={w.label} w={w} />)}
            {usage?.budgetLeft !== null && usage?.budgetLeft !== undefined ? <Limit w={{ label: 'Budget', left: usage.budgetLeft, detail: `${usage.tokens.toLocaleString()} tokens this week` }} /> : null}
            {!usage?.windows.length ? <span className="faint" style={{ fontSize: 12.5 }}>{agent.runner === 'api' ? 'Daily allowance appears once known.' : 'Shown after its next run.'}</span> : null}
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{usage?.jobs || 0} jobs this week{usage?.readingAt ? ` · reading from ${new Date(usage.readingAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
          <div className="button-row" style={{ marginTop: 10 }}>
            <label className="faint" style={{ fontSize: 12.5 }}>Weekly token budget</label>
            <input className="select" style={{ width: 120, padding: '4px 8px' }} type="number" min="0" step="50000" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Weekly token budget" />
            <button className="button small" disabled={pending} onClick={() => run({ budget })}>Set</button>
          </div>
          <span className="faint" style={{ fontSize: 11.5 }}>0 = no cap; the plan’s own limits still apply.</span>
        </div>
        <div>
          <div className="section-label">Models it may use</div>
          <div className="model-toggles">
            {catalogModels.map((m) => (
              <label key={m.id} className="toggle">
                <input type="checkbox" checked={enabled.includes(m.id)} onChange={() => toggle(m.id)} disabled={pending} />
                <span>{m.label}{m.paid_credits ? <span className="pill warn" style={{ marginLeft: 6 }}>uses paid credits</span> : null}<span className="d">{m.note}</span></span>
                <span className="faint" style={{ fontSize: 11.5 }}>{m.weight ? `uses limits ×${m.weight}` : 'free'}</span>
              </label>
            ))}
          </div>
          <div className="section-label" style={{ marginTop: 14 }}>Which model for which job</div>
          <div className="roles">
            {Object.entries(KIND_LABELS).map(([kind, label]) => (
              <FragmentRole key={kind} kind={kind} label={label} agent={agent} enabled={enabled} catalogModels={catalogModels} onChange={(model) => run({ role: { kind, model } })} disabled={pending} />
            ))}
          </div>
        </div>
      </div>
      <details className="box"><summary>Connect / reconnect</summary><Connect agent={agent} repo={repo} /></details>
      <div className="button-row">
        <Feedback state={state} />
        <span style={{ flex: 1 }} />
        <button className="button small ghost danger" disabled={pending} onClick={() => { if (confirm(`Remove ${agent.label}? Its history stays in the logs.`)) start(async () => setState(await removeAgent(agent.id))); }}>Remove</button>
      </div>
    </div>
  );
}

function FragmentRole({ kind, label, agent, enabled, catalogModels, onChange, disabled }) {
  const auto = agent.defaults[kind];
  const name = (id) => catalogModels.find((m) => m.id === id)?.label || id;
  return (
    <>
      <span className="muted">{label}</span>
      <select value={agent.roles?.[kind] || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Auto (now: {name(auto)})</option>
        {enabled.map((m) => <option key={m} value={m}>{name(m)}</option>)}
      </select>
    </>
  );
}

function AddConnection({ presets }) {
  const [state, action, pending] = useActionState(addAgent, null);
  const [runner, setRunner] = useState('claude-actions');
  return (
    <form action={action} className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <label className="field">Type
          <select name="runner" value={runner} onChange={(e) => setRunner(e.target.value)}>
            <option value="claude-actions">Claude subscription (Pro / Max)</option>
            <option value="codex-actions">ChatGPT subscription (Plus / Pro)</option>
            <option value="api">Free API key</option>
          </select>
        </label>
        {runner === 'api' ? (
          <label className="field">Free API
            <select name="preset" defaultValue="groq">{Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label} · {p.free}</option>)}</select>
          </label>
        ) : null}
        <label className="field">Short name<input name="id" required pattern="[a-z0-9-]+" placeholder={runner === 'api' ? 'free-groq' : runner === 'codex-actions' ? 'gpt-2' : 'claude-3'} /></label>
        <label className="field">Display name<input name="label" placeholder={runner === 'api' ? 'Groq (free)' : 'Claude Pro · account 3'} /></label>
      </div>
      <div className="button-row"><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add connection'}</button><Feedback state={state} /></div>
    </form>
  );
}

export default function ModelsPanel({ agents, providers, usage, presets, repo }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  return (
    <>
      <div className="section">
        <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Connections</span>
          <span className="button-row"><button className="button small" disabled={pending} onClick={() => start(async () => setState(await wakeNow()))}>Wake agents with work</button><Feedback state={state} /></span>
        </div>
        <div className="cards">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} repo={repo} usage={usage.find((u) => u.id === a.id)} catalogModels={providers[a.provider]?.models || []} />
          ))}
        </div>
      </div>
      <div className="section" id="add">
        <div className="section-label">Add a connection</div>
        <AddConnection presets={presets} />
      </div>
    </>
  );
}

export { Score };
