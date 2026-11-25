import { nowIso, read, settings, weekKey } from '@/lib/store';

export const PROVIDERS = {
  anthropic: 'Claude', openai: 'ChatGPT', google: 'Gemini', xai: 'Grok', deepseek: 'DeepSeek',
  perplexity: 'Perplexity', local: 'Local (Ollama)', other: 'Other',
};
export const RUNNERS = {
  'claude-code-scheduled': 'Claude Code scheduled task',
  'codex-automation': 'Codex automation',
  'chatgpt-scheduled': 'ChatGPT scheduled task',
  api: 'API key (pay per token)',
  manual: 'Manual (you paste the prompt)',
};
export const KINDS = ['plan', 'research', 'write', 'code', 'review', 'data', 'other'];
export const COLUMNS = [
  ['queued', 'Queued'], ['claimed', 'Working'], ['review', 'Awaiting review'], ['reviewing', 'Reviewing'],
  ['done', 'Done'], ['failed', 'Failed / blocked'],
];

export async function loadAll() {
  const [agents, tasks, ledger, journal, conf] = await Promise.all([
    read('agents'), read('tasks'), read('ledger'), read('journal'), settings(),
  ]);
  const week = weekKey(new Date(nowIso(conf.timezone).slice(0, 10)));
  return {
    agents: agents.agents || [], tasks: tasks.tasks || [], ledger: ledger || { weeks: {} },
    journal: journal.entries || [], conf, week,
  };
}

export function usage(ledger, week, agentId) {
  const row = ledger.weeks?.[week]?.[agentId] || {};
  return { used: (row.in || 0) + (row.out || 0), tasks: row.tasks || 0, days: row.days || {} };
}

export function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

export function agentState(agent, ledger, week) {
  const { used } = usage(ledger, week, agent.id);
  if (agent.status === 'paused') return { tone: 'warn', label: 'Paused' };
  if (agent.status === 'limited' && minutesSince(agent.limited_until) < 0) return { tone: 'warn', label: `Resting (usage limit) until ${when(agent.limited_until)}` };
  if (agent.weekly_budget_tokens && used >= agent.weekly_budget_tokens) return { tone: 'bad', label: 'Weekly budget used up' };
  if (!agent.last_seen) return { tone: '', label: 'Never checked in. Set up its scheduled task' };
  if (minutesSince(agent.last_seen) > 180) return { tone: 'bad', label: `Silent since ${when(agent.last_seen)}` };
  return { tone: 'ok', label: `Ready · last check-in ${when(agent.last_seen)}` };
}

export function when(iso) {
  if (!iso) return '–';
  const minutes = Math.round(minutesSince(iso));
  if (minutes < 0) {
    const ahead = -minutes;
    return ahead < 60 ? `in ${ahead} min` : `in ${Math.round(ahead / 60)} h`;
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
