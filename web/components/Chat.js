'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { approveTask, archiveChat, cancelTask, retryTask, runPlan, sendMessage } from '@/app/actions';
import Link from 'next/link';
import { TopBar } from '@/components/AppFrame';
import { Archive, Arrow, ChatIcon, Clip, Cube, List, Spark, Split, X } from '@/components/Icons';
import Markdown from '@/components/Markdown';
import { LEGACY_AUTO_LIST_KEY, composerKeyAction } from '@/lib/composerKeys.mjs';

const KIND_LABELS = { plan: 'Planning', research: 'Research', write: 'Writing', code: 'Development', review: 'Review', data: 'Data', other: 'Other' };
const STATUS = {
  queued: 'Queued', claimed: 'Working', review: 'Waiting for review', reviewing: 'Being reviewed',
  done: 'Done', failed: 'Failed', blocked: 'Blocked', cancelled: 'Cancelled',
};
const OPEN = ['queued', 'claimed', 'review', 'reviewing'];

// The unsent text in the chat box is kept in this browser (localStorage), one draft per project,
// so it survives switching projects, leaving the page, or reloading.
const draftKey = (chatId) => `cate:draft:${chatId || 'new'}`;
function readDraft(chatId) {
  try { return window.localStorage.getItem(draftKey(chatId)) || ''; } catch { return ''; }
}
function writeDraft(chatId, value) {
  try {
    if (value) window.localStorage.setItem(draftKey(chatId), value);
    else window.localStorage.removeItem(draftKey(chatId));
  } catch {}
}
function fitHeight(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(260, el.scrollHeight)}px`;
}

const SUGGESTIONS = [
  { Icon: List, title: 'Research', text: 'Research 10 companies hiring for strategy roles and summarise each' },
  { Icon: ChatIcon, title: 'Write', text: 'Tailor my resume (attached) to a current Founder’s Office opening in Bengaluru' },
  { Icon: Cube, title: 'Build', text: 'Plan and build a landing page for my NGO’s donation drive' },
  { Icon: Split, title: 'Improve CATE', text: 'Change CATE itself: describe the change and an agent opens a pull request for you to merge' },
];

function statusOf(row) {
  if (row.status === 'paused') return row.note ? { tone: 'bad', word: 'not connected' } : { tone: 'warn', word: 'paused' };
  const left = row.windows.length ? Math.min(...row.windows.map((w) => w.left)) : null;
  if (left === null) return { tone: 'ok', word: 'ready' };
  return { tone: left <= 10 ? 'bad' : left <= 30 ? 'warn' : 'ok', word: `${left}% left` };
}

// Home: team status (system status first, as NN/g's empty-state guidance suggests), starting points, recent projects.
function Home({ usage, supervisor, recent, onPick }) {
  const rows = usage?.rows || [];
  const ready = rows.filter((r) => r.status !== 'paused');
  return (
    <div className="hero">
      <h1>What should your AI team work on?</h1>
      <p>Describe the project. The supervisor{supervisor ? '' : ' (off until a free Groq key is added)'} frames it with you, then hands each step to the best model on the account with the most limit left.</p>
      {!ready.length || !supervisor ? (
        <Link prefetch={false} href="/models#add" className="setup-card">
          <b>{ready.length ? 'Turn on the instant supervisor' : 'Connect your first model'}</b>
          <span>{ready.length ? 'Add a free GROQ_API_KEY so the chat can answer and plan within seconds.' : 'Add a Claude or ChatGPT subscription, or a free API key. It takes about 2 minutes.'}</span>
          <span className="link">Open the guide →</span>
        </Link>
      ) : null}
      {rows.length ? (
        <div className="team-strip" aria-label="Your connections">
          {rows.map((r) => {
            const st = statusOf(r);
            return <Link prefetch={false} key={r.id} href={`/models#agent-${r.id}`} className={`team-chip ${st.tone}`} title={`${r.label}: ${st.word}`}><i aria-hidden="true" />{r.label}<span>{st.word}</span></Link>;
          })}
          <Link prefetch={false} href="/models#add" className="team-chip add">+ Add</Link>
        </div>
      ) : null}
      <div className="suggestions">
        {SUGGESTIONS.map(({ Icon, title, text }) => (
          <button key={title} className="suggestion" onClick={() => onPick(text)}>
            <b><Icon /> {title}</b>
            <span>{text}</span>
          </button>
        ))}
      </div>
      {recent?.length ? (
        <div className="recent">
          <div className="section-label">Recent projects</div>
          {recent.map((c) => (
            <Link prefetch={false} key={c.id} href={`/c/${c.id}`}>
              <span className={`dot ${c.status}`} aria-hidden="true" />
              <span className="t">{c.title}</span>
              <span className="faint">{c.status === 'idle' ? '' : c.status}</span>
              <span className="faint num">{ago(c.updated_at)}{ago(c.updated_at) && ago(c.updated_at) !== 'just now' ? ' ago' : ''}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function tone(left) {
  return left <= 10 ? 'bad' : left <= 30 ? 'warn' : '';
}

export function Limit({ w }) {
  return (
    <div className="limit" title={w.detail || (w.resets ? `resets ${new Date(w.resets).toLocaleString()}` : '')}>
      <span>{w.label}</span>
      <div className={`meter ${tone(w.left)}`}><span style={{ width: `${w.left}%` }} /></div>
      <b>{w.left}% left</b>
    </div>
  );
}

function Ring({ value }) {
  const v = value ?? 100;
  const r = 9;
  const c = 2 * Math.PI * r;
  const color = v <= 10 ? 'var(--bad)' : v <= 30 ? 'var(--warn)' : 'var(--accent)';
  return (
    <svg className="ring" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="3" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 11 11)" strokeLinecap="round" />
    </svg>
  );
}

// ---- usage panel: every connection, as % left ----
function UsagePanel({ usage, onClose }) {
  return (
    <div className="popover right" role="dialog" aria-label="Limits left">
      <div className="pop-title">Limits left <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button></div>
      {usage.rows.map((r) => (
        <div className="pop-agent" key={r.id}>
          <div className="pop-agent-head"><b>{r.label}</b>
            {r.status === 'paused' ? <span className="pill warn">{r.note ? 'Not connected' : 'Paused'}</span> : <span className="pill">{r.runner === 'api' ? 'Free API' : 'Subscription'}</span>}
          </div>
          <div className="limits">
            {r.windows.map((w) => <Limit key={w.label} w={w} />)}
            {r.budgetLeft !== null ? <Limit w={{ label: 'Budget', left: r.budgetLeft, detail: `${r.tokens.toLocaleString()} tokens used this week` }} /> : null}
            {!r.windows.length && r.budgetLeft === null ? <span className="faint" style={{ fontSize: 12.5 }}>{r.runner === 'api' ? 'No daily allowance known.' : 'Limits appear after its next run.'}</span> : null}
          </div>
          {r.windows.find((w) => w.resets) ? <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
            {r.windows.filter((w) => w.resets).map((w) => `${w.label} resets ${new Date(w.resets).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`).join(' · ')}
          </div> : null}
        </div>
      ))}
    </div>
  );
}

// ---- model picker: every enabled model on every connection ----
function ModelPicker({ agents, models, recommended, selection, toggle, onClose }) {
  const bestTags = (agentId, modelId) => Object.entries(recommended).filter(([, r]) => r && r.agent === agentId && r.model === modelId).map(([k]) => KIND_LABELS[k]);
  return (
    <div className="popover left" role="dialog" aria-label="Choose models">
      <div className="pop-title">Choose models for this project <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button></div>
      <p className="faint" style={{ fontSize: 12, margin: '0 4px 8px' }}>Pick none and the supervisor chooses the best model per step. “Best now” uses the research scores and how much limit each account has left.</p>
      {agents.map((a) => (
        <div className="pop-agent" key={a.id}>
          <div className="pop-agent-head"><b>{a.label}</b>
            {a.status === 'paused' ? <span className="pill warn">{a.note ? 'Not connected' : 'Paused'}</span> : a.left !== null ? <span className={`pill ${tone(a.left) || 'accent'}`}>{a.left}% left</span> : null}
          </div>
          {a.models.map((m) => {
            const info = models[m] || { label: m };
            const on = selection.some((s) => s.agent === a.id && s.model === m);
            const tags = bestTags(a.id, m);
            return (
              <button key={m} className="model-opt" role="menuitemcheckbox" aria-checked={on} disabled={a.status === 'paused'} onClick={() => toggle(a.id, m)}>
                <span className="n">{info.label}</span>
                <span className="tags">{tags.slice(0, 3).map((t) => <span key={t} className="pill accent">Best now: {t}</span>)}{on ? <span className="pill ok">Added</span> : null}</span>
                {info.note ? <span className="d">{info.note}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- plan card: the user can change agent / model per step, then run ----
function PlanCard({ chatId, message, agents, models, tasks }) {
  const [steps, setSteps] = useState(message.plan.steps);
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  const started = message.plan.started || (message.tasks || []).length > 0;
  const set = (i, patch) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const usable = agents.filter((a) => a.status !== 'paused');

  return (
    <div className="plan">
      <div className="plan-head"><span><b>Plan</b>{message.plan.summary ? ` · ${message.plan.summary}` : ''}</span><span className="pill accent">{steps.length} step{steps.length > 1 ? 's' : ''}</span></div>
      {steps.map((s, i) => {
        const agent = agents.find((a) => a.id === s.agent);
        return (
          <div className="step" key={i}>
            <div className="step-top"><b>{i + 1}. {s.title}</b><span className="pill">{KIND_LABELS[s.kind] || s.kind}</span>{s.review !== 'none' ? <span className="pill">Checked by another model</span> : null}</div>
            {started ? (
              <div className="task-meta">{agent?.label || s.agent} · {models[s.model]?.label || s.model || 'default model'}</div>
            ) : (
              <div className="step-pick">
                <select aria-label="Agent" value={s.agent} onChange={(e) => {
                  const next = agents.find((a) => a.id === e.target.value);
                  set(i, { agent: e.target.value, model: next?.models.includes(s.model) ? s.model : next?.defaults?.[s.kind] || next?.models[0] || '' });
                }}>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.label}{a.left !== null ? ` · ${a.left}% left` : ''}</option>)}
                </select>
                <select aria-label="Model" value={s.model} onChange={(e) => set(i, { model: e.target.value })}>
                  {(agent?.models || []).map((m) => <option key={m} value={m}>{models[m]?.label || m}{agent?.defaults?.[s.kind] === m ? ' (recommended)' : ''}</option>)}
                </select>
              </div>
            )}
            <details><summary className="faint" style={{ fontSize: 12.5, cursor: 'pointer' }}>Brief{s.checks?.length ? ` and ${s.checks.length} checks` : ''}</summary>
              <div className="step-brief">{s.brief}</div>
              {s.checks?.length ? <ul className="faint" style={{ fontSize: 12.5, margin: '6px 0 0' }}>{s.checks.map((c) => <li key={c}>{c}</li>)}</ul> : null}
            </details>
          </div>
        );
      })}
      {started ? null : (
        <div className="plan-foot">
          <span>If a chosen account runs out of limit, the next account of the same provider takes over with the same model.</span>
          <button className="button primary" disabled={pending} onClick={() => start(async () => setState(await runPlan(chatId, message.id, steps)))}>{pending ? 'Starting…' : 'Run plan'}</button>
          {state?.error ? <span className="feedback bad">{state.error}</span> : state?.warning ? <span className="feedback bad">{state.warning}</span> : null}
        </div>
      )}
      {started ? <div style={{ padding: '0 10px 10px', display: 'grid', gap: 10 }}>{(message.tasks || []).map((id) => tasks.find((t) => t.id === id)).filter(Boolean).map((t) => <TaskCard key={t.id} task={t} agents={agents} models={models} />)}</div> : null}
    </div>
  );
}

function TaskCard({ task, agents, models }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState(null);
  const working = ['claimed', 'reviewing'].includes(task.status);
  const who = task.claimed_by || task.reviewer || task.result?.by || task.prefer?.replace('agent:', '');
  const model = task.status === 'reviewing' ? task.review_model : (task.run_model || task.result?.model || task.model);
  const agentLabel = agents.find((a) => a.id === who)?.label || who;
  const review = task.reviews?.[task.reviews.length - 1];
  const act = (fn) => start(async () => setState(await fn(task.id)));
  const statusTone = task.status === 'done' ? 'ok' : ['failed', 'blocked'].includes(task.status) ? 'bad' : OPEN.includes(task.status) ? 'accent' : '';
  return (
    <div className="task">
      <div className="task-head">
        {working ? <span className="spinner" aria-hidden="true" /> : null}
        <b>{task.title}</b>
        <span className="pill">{agentLabel}{model ? ` · ${models[model]?.label || model}` : ''}</span>
        <span className={`pill ${statusTone}`}>{STATUS[task.status] || task.status}{working ? ` · ${ago(task.claimed_at || task.reviewing_at)}` : ''}</span>
        {task.merge ? <span className={`pill ${task.merge.status === 'merged' ? 'ok' : task.merge.status === 'blocked' ? 'bad' : 'warn'}`} title={task.merge.detail}>
          {task.merge.status === 'merged' ? `✓ Merged PR #${task.merge.pr}` : task.merge.status === 'blocked' ? `Not merged: PR #${task.merge.pr}` : `Merging PR #${task.merge.pr}…`}</span> : null}
        {(task.status === 'reviewing' ? task.review_run_url : task.run_url) ? <a className="link" style={{ fontSize: 12.5 }} href={task.status === 'reviewing' ? task.review_run_url : task.run_url} target="_blank" rel="noreferrer">View run ↗</a> : null}
      </div>
      {task.status === 'queued' ? <div className="task-body task-meta">Starting an agent… this usually takes 1–3 minutes.</div> : null}
      {task.result ? (
        <div className="task-body">
          <Markdown text={task.result.text} />
          {review ? (
            <details className="box"><summary>{review.verdict === 'pass' ? '✓ Passed review' : '✗ Sent back'} · {review.score}/100 · {agents.find((a) => a.id === review.by)?.label || review.by}{review.model ? ` (${models[review.model]?.label || review.model})` : ''}</summary>
              <Markdown text={review.notes} />
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="task-body button-row">
        {task.status === 'review' || task.status === 'reviewing' ? <button className="button small" disabled={pending} onClick={() => act(approveTask)}>Approve without review</button> : null}
        {['failed', 'blocked', 'cancelled', 'done'].includes(task.status) ? <button className="button small" disabled={pending} onClick={() => act((id) => retryTask(id))}>Run again</button> : null}
        {OPEN.includes(task.status) ? <button className="button small ghost" disabled={pending} onClick={() => act(cancelTask)}>Cancel</button> : null}
        {state?.error ? <span className="feedback bad">{state.error}</span> : null}
      </div>
    </div>
  );
}

// ---- the chat ----
export default function Chat({ chatId, initial, agents, models, recommended, supervisor, recent = [] }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [selection, setSelection] = useState(initial.chat?.selection || []);
  const [compare, setCompare] = useState(false);
  const [open, setOpen] = useState(''); // 'models' | 'usage'
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const bottom = useRef(null);
  const fileInput = useRef(null);
  const statusKey = useRef('');
  const textBox = useRef(null);
  const modelsAnchor = useRef(null);
  const usageAnchor = useRef(null);

  const chat = data.chat;
  const tasks = data.tasks || [];
  const active = tasks.some((t) => OPEN.includes(t.status));

  const poll = useCallback(async () => {
    if (!chatId || document.hidden) return;
    try {
      const res = await fetch(`/api/state?chat=${chatId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = await res.json();
      setData(next);
      const key = (next.tasks || []).map((t) => `${t.id}:${t.status}`).join(',');
      if (statusKey.current && key !== statusKey.current) router.refresh(); // sidebar status dots
      statusKey.current = key;
    } catch {}
  }, [chatId, router]);

  useEffect(() => {
    const id = setInterval(poll, active || pending ? 4000 : 20000);
    return () => clearInterval(id);
  }, [poll, active, pending]);
  useEffect(() => { setData(initial); }, [initial]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [chat?.messages?.length, optimistic]);

  // Restore the saved draft on mount (after hydration, so server and client HTML match).
  useEffect(() => {
    const saved = readDraft(chatId);
    if (saved) setText((cur) => cur || saved);
  }, [chatId]);
  useEffect(() => { fitHeight(textBox.current); }, [text]);
  // Every edit goes through here so the draft in localStorage always matches the box.
  const updateText = (value) => { setText(value); writeDraft(chatId, value); };

  // Enter sends; Shift+Enter is never intercepted, so the browser inserts a plain newline (no auto
  // numbering or bullets). An old list-continuation preference from an earlier build is cleared.
  useEffect(() => { try { window.localStorage.removeItem(LEGACY_AUTO_LIST_KEY); } catch {} }, []);
  const onKeyDown = (e) => {
    const action = composerKeyAction({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing });
    if (action === 'send') { e.preventDefault(); submit(); }
  };

  // An open popover (model picker or limits panel) closes on a click/tap outside it or on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const anchor = open === 'models' ? modelsAnchor : usageAnchor;
    const onPointer = (e) => { if (anchor.current && !anchor.current.contains(e.target)) setOpen(''); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(''); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const agentRows = useMemo(() => agents, [agents]);
  const toggle = (agent, model) => setSelection((sel) => (sel.some((s) => s.agent === agent && s.model === model)
    ? sel.filter((s) => !(s.agent === agent && s.model === model)) : [...sel, { agent, model, kind: '' }]));

  const submit = () => {
    if (pending || (!text.trim() && !files.length)) return;
    const form = new FormData();
    form.set('text', text);
    if (chatId) form.set('chat', chatId);
    form.set('selection', JSON.stringify(selection));
    form.set('compare', compare && selection.length >= 2 ? '1' : '0');
    for (const f of files) form.append('files', f);
    setOptimistic({ text, files: files.map((f) => f.name) });
    setError('');
    const sent = text;
    setText(''); // the saved draft stays until the message is accepted (or restored below on error)
    setFiles([]);
    start(async () => {
      const result = await sendMessage(form);
      if (!result?.ok) { setError(result?.error || 'Could not send.'); updateText(sent); setOptimistic(null); return; }
      writeDraft(chatId, '');
      if (!chatId && result.chatId) { router.push(`/c/${result.chatId}`); return; }
      await poll();
      setOptimistic(null);
      router.refresh();
    });
  };

  const messages = chat?.messages || [];
  const empty = !messages.length && !optimistic;

  return (
    <div className="chat">
      <TopBar title={chat?.title || 'New project'}>
        {active ? <span className="pill accent"><span className="spinner" aria-hidden="true" /> Agents working</span> : null}
        {chatId ? (
          <button className="icon-btn" title={chat?.archived ? 'Move back to projects' : 'Archive project'} aria-label={chat?.archived ? 'Move back to projects' : 'Archive project'} onClick={() => start(async () => {
            await archiveChat(chatId, !chat?.archived);
            if (!chat?.archived) router.push('/'); else router.refresh();
          })}><Archive /></button>
        ) : null}
      </TopBar>

      <div className="messages">
        {empty ? (
          <Home usage={data.usage} supervisor={supervisor} recent={chatId ? [] : recent} onPick={(s) => { updateText(s); textBox.current?.focus(); }} />
        ) : (
          <div className="messages-inner">
            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="msg-user">{m.text}
                    {m.files?.length ? <div className="msg-files">{m.files.map((f) => <span key={f} className="pill"><Clip /> {f.split('/').pop()}</span>)}</div> : null}
                  </div>
                );
              }
              const own = (m.tasks || []).map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
              return (
                <div key={m.id} className="msg-bot">
                  <div className="avatar">C</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="bot-name">{m.role === 'supervisor' ? 'Supervisor' : 'CATE'}{m.by && m.by.includes('(') ? <span className="faint"> · {m.by.slice(m.by.indexOf('(') + 1, -1)}</span> : null}</div>
                    {m.text ? <Markdown text={m.text} /> : null}
                    {m.plan ? <PlanCard chatId={chatId} message={m} agents={agentRows} models={models} tasks={tasks} /> : null}
                    {!m.plan && own.length ? (
                      <div className={m.group ? 'compare' : ''} style={{ marginTop: 10, display: m.group ? undefined : 'grid', gap: 10 }}>
                        {own.map((t) => <TaskCard key={t.id} task={t} agents={agentRows} models={models} />)}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {optimistic ? (
              <>
                <div className="msg-user">{optimistic.text}{optimistic.files.length ? <div className="msg-files">{optimistic.files.map((f) => <span key={f} className="pill"><Clip /> {f}</span>)}</div> : null}</div>
                <div className="msg-bot"><div className="avatar">C</div><div className="faint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="spinner" /> {compare && selection.length >= 2 ? 'Sending to the models…' : 'Supervisor is thinking…'}</div></div>
              </>
            ) : null}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer">
          {selection.length || files.length ? (
            <div className="chips">
              {selection.map((s) => {
                const a = agents.find((x) => x.id === s.agent);
                return (
                  <span key={`${s.agent}/${s.model}`} className="chip">
                    {a?.label || s.agent} · {models[s.model]?.label || s.model}
                    <select aria-label="Use for" value={s.kind} onChange={(e) => setSelection(selection.map((x) => (x === s ? { ...x, kind: e.target.value } : x)))}>
                      <option value="">any job</option>
                      {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button className="x" aria-label="Remove" onClick={() => setSelection(selection.filter((x) => x !== s))}><X /></button>
                  </span>
                );
              })}
              {files.map((f) => (
                <span key={f.name} className="chip file-chip"><Clip /> {f.name}<button className="x" aria-label="Remove file" onClick={() => setFiles(files.filter((x) => x !== f))}><X /></button></span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textBox}
            value={text} placeholder={chatId ? 'Reply, add details, or ask for changes…' : 'Describe your project…'} rows={2}
            onChange={(e) => updateText(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
          />
          <div className="composer-bar">
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 5))} />
            <button className="tool" onClick={() => fileInput.current?.click()} title="Attach files"><Clip /></button>
            <div className="pop-anchor" ref={modelsAnchor}>
              <button className="tool" aria-expanded={open === 'models'} onClick={() => setOpen(open === 'models' ? '' : 'models')}><Spark /> {selection.length ? `${selection.length} model${selection.length > 1 ? 's' : ''}` : 'Models: auto'}</button>
              {open === 'models' ? <ModelPicker agents={agentRows} models={models} recommended={recommended} selection={selection} toggle={toggle} onClose={() => setOpen('')} /> : null}
            </div>
            <button className="tool" aria-pressed={compare} disabled={selection.length < 2} onClick={() => setCompare(!compare)} title={selection.length < 2 ? 'Pick two or more models to compare their answers side by side' : 'Send the same prompt to each picked model'}><Split /> Compare</button>
            <span className="spacer" />
            <div className="pop-anchor" ref={usageAnchor}>
              <button className="tool" aria-expanded={open === 'usage'} onClick={() => setOpen(open === 'usage' ? '' : 'usage')} title="Limits left on every connection">
                <Ring value={data.usage?.lowest} /> {data.usage?.lowest !== null && data.usage?.lowest !== undefined ? `${data.usage.lowest}%` : '–'}
              </button>
              {open === 'usage' ? <UsagePanel usage={data.usage || { rows: [] }} onClose={() => setOpen('')} /> : null}
            </div>
            <button className="send" disabled={pending || (!text.trim() && !files.length)} onClick={submit} aria-label="Send"><Arrow /></button>
          </div>
        </div>
        <div className="composer-note">{error ? <span className="feedback bad">{error}</span> : (
          <>Enter to send · Shift+Enter for a new line · the ring shows the lowest limit left</>
        )}</div>
      </div>
    </div>
  );
}
