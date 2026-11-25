// Builds what the chat screens need from the data files, in one place, for pages and for the live endpoint.

import { KIND_LABELS, bestFor, chooseModel, enabledModels, lowestLeft, modelInfo } from '@/lib/catalog';
import { chatStatus, loadAll } from '@/lib/data';
import { lowestPercent, usageRows } from '@/lib/usage';

export function agentRows(catalog, agents) {
  return agents.filter((a) => a.runner !== 'manual').map((a) => {
    const hasLimits = Object.keys(a.limits || {}).some((k) => k === 'five_hour' || k === 'seven_day');
    return {
      id: a.id, label: a.label || a.id, provider: a.provider, runner: a.runner, status: a.status, note: a.note || '',
      models: enabledModels(catalog, a),
      defaults: Object.fromEntries(Object.keys(KIND_LABELS).map((k) => [k, chooseModel(catalog, a, k)])),
      left: hasLimits ? Math.round(lowestLeft(a)) : null,
    };
  }).sort((x, y) => (x.status === 'paused') - (y.status === 'paused'));
}

export function modelMap(catalog) {
  const out = {};
  for (const p of Object.values(catalog.providers || {})) {
    for (const m of p.models || []) out[m.id] = { label: m.label, note: m.note || '' };
  }
  return out;
}

export function sidebarChats(chats, tasks) {
  return (chats.chats || []).map((c) => ({
    id: c.id, title: c.title, archived: Boolean(c.archived), created_at: c.created_at, updated_at: c.updated_at || c.created_at,
    status: chatStatus(c, tasks),
  }));
}

export async function chatState(chatId) {
  const all = await loadAll();
  const chat = chatId ? (all.chats.chats || []).find((c) => c.id === chatId) || null : null;
  const rows = usageRows(all);
  const usable = all.agents.filter((a) => a.runner !== 'manual');
  return {
    all,
    state: {
      chat,
      tasks: chat ? all.tasks.filter((t) => t.chat === chat.id) : [],
      usage: { rows, lowest: lowestPercent(rows) },
    },
    agents: agentRows(all.catalog, usable),
    models: modelMap(all.catalog),
    recommended: Object.fromEntries(Object.keys(KIND_LABELS).map((k) => [k, bestFor(all.catalog, usable, k)])),
  };
}

export { modelInfo };
