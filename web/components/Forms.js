'use client';

import { useActionState, useState, useTransition } from 'react';
import { addAgent, addTask, approveTask, cancelTask, requeueTask, setAgent, wakeNow } from '@/app/actions';

function Feedback({ state }) {
  if (!state) return null;
  return <p className={`feedback ${state.ok === false ? 'bad' : ''}`} role="status">{state.error || state.message || 'Saved.'}</p>;
}

export function TaskForm({ providers, agents, kinds, passScore }) {
  const [state, action, pending] = useActionState(addTask, null);
  return (
    <form action={action} className="stack">
      <label>Title<input name="title" required maxLength={200} placeholder="e.g. Tailor my resume to the Razorpay Founder's Office role" /></label>
      <label>Brief: what should be done, and what a good result looks like
        <textarea name="brief" required placeholder="Write it like you would to a capable colleague. Paste links, the job description, constraints…" />
      </label>
      <div className="row">
        <label>Kind<select name="kind" defaultValue="write">{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>Who should do it
          <select name="prefer" defaultValue="any">
            <option value="any">Whoever is free</option>
            {Object.entries(providers).map(([k, v]) => <option key={k} value={k}>{v} first</option>)}
            {agents.map((a) => <option key={a.id} value={`agent:${a.id}`}>Only {a.id} first</option>)}
          </select>
        </label>
        <label>Priority<select name="priority" defaultValue="3"><option value="1">1 · urgent</option><option value="2">2</option><option value="3">3 · normal</option><option value="4">4</option><option value="5">5 · whenever</option></select></label>
        <label>Review
          <select name="review" defaultValue="cross">
            <option value="cross">By a different model (recommended)</option>
            <option value="any">By any other agent</option>
            <option value="none">No review</option>
          </select>
        </label>
      </div>
      <details className="box">
        <summary>More options: checks, inputs, order</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <label>Checks the reviewer scores against (one per line)<textarea name="checks" style={{ minHeight: 80 }} placeholder={'No invented facts\nATS score at least 80\nOne page'} /></label>
          <div className="row">
            <label>Pass score (0–100)<input name="pass_score" type="number" min="0" max="100" defaultValue={passScore} /></label>
            <label>Start after tasks (ids, comma separated)<input name="after" placeholder="T0001" /></label>
          </div>
          <label>Input files (comma separated): repo files or earlier outputs<input name="inputs" placeholder="workspace/inputs/resume.md, outputs/T0001.md" /></label>
        </div>
      </details>
      <div className="button-row"><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add to the queue'}</button><Feedback state={state} /></div>
    </form>
  );
}

export function AgentForm({ providers, runners, presets, initial = {} }) {
  const [state, action, pending] = useActionState(addAgent, null);
  const [runner, setRunner] = useState(initial.runner || 'claude-actions');
  return (
    <form action={action} className="stack">
      <div className="row">
        <label>Agent id<input name="id" required placeholder="claude-1" pattern="[a-z0-9-]+" defaultValue={initial.id || ''} /></label>
        <label>Provider<select name="provider" defaultValue={initial.provider || 'anthropic'}>{Object.entries(providers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>How it runs<select name="runner" value={runner} onChange={(e) => setRunner(e.target.value)}>{Object.entries(runners).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      {runner === 'api' ? (
        <div className="row">
          <label>Free model<select name="preset" defaultValue={initial.preset || 'gemini'}>{Object.entries(presets).map(([k, v]) => <option key={k} value={k}>{v.label} · {v.free}</option>)}<option value="">Other (enter a base URL)</option></select></label>
          <label>Base URL (only for “Other”)<input name="api_base" placeholder="https://…/v1" /></label>
          <label>GitHub secret holding the key (blank = default)<input name="secret" placeholder="e.g. GEMINI_API_KEY" /></label>
        </div>
      ) : null}
      <div className="row">
        <label>Name<input name="label" placeholder="Claude Pro · account 1" /></label>
        <label>Account (for you)<input name="account" placeholder="which login this is" /></label>
        <label>Model<input name="model" placeholder="e.g. Claude Opus, GPT-5 Codex" /></label>
      </div>
      <div className="row">
        <label>Good at (comma separated, or "any")<input name="skills" defaultValue={runner === 'api' ? 'write, review, plan' : 'any'} key={runner} /></label>
        <label>Weekly token budget (0 = no cap)<input name="budget" type="number" min="0" step="10000" defaultValue="0" /></label>
      </div>
      <div className="button-row"><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add agent'}</button><Feedback state={state} /></div>
    </form>
  );
}

export function TaskButtons({ id, status, hasResult }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  const run = (fn) => start(async () => setState(await fn(id)));
  return (
    <div className="button-row">
      {status === 'review' || status === 'reviewing' ? <button className="button small gold" disabled={pending || !hasResult} onClick={() => run(approveTask)}>Approve now</button> : null}
      {['failed', 'blocked', 'cancelled', 'claimed', 'reviewing', 'done'].includes(status) ? <button className="button small" disabled={pending} onClick={() => run(requeueTask)}>Send back to the queue</button> : null}
      {!['done', 'cancelled'].includes(status) ? <button className="button small" disabled={pending} onClick={() => run(cancelTask)}>Cancel</button> : null}
      <Feedback state={state} />
    </div>
  );
}

export function AgentButtons({ id, status, budget }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  const [value, setValue] = useState(budget || 0);
  const run = (changes) => start(async () => setState(await setAgent(id, changes)));
  return (
    <div className="button-row" style={{ marginTop: 8 }}>
      {status === 'paused'
        ? <button className="button small" disabled={pending} onClick={() => run({ status: 'active' })}>Resume</button>
        : <button className="button small" disabled={pending} onClick={() => run({ status: 'paused' })}>Pause</button>}
      <input aria-label="Weekly token budget" type="number" min="0" step="10000" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 120, padding: '3px 8px', border: '1px solid var(--line)', borderRadius: 8 }} />
      <button className="button small" disabled={pending} onClick={() => run({ budget: value })}>Set budget</button>
      <Feedback state={state} />
    </div>
  );
}

export function CopyBox({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre className="result" style={{ maxHeight: 260 }}>{text}</pre>
      <button className="button small" type="button" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : label}</button>
    </div>
  );
}

export function WakeButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  return (
    <div className="button-row">
      <button className="button" disabled={pending} onClick={() => start(async () => setState(await wakeNow()))}>{pending ? 'Starting…' : 'Wake agents now'}</button>
      <Feedback state={state} />
    </div>
  );
}
