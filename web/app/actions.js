'use server';

// Everything the site can change. Each action checks the session itself. The rules mirror cate/core.py:
// the site only queues work and changes settings; agents claim and hand in work through `python3 -m cate`.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertSignedIn, endSession, passwordIsSet, passwordMatches, startSession } from '@/lib/auth';
import { KINDS, PRESETS, PROVIDERS, RUNNERS } from '@/lib/data';
import { Abort, nowIso, settings, update, wakeAgents } from '@/lib/store';

const clean = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const list = (value) => clean(value, 2000).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

function refresh() {
  for (const p of ['/', '/tasks', '/agents', '/log']) revalidatePath(p);
  revalidatePath('/task/[id]', 'page');
}

async function guarded(work) {
  await assertSignedIn();
  try {
    const result = (await work()) || { ok: true };
    refresh();
    return result;
  } catch (error) {
    if (error instanceof Abort) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: `Could not save: ${error.message}` };
  }
}

function nextId(items, prefix) {
  let highest = 0;
  for (const item of items) {
    const id = String(item.id || '');
    if (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) highest = Math.max(highest, Number(id.slice(prefix.length)));
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

async function journal(by, kind, title, detail = '', ref = '') {
  const { timezone } = await settings();
  await update('journal', (data) => {
    data.entries = data.entries || [];
    data.entries.push({ id: nextId(data.entries, 'J'), at: nowIso(timezone), by, kind, title, detail, ref });
    data.entries = data.entries.slice(-3000);
  }, `log: ${title.slice(0, 60)}`);
}

export async function login(_previous, formData) {
  if (!passwordIsSet()) redirect('/');
  await new Promise((resolve) => setTimeout(resolve, 600)); // slows guessing
  if (!passwordMatches(formData.get('password') || '')) return { error: 'Wrong password.' };
  await startSession();
  redirect('/');
}

export async function logout() {
  await endSession();
  redirect('/login');
}

// ---- tasks --------------------------------------------------------------------------------------

export async function addTask(_previous, formData) {
  return guarded(async () => {
    const { timezone, passScore } = await settings();
    const title = clean(formData.get('title'), 200);
    const brief = clean(formData.get('brief'), 50000);
    const kind = clean(formData.get('kind'), 20) || 'other';
    const prefer = clean(formData.get('prefer'), 60) || 'any';
    const review = clean(formData.get('review'), 10) || 'none';
    if (!title || !brief) throw new Abort('A title and a brief are needed.');
    if (!KINDS.includes(kind)) throw new Abort('Unknown kind.');
    if (!(prefer === 'any' || PROVIDERS[prefer] || prefer.startsWith('agent:'))) throw new Abort('Unknown preference.');
    if (!['none', 'cross', 'any'].includes(review)) throw new Abort('Unknown review mode.');
    const after = list(formData.get('after')).map((s) => s.toUpperCase());
    const inputs = list(formData.get('inputs'));
    const checks = clean(formData.get('checks'), 5000).split('\n').map((s) => s.trim()).filter(Boolean);
    const score = Number(formData.get('pass_score')) || passScore;
    const priority = Math.max(1, Math.min(5, Number(formData.get('priority')) || 3));
    let id = '';
    await update('tasks', (data) => {
      data.tasks = data.tasks || [];
      for (const dep of after) if (!data.tasks.some((t) => t.id === dep)) throw new Abort(`"After" names ${dep}, which does not exist.`);
      id = nextId(data.tasks, 'T');
      const now = nowIso(timezone);
      data.tasks.push({
        id, title, brief, kind, prefer, priority, after, inputs, status: 'queued', attempts: 0, exclude: [],
        review: { mode: review, pass_score: score, checks }, parent: null, created_by: 'owner (dashboard)',
        created_at: now, queued_at: now, claimed_by: null, result: null, reviews: [],
        history: [{ at: now, actor: 'owner', event: 'created', detail: '' }], updated_at: now,
      });
    }, `task: ${title.slice(0, 50)}`);
    await journal('owner', 'update', `New task ${id}: ${title}`, '', id);
    const woke = await wakeAgents(`new task ${id}`);
    return { ok: true, message: woke.started ? `Added ${id}. Agents are starting now (about a minute).` : `Added ${id}. Note: ${woke.note}.` };
  });
}

async function changeTask(id, change, message) {
  const { timezone } = await settings();
  await update('tasks', (data) => {
    const task = (data.tasks || []).find((t) => t.id === id);
    if (!task) throw new Abort(`No task ${id}.`);
    const note = change(task, nowIso(timezone));
    task.updated_at = nowIso(timezone);
    task.history = task.history || [];
    task.history.push({ at: nowIso(timezone), actor: 'owner', event: message, detail: note || '' });
  }, `${message}: ${id}`);
  await journal('owner', 'update', `${message[0].toUpperCase()}${message.slice(1)} ${id}`, '', id);
}

export async function cancelTask(id) {
  return guarded(() => changeTask(id, (t) => { t.status = 'cancelled'; t.claimed_by = null; t.reviewer = null; }, 'cancelled'));
}

export async function requeueTask(id) {
  return guarded(async () => {
    await changeTask(id, (t, now) => {
      t.status = 'queued'; t.claimed_by = null; t.reviewer = null; t.queued_at = now; t.exclude = [];
      if (t.attempts >= 3) t.attempts = 0;
    }, 'sent back to the queue');
    await wakeAgents(`requeued ${id}`);
  });
}

export async function wakeNow() {
  return guarded(async () => {
    const woke = await wakeAgents('dashboard button');
    return woke.started ? { ok: true, message: 'Started. Agents with work run in about a minute; the rest stay asleep.' } : { ok: false, error: woke.note };
  });
}

export async function approveTask(id) {
  return guarded(() => changeTask(id, (t) => {
    if (!t.result) throw new Abort('Nothing has been handed in yet.');
    t.status = 'done'; t.reviewer = null;
  }, 'approved by the owner'));
}

export async function setPriority(id, priority) {
  return guarded(() => changeTask(id, (t) => { t.priority = Math.max(1, Math.min(5, Number(priority) || 3)); }, 'priority changed'));
}

// ---- agents -------------------------------------------------------------------------------------

export async function addAgent(_previous, formData) {
  return guarded(async () => {
    const { timezone } = await settings();
    const id = clean(formData.get('id'), 40).toLowerCase();
    const provider = clean(formData.get('provider'), 20);
    const runner = clean(formData.get('runner'), 40);
    if (!/^[a-z0-9-]+$/.test(id)) throw new Abort('The id may use lowercase letters, digits and dashes, e.g. claude-1.');
    if (!PROVIDERS[provider]) throw new Abort('Choose a provider.');
    if (!RUNNERS[runner]) throw new Abort('Choose how it runs.');
    const skills = list(formData.get('skills'));
    const preset = clean(formData.get('preset'), 40);
    if (preset && !PRESETS[preset]) throw new Abort('Unknown free model.');
    if (runner === 'api' && !preset && !clean(formData.get('api_base'), 300)) throw new Abort('An API agent needs a free model choice or a base URL.');
    await update('agents', (data) => {
      data.agents = data.agents || [];
      if (data.agents.some((a) => a.id === id)) throw new Abort(`There is already an agent called ${id}.`);
      data.agents.push({
        id, label: clean(formData.get('label'), 80) || id, provider, runner,
        account: clean(formData.get('account'), 120),
        model: clean(formData.get('model'), 80) || (preset ? PRESETS[preset].model : ''),
        preset, secret: clean(formData.get('secret'), 80).toUpperCase() || (preset ? PRESETS[preset].secret : ''),
        api_base: clean(formData.get('api_base'), 300), limits: {},
        skills: skills.length ? skills : ['any'], weekly_budget_tokens: Number(formData.get('budget')) || 0,
        status: 'active', limited_until: null, last_seen: null, created_at: nowIso(timezone),
      });
      if (runner === 'api' && !skills.length) data.agents[data.agents.length - 1].skills = ['write', 'review', 'plan'];
    }, `agent: ${id}`);
    await journal('owner', 'update', `New agent ${id} (${provider}, ${runner})`);
    return { ok: true, message: `Added ${id}. Open it below to copy its one-time setup prompt.` };
  });
}

export async function setAgent(id, changes) {
  return guarded(async () => {
    await update('agents', (data) => {
      const agent = (data.agents || []).find((a) => a.id === id);
      if (!agent) throw new Abort(`No agent ${id}.`);
      if (changes.status) {
        if (!['active', 'paused'].includes(changes.status)) throw new Abort('Unknown status.');
        agent.status = changes.status;
        if (changes.status === 'active') { agent.limited_until = null; delete agent.note; }
      }
      if (changes.budget !== undefined) agent.weekly_budget_tokens = Math.max(0, Number(changes.budget) || 0);
    }, `agent set: ${id}`);
    await journal('owner', 'update', `Changed agent ${id}`, JSON.stringify(changes));
  });
}
