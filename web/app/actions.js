'use server';

// Everything the site can change. Each action checks the session itself. The site queues work and keeps the
// chat; agents claim and hand in work through `python3 -m cate` (see cate/core.py for the same rules).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertSignedIn, endSession, passwordIsSet, passwordMatches, startSession } from '@/lib/auth';
import { KIND_LABELS, bestFor, chooseModel, enabledModels, loadCatalog } from '@/lib/catalog';
import { PRESETS, PROVIDERS, RUNNERS } from '@/lib/data';
import { Abort, nowIso, read, settings, update, uploadFile, wakeAgents } from '@/lib/store';
import { supervise, supervisorAvailable } from '@/lib/supervisor';

const clean = (value, max) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const KINDS = Object.keys(KIND_LABELS);

function refresh(chatId) {
  revalidatePath('/', 'layout');
  if (chatId) revalidatePath(`/c/${chatId}`);
}

async function guarded(work, chatId) {
  await assertSignedIn();
  try {
    const result = (await work()) || { ok: true };
    refresh(chatId || result.chatId);
    return result;
  } catch (error) {
    if (error instanceof Abort) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: error.message };
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

// ---- chat ---------------------------------------------------------------------------------------

function parseSelection(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return (Array.isArray(list) ? list : []).slice(0, 12).map((s) => ({
      agent: clean(s.agent, 40), model: clean(s.model, 80), kind: KINDS.includes(s.kind) ? s.kind : '',
    })).filter((s) => s.agent && s.model);
  } catch {
    return [];
  }
}

// Turn a list of plan steps into queued tasks for this chat. Returns the new task ids.
async function queueSteps(chatId, steps, { group = '', by = 'owner (chat)' } = {}) {
  const { timezone, passScore } = await settings();
  const ids = [];
  await update('tasks', (data) => {
    data.tasks = data.tasks || [];
    const now = nowIso(timezone);
    for (const step of steps) {
      const id = nextId(data.tasks, 'T');
      const after = (step.after || []).map((i) => ids[i]).filter(Boolean);
      data.tasks.push({
        id, title: clean(step.title, 200) || 'Step', brief: clean(step.brief, 50000), kind: KINDS.includes(step.kind) ? step.kind : 'other',
        prefer: step.agent ? `agent:${step.agent}` : 'any', model: clean(step.model, 80), priority: 2, after,
        inputs: step.inputs || [], status: 'queued', attempts: 0, exclude: [], chat: chatId, group,
        review: { mode: step.review === 'none' ? 'none' : 'cross', pass_score: passScore, checks: step.checks || [] },
        parent: null, created_by: by, created_at: now, queued_at: now, claimed_by: null, result: null, reviews: [],
        history: [{ at: now, actor: 'owner', event: 'created', detail: step.model || '' }], updated_at: now,
      });
      ids.push(id);
    }
  }, `chat ${chatId}: ${steps.length} step(s)`);
  return ids;
}

export async function sendMessage(formData) {
  return guarded(async () => {
    const { timezone } = await settings();
    const text = clean(formData.get('text'), 20000);
    let chatId = clean(formData.get('chat'), 20);
    const selection = parseSelection(formData.get('selection'));
    const compare = formData.get('compare') === '1';
    const files = formData.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, 5);
    if (!text && !files.length) throw new Abort('Write a message first.');
    if (files.some((f) => f.size > 8 * 1024 * 1024)) throw new Abort('Each file must be under 8 MB.');

    // 1. Save the message (creating the chat if new).
    const now = nowIso(timezone);
    let messageId = '';
    await update('chats', (data) => {
      data.chats = data.chats || [];
      let chat = data.chats.find((c) => c.id === chatId);
      if (!chat) {
        chatId = nextId(data.chats, 'C');
        chat = { id: chatId, title: (text || files[0]?.name || 'New project').split('\n')[0].slice(0, 70), created_at: now, messages: [], selection: [] };
        data.chats.push(chat);
      }
      messageId = nextId(chat.messages, 'M');
      chat.messages.push({ id: messageId, role: 'user', text, at: now, files: files.map((f) => `uploads/${chatId}/${f.name.replace(/[^\w.-]+/g, '_')}`) });
      chat.selection = selection;
      chat.updated_at = now;
    }, `chat: message`);

    // 2. Store attachments where agents can open them.
    for (const f of files) {
      await uploadFile(`uploads/${chatId}/${f.name.replace(/[^\w.-]+/g, '_')}`, Buffer.from(await f.arrayBuffer()), `upload to ${chatId}`);
    }

    // 3. Compare mode: same prompt to each picked model, side by side, no supervisor.
    if (compare && selection.length >= 2) {
      const group = `G${Date.now().toString(36)}`;
      const inputs = files.map((f) => `uploads/${chatId}/${f.name.replace(/[^\w.-]+/g, '_')}`);
      const ids = await queueSteps(chatId, selection.map((s) => ({
        title: `Compare: ${text.split('\n')[0].slice(0, 60)}`, brief: text, kind: s.kind || 'other', agent: s.agent, model: s.model, review: 'none', inputs,
      })), { group });
      await addMessage(chatId, { role: 'system', by: 'cate', text: `Sent the same prompt to ${selection.length} models to compare.`, tasks: ids, group });
      await wakeAgents(`compare in ${chatId}`);
      return { ok: true, chatId };
    }

    // 4. Ask the supervisor for an instant reply (and maybe a plan to confirm).
    const [agentsFile, tasksFile, chatsFile, catalog] = await Promise.all([read('agents'), read('tasks'), read('chats'), loadCatalog()]);
    const chat = chatsFile.chats.find((c) => c.id === chatId);
    const agents = (agentsFile.agents || []).filter((a) => a.runner !== 'manual');
    let answer = null;
    let failure = '';
    try {
      answer = await supervise({ catalog, agents, messages: chat.messages, tasks: tasksFile.tasks || [], selection });
    } catch (error) {
      failure = error.message;
    }
    if (!answer) {
      // No supervisor key (or it failed): offer a one-step plan with the picked or recommended model.
      const kind = selection[0]?.kind || 'other';
      const pick = selection[0] || bestFor(catalog, agents, kind);
      const agent = agents.find((a) => a.id === pick?.agent) || agents.find((a) => a.runner !== 'api' && a.status !== 'paused');
      const model = agent ? chooseModel(catalog, agent, kind, pick?.model) : '';
      answer = {
        reply: failure
          ? `The instant supervisor could not answer (${failure.slice(0, 160)}). Here is a one-step plan you can run as is or adjust:`
          : 'The instant supervisor is off (add a free **GROQ_API_KEY** in Vercel to turn it on). Here is a one-step plan you can run as is or adjust:',
        plan: agent ? { summary: 'Run the request as one step', steps: [{ title: text.split('\n')[0].slice(0, 80) || 'Request', kind, agent: agent.id, model, brief: text, review: 'cross', checks: [], after: [] }] } : null,
        provider: '', model: '',
      };
    }
    if (answer.plan) {
      const inputs = (chat.messages.flatMap((m) => m.files || []));
      answer.plan.steps = answer.plan.steps.map((s) => ({ ...s, inputs }));
    }
    await addMessage(chatId, {
      role: 'supervisor', by: answer.provider ? `supervisor (${answer.model})` : 'cate', text: answer.reply, plan: answer.plan || null,
    }, answer.provider);
    // "Continue" and status questions should never leave work idle: nudge the agents if this project has open steps.
    if ((tasksFile.tasks || []).some((t) => t.chat === chatId && ['queued', 'review'].includes(t.status))) {
      await wakeAgents(`message in ${chatId}`).catch(() => {});
    }
    return { ok: true, chatId };
  });
}

async function addMessage(chatId, message, countProvider = '') {
  const { timezone } = await settings();
  const now = nowIso(timezone);
  await update('chats', (data) => {
    const chat = data.chats.find((c) => c.id === chatId);
    if (!chat) throw new Abort('Chat not found.');
    chat.messages.push({ id: nextId(chat.messages, 'M'), at: now, ...message });
    chat.updated_at = now;
    if (countProvider) {
      const day = now.slice(0, 10);
      data.usage = data.usage || {};
      data.usage[day] = data.usage[day] || {};
      data.usage[day][countProvider] = (data.usage[day][countProvider] || 0) + 1;
      for (const old of Object.keys(data.usage).sort().slice(0, -14)) delete data.usage[old];
    }
  }, `chat ${chatId}: ${message.role}`);
}

// The user confirmed a plan (possibly after changing agents/models): queue it and start the agents.
export async function runPlan(chatId, messageId, steps) {
  return guarded(async () => {
    const [agentsFile, catalog] = await Promise.all([read('agents'), loadCatalog()]);
    const agents = agentsFile.agents || [];
    const checked = (steps || []).slice(0, 8).map((s) => {
      const agent = agents.find((a) => a.id === s.agent);
      if (!agent) throw new Abort(`Unknown agent ${s.agent}.`);
      if (s.model && !enabledModels(catalog, agent).includes(s.model)) throw new Abort(`${s.model} is not enabled on ${agent.id}.`);
      return s;
    });
    const ids = await queueSteps(chatId, checked);
    await update('chats', (data) => {
      const chat = data.chats.find((c) => c.id === chatId);
      const message = chat?.messages.find((m) => m.id === messageId);
      if (!message) throw new Abort('Plan not found.');
      if (message.tasks?.length) throw new Abort('This plan is already running.');
      message.tasks = ids;
      message.plan = { ...message.plan, steps: checked, started: true };
    }, `chat ${chatId}: run plan`);
    await journal('owner', 'update', `Started ${ids.length} step(s) in ${chatId}`, ids.join(', '));
    const woke = await wakeAgents(`plan in ${chatId}`);
    return woke.started ? { ok: true, chatId } : { ok: true, chatId, warning: woke.note };
  }, chatId);
}

export async function renameChat(chatId, title) {
  return guarded(() => update('chats', (data) => {
    const chat = data.chats.find((c) => c.id === chatId);
    if (chat) chat.title = clean(title, 80) || chat.title;
  }, `chat ${chatId}: rename`), chatId);
}

export async function archiveChat(chatId, archived = true) {
  return guarded(() => update('chats', (data) => {
    const chat = data.chats.find((c) => c.id === chatId);
    if (chat) chat.archived = archived;
  }, `chat ${chatId}: archive`), chatId);
}

// ---- tasks --------------------------------------------------------------------------------------

async function changeTask(id, change, message) {
  const { timezone } = await settings();
  let chatId = '';
  await update('tasks', (data) => {
    const task = (data.tasks || []).find((t) => t.id === id);
    if (!task) throw new Abort(`No task ${id}.`);
    chatId = task.chat || '';
    const note = change(task, nowIso(timezone));
    task.updated_at = nowIso(timezone);
    task.history = task.history || [];
    task.history.push({ at: nowIso(timezone), actor: 'owner', event: message, detail: note || '' });
  }, `${message}: ${id}`);
  await journal('owner', 'update', `${message[0].toUpperCase()}${message.slice(1)} ${id}`, '', id);
  return chatId;
}

export async function cancelTask(id) {
  return guarded(async () => {
    const chatId = await changeTask(id, (t) => { t.status = 'cancelled'; t.claimed_by = null; t.reviewer = null; }, 'cancelled');
    await wakeAgents(`cancelled ${id}`);
    return { ok: true, chatId };
  });
}

export async function retryTask(id, agent, model) {
  return guarded(async () => {
    const chatId = await changeTask(id, (t, now) => {
      t.status = 'queued'; t.claimed_by = null; t.reviewer = null; t.queued_at = now; t.exclude = []; t.attempts = 0;
      if (agent) { t.prefer = `agent:${agent}`; t.model = model || ''; }
    }, 'sent back to the queue');
    await wakeAgents(`retry ${id}`);
    return { ok: true, chatId };
  });
}

export async function approveTask(id) {
  return guarded(async () => {
    const chatId = await changeTask(id, (t) => {
      if (!t.result) throw new Abort('Nothing has been handed in yet.');
      t.status = 'done'; t.reviewer = null;
    }, 'approved by the owner');
    await wakeAgents(`approved ${id}`); // the next steps can start now
    return { ok: true, chatId };
  });
}

export async function wakeNow() {
  return guarded(async () => {
    const woke = await wakeAgents('dashboard button');
    return woke.started ? { ok: true, message: 'Started: agents with work begin in about a minute.' } : { ok: false, error: woke.note };
  });
}

// ---- agents & models ----------------------------------------------------------------------------

export async function addAgent(_previous, formData) {
  return guarded(async () => {
    const { timezone } = await settings();
    const runner = clean(formData.get('runner'), 40);
    const preset = clean(formData.get('preset'), 40);
    let provider = clean(formData.get('provider'), 20);
    const id = clean(formData.get('id'), 40).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id)) throw new Abort('The name may use lowercase letters, digits and dashes, e.g. claude-3.');
    if (!RUNNERS[runner]) throw new Abort('Choose how it connects.');
    if (runner === 'claude-actions') provider = 'anthropic';
    if (runner === 'codex-actions') provider = 'openai';
    if (runner === 'api') {
      if (!PRESETS[preset]) throw new Abort('Choose a free API.');
      provider = PRESETS[preset].provider;
    }
    if (!PROVIDERS[provider]) throw new Abort('Choose a provider.');
    await update('agents', (data) => {
      data.agents = data.agents || [];
      if (data.agents.some((a) => a.id === id)) throw new Abort(`There is already a connection called ${id}.`);
      data.agents.push({
        id, label: clean(formData.get('label'), 80) || id, provider, runner, account: clean(formData.get('account'), 120),
        model: runner === 'api' ? PRESETS[preset].model : '', preset: runner === 'api' ? preset : '',
        secret: runner === 'api' ? PRESETS[preset].secret : '', skills: runner === 'api' ? ['plan', 'review', 'data', 'write'] : ['any'],
        weekly_budget_tokens: 0, status: 'paused', note: 'Not connected yet: follow the connect steps, then press Resume.',
        limited_until: null, last_seen: null, created_at: nowIso(timezone), limits: {},
      });
    }, `agent: ${id}`);
    await journal('owner', 'update', `New connection ${id} (${provider}, ${runner})`);
    return { ok: true, message: `Added ${id}. Open its card to connect it.` };
  });
}

export async function setAgent(id, changes) {
  return guarded(async () => {
    const catalog = await loadCatalog();
    await update('agents', (data) => {
      const agent = (data.agents || []).find((a) => a.id === id);
      if (!agent) throw new Abort(`No connection ${id}.`);
      if (changes.status) {
        if (!['active', 'paused'].includes(changes.status)) throw new Abort('Unknown status.');
        agent.status = changes.status;
        if (changes.status === 'active') { agent.limited_until = null; delete agent.note; }
      }
      if (changes.budget !== undefined) agent.weekly_budget_tokens = Math.max(0, Number(changes.budget) || 0);
      if (changes.models) {
        const known = (catalog.providers?.[agent.provider]?.models || []).map((m) => m.id);
        const models = changes.models.filter((m) => known.includes(m) || m === agent.model);
        if (!models.length) throw new Abort('Keep at least one model enabled.');
        agent.models = models;
        for (const [kind, m] of Object.entries(agent.roles || {})) if (!models.includes(m)) delete agent.roles[kind];
      }
      if (changes.role) {
        const { kind, model } = changes.role;
        if (!KINDS.includes(kind)) throw new Abort('Unknown job type.');
        agent.roles = agent.roles || {};
        if (model) {
          if (!enabledModels(catalog, agent).includes(model)) throw new Abort('Enable that model first.');
          agent.roles[kind] = model;
        } else delete agent.roles[kind];
      }
      if (changes.label !== undefined) agent.label = clean(changes.label, 80) || agent.id;
    }, `agent set: ${id}`);
    await journal('owner', 'update', `Changed ${id}`, JSON.stringify(changes).slice(0, 200));
  });
}

export async function removeAgent(id) {
  return guarded(async () => {
    await update('agents', (data) => { data.agents = (data.agents || []).filter((a) => a.id !== id); }, `agent remove: ${id}`);
    await journal('owner', 'update', `Removed connection ${id}`);
  });
}

export async function supervisorStatus() {
  await assertSignedIn();
  const s = supervisorAvailable();
  return s ? s.provider : '';
}
