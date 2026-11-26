'use client';

import { useActionState, useState, useTransition } from 'react';
import { addAgent, removeAgent, setAgent, wakeNow } from '@/app/actions';
import { Limit } from '@/components/Chat';
import { statusOf } from '@/lib/status';

const KIND_LABELS = { plan: 'Planning', research: 'Research', write: 'Writing', code: 'Development', review: 'Review', data: 'Data', other: 'Other' };

function Feedback({ state }) {
  if (!state) return null;
  return <span className={`feedback ${state.ok === false ? 'bad' : ''}`} role="status">{state.error || state.message || 'Saved.'}</span>;
}

function Score({ value }) {
  return <span className="score" title={`${value}/5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}</span>;
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="button small ghost copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }} aria-label={`Copy ${text}`}>{done ? 'Copied' : label}</button>
  );
}

function SecretName({ name }) {
  return <span className="secret"><code className="inline">{name}</code><CopyButton text={name} /></span>;
}

const PROVIDER_MARK = { anthropic: 'CL', openai: 'GPT', google: 'GE', groq: 'GQ', xai: 'XA', deepseek: 'DS', perplexity: 'PX', local: 'LO' };
const monogram = (agent) => PROVIDER_MARK[agent.provider]
  || (agent.label || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function Connect({ agent, repo }) {
  const url = `https://github.com/${repo}/settings/secrets/actions/new`;
  const save = <li>Open <a className="link" href={url} target="_blank" rel="noreferrer">GitHub → Secrets → New repository secret</a>, name it <SecretName name={agent.secret} />, paste, save. Never paste it into a chat.</li>;
  if (agent.runner === 'claude-actions') return (
    <ol className="steps-list">
      <li>On your computer, in a terminal: <code className="inline">npm install -g @anthropic-ai/claude-code</code></li>
      <li>Run <code className="inline">claude setup-token</code> and sign in with this Claude account. Copy the token it prints.</li>
      {save}
      <li>Press <b>Resume</b> on this card.</li>
    </ol>
  );
  if (agent.runner === 'codex-actions') return (
    <ol className="steps-list">
      <li><code className="inline">npm install -g @openai/codex</code></li>
      <li><code className="inline">mkdir -p ~/.codex &amp;&amp; echo &apos;cli_auth_credentials_store = &quot;file&quot;&apos; &gt;&gt; ~/.codex/config.toml</code></li>
      <li><code className="inline">codex logout; codex login</code> and sign in with this ChatGPT account.</li>
      <li><code className="inline">pbcopy &lt; ~/.codex/auth.json</code> (macOS; on other systems copy the file’s contents)</li>
      {save}
      <li>Press <b>Resume</b> on this card.</li>
    </ol>
  );
  return (
    <ol className="steps-list">
      <li>Get a key{agent.keyUrl ? <> at <a className="link" href={agent.keyUrl} target="_blank" rel="noreferrer">{agent.keyUrl.replace('https://', '')} ↗</a></> : ''}.</li>
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
  const st = statusOf(agent);
  const name = (id) => catalogModels.find((m) => m.id === id)?.label || id;
  const overrides = Object.entries(agent.roles || {}).filter(([, m]) => m && enabled.includes(m));
  return (
    <article className="conn" id={`agent-${agent.id}`} data-status={st.key}>
      <div className="conn-head">
        <span className="monogram" aria-hidden="true">{monogram(agent)}</span>
        <div className="name"><b title={agent.label}>{agent.label}</b><small>{agent.id} · {agent.planLabel}</small></div>
        <span className={`status ${st.key}`}>{st.word}</span>
      </div>

      {st.key === 'bad' ? <div className="banner warn compact">{agent.note}</div> : null}

      <div className="limits">
        {usage?.windows.map((w) => <Limit key={w.label} w={w} />)}
        {usage?.budgetLeft !== null && usage?.budgetLeft !== undefined ? <Limit w={{ label: 'Budget', left: usage.budgetLeft, detail: `${usage.tokens.toLocaleString()} tokens this week` }} /> : null}
        {!usage?.windows.length && (usage?.budgetLeft === null || usage?.budgetLeft === undefined) ? <span className="faint small-text">{agent.runner === 'api' ? 'Daily allowance appears once known.' : 'Limits appear after its next run.'}</span> : null}
      </div>

      <div className="conn-summary">
        <span className="num">{enabled.length}</span> model{enabled.length === 1 ? '' : 's'} on · <span className="num">{usage?.jobs || 0}</span> job{usage?.jobs === 1 ? '' : 's'} this week
        {overrides.length ? <> · {overrides.map(([k, m]) => `${KIND_LABELS[k]} → ${name(m)}`).join(' · ')}</> : null}
      </div>

      {st.key === 'bad' ? (
        <details className="conn-section" open>
          <summary>Finish connecting</summary>
          <Connect agent={agent} repo={repo} />
        </details>
      ) : null}

      <details className="conn-section">
        <summary>Configure models and jobs</summary>
        <div className="sub-label">Models it may use</div>
        <div className="model-toggles">
          {catalogModels.map((m) => (
            <label key={m.id} className="toggle">
              <input type="checkbox" checked={enabled.includes(m.id)} onChange={() => toggle(m.id)} disabled={pending} />
              <span>{m.label}{m.paid_credits ? <span className="pill warn" style={{ marginLeft: 6 }}>uses paid credits</span> : null}<span className="d">{m.note}</span></span>
              <span className="faint small-text num">{m.weight ? `limits ×${m.weight}` : 'free'}</span>
            </label>
          ))}
          {!catalogModels.length ? <span className="faint small-text">No models listed for this provider in config/models.json.</span> : null}
        </div>
        <div className="sub-label">Which model for which job</div>
        <div className="roles">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <FragmentRole key={kind} kind={kind} label={label} agent={agent} enabled={enabled} name={name} onChange={(model) => run({ role: { kind, model } })} disabled={pending} />
          ))}
        </div>
        <div className="sub-label">Weekly token budget</div>
        <div className="button-row">
          <input className="select num" style={{ width: 140 }} type="number" min="0" step="50000" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Weekly token budget" />
          <button className="button small" disabled={pending} onClick={() => run({ budget })}>Set</button>
          <span className="faint small-text">0 = no cap; the plan’s own limits still apply.</span>
        </div>
      </details>

      {st.key !== 'bad' ? (
        <details className="conn-section">
          <summary>Reconnect</summary>
          <Connect agent={agent} repo={repo} />
        </details>
      ) : null}

      <div className="conn-foot">
        {agent.status === 'paused'
          ? <button className="button small primary" disabled={pending} onClick={() => run({ status: 'active' })}>{st.key === 'bad' ? 'Done: resume' : 'Resume'}</button>
          : <button className="button small" disabled={pending} onClick={() => run({ status: 'paused' })}>Pause</button>}
        <Feedback state={state} />
        <span style={{ flex: 1 }} />
        <button className="button small ghost danger" disabled={pending} onClick={() => { if (confirm(`Remove ${agent.label}? Its history stays in the logs.`)) start(async () => setState(await removeAgent(agent.id))); }}>Remove</button>
      </div>
    </article>
  );
}

function FragmentRole({ kind, label, agent, enabled, name, onChange, disabled }) {
  const auto = agent.defaults[kind];
  return (
    <>
      <span className="muted">{label}</span>
      <select value={agent.roles?.[kind] || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={`Model for ${label}`}>
        <option value="">Auto (now: {name(auto)})</option>
        {enabled.map((m) => <option key={m} value={m}>{name(m)}</option>)}
      </select>
    </>
  );
}

const TYPES = [
  { runner: 'claude-actions', title: 'Claude subscription', sub: 'Pro or Max plan', id: 'claude-3', label: 'Claude Pro · account 3', secret: 'CLAUDE_TOKEN_<NAME>' },
  { runner: 'codex-actions', title: 'ChatGPT subscription', sub: 'Plus or Pro plan', id: 'gpt-2', label: 'ChatGPT Pro · account 2', secret: 'CODEX_AUTH_<NAME>' },
  { runner: 'api', title: 'API key', sub: 'Groq, Gemini, OpenRouter, Mistral, Cerebras, DeepSeek', id: 'free-groq', label: 'Groq (free)' },
];

// "Add a model or API": three steps in one form. Step 1 picks the type, step 2 the API (for keys), step 3 names it.
function AddConnection({ presets, repo }) {
  const [state, action, pending] = useActionState(addAgent, null);
  const [runner, setRunner] = useState('claude-actions');
  const [preset, setPreset] = useState('groq');
  const type = TYPES.find((t) => t.runner === runner);
  const p = presets[preset];
  const placeholderId = runner === 'api' ? `free-${preset}` : type.id;
  const placeholderLabel = runner === 'api' ? `${p?.label || 'API'} (free)` : type.label;
  return (
    <form action={action} className="add-form">
      <input type="hidden" name="runner" value={runner} />
      {runner === 'api' ? <input type="hidden" name="preset" value={preset} /> : null}

      <fieldset className="add-step">
        <legend><span className="step-no">1</span> What are you adding?</legend>
        <div className="option-grid three" role="radiogroup" aria-label="Type">
          {TYPES.map((t) => (
            <button type="button" key={t.runner} role="radio" aria-checked={runner === t.runner} className="option" onClick={() => setRunner(t.runner)}>
              <b>{t.title}</b><span>{t.sub}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {runner === 'api' ? (
        <fieldset className="add-step">
          <legend><span className="step-no">2</span> Which API?</legend>
          <div className="option-grid" role="radiogroup" aria-label="API">
            {Object.entries(presets).map(([k, x]) => (
              <div key={k} role="radio" tabIndex={0} aria-checked={preset === k} className="option" onClick={() => setPreset(k)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreset(k); } }}>
                <b>{x.label}</b>
                <span className="num">{x.free}</span>
                <span className="faint">{x.note}</span>
                <span className="option-foot"><a className="link" href={x.key} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Get a key ↗</a><code className="inline">{x.secret}</code></span>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="add-step">
        <legend><span className="step-no">{runner === 'api' ? 3 : 2}</span> Name it</legend>
        <div className="row">
          <label className="field">Short name (lowercase, digits, dashes)<input name="id" required pattern="[a-z0-9-]+" placeholder={placeholderId} /></label>
          <label className="field">Display name<input name="label" placeholder={placeholderLabel} /></label>
        </div>
      </fieldset>

      <fieldset className="add-step">
        <legend><span className="step-no">{runner === 'api' ? 4 : 3}</span> Connect it</legend>
        <p className="muted small-text" style={{ margin: 0 }}>
          After you press <b>Add connection</b>, a new card appears under <a className="link" href="#connections">Connections</a> with the exact steps: get the {runner === 'api' ? 'key' : 'token'},
          save it in <a className="link" href={`https://github.com/${repo}/settings/secrets/actions/new`} target="_blank" rel="noreferrer">GitHub → Secrets ↗</a>
          {runner === 'api' && p ? <> as <SecretName name={p.secret} /></> : <> under the name shown on the card (for example <code className="inline">{type.secret}</code>)</>}, then press <b>Resume</b>.
        </p>
      </fieldset>

      <div className="button-row"><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add connection'}</button><Feedback state={state} /></div>
    </form>
  );
}

export function AddSection({ presets, repo }) {
  const catalogUrl = `https://github.com/${repo}/blob/main/config/models.json`;
  return (
    <section className="section" id="add" aria-labelledby="add-title">
      <div className="section-head">
        <h2 id="add-title">Add a model or API</h2>
        <p>Connect another subscription or API key, or add a new model to the list CATE chooses from.</p>
      </div>
      <div className="add-layout">
        <div className="card"><AddConnection presets={presets} repo={repo} /></div>
        <aside className="card add-help">
          <h3>Add a new model to an existing provider</h3>
          <p className="muted small-text">The models each provider offers, and what each is best at, live in <a className="link" href={catalogUrl} target="_blank" rel="noreferrer">config/models.json ↗</a> on <code className="inline">main</code>.</p>
          <ol className="steps-list">
            <li>Ask in the chat, for example: “Add <i>model name</i> to the CATE model catalog with its scores and sources”. An agent edits the file and opens a pull request.</li>
            <li>Or edit the file yourself: copy an existing model entry under the right provider and change <code className="inline">id</code>, <code className="inline">label</code>, <code className="inline">scores</code> (1–5 per job) and <code className="inline">weight</code>.</li>
            <li>Merge the pull request. Then tick the new model under <b>Configure</b> on each card that should use it.</li>
          </ol>
          <h3>A provider that isn’t listed?</h3>
          <p className="muted small-text">API keys are limited to the providers in step 2 for now. Ask in the chat for a new provider to be added; it is a small code change to <code className="inline">cate/api_agent.py</code> and <code className="inline">web/lib/data.js</code>, done by pull request.</p>
        </aside>
      </div>
    </section>
  );
}

export default function ModelsPanel({ agents, providers, usage, repo }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  return (
    <section className="section" id="connections" aria-labelledby="conn-title">
      <div className="section-head row-head">
        <div><h2 id="conn-title">Connections</h2><p>Each card is one account or API key. Open <b>Configure</b> to choose its models and which job each model does.</p></div>
        <span className="button-row"><button className="button small" disabled={pending} onClick={() => start(async () => setState(await wakeNow()))}>Wake agents with work</button><Feedback state={state} /></span>
      </div>
      {agents.length ? (
        <div className="conn-grid">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} repo={repo} usage={usage.find((u) => u.id === a.id)} catalogModels={providers[a.provider]?.models || []} />
          ))}
        </div>
      ) : (
        <div className="card empty">No connections yet. <a className="link" href="#add">Add your first model or API →</a></div>
      )}
    </section>
  );
}

export { Score };
