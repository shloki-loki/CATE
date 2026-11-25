// Everything shown as "% left": subscription windows (5-hour, weekly), free API daily allowances,
// and weekly token budgets. Raw numbers are only kept for tooltips.

import { modelInfo, providerModels } from '@/lib/catalog';

const DAY = (iso) => (iso || '').slice(0, 10);

export function requestsToday(ledger, chats, provider, today) {
  const fromLedger = ledger?.requests?.[today]?.[provider] || 0;
  const fromChats = chats?.usage?.[today]?.[provider] || 0;
  return fromLedger + fromChats;
}

export function usageRows({ agents, ledger, chats, catalog, week, today }) {
  return agents.map((a) => {
    const row = ledger?.weeks?.[week]?.[a.id] || {};
    const tokens = (row.in || 0) + (row.out || 0);
    const windows = [];
    const l = a.limits || {};
    for (const [key, label] of [['five_hour', '5-hour'], ['seven_day', 'Week']]) {
      if (l[key]?.used_pct !== undefined) windows.push({ label, left: Math.max(0, Math.round(100 - l[key].used_pct)), resets: l[key].resets_at });
    }
    if (a.runner === 'api') {
      const provider = a.provider;
      const cap = (providerModels(catalog, provider)[0] || modelInfo(catalog, a.model) || {}).daily_requests;
      if (cap) {
        const used = requestsToday(ledger, chats, provider, today);
        windows.push({ label: 'Today', left: Math.max(0, Math.round(100 - (used / cap) * 100)), detail: `${used} of ~${cap} free requests` });
      }
    }
    const budget = a.weekly_budget_tokens || 0;
    return {
      id: a.id, label: a.label || a.id, provider: a.provider, runner: a.runner, status: a.status, note: a.note || '',
      windows, budgetLeft: budget ? Math.max(0, Math.round(100 - (tokens / budget) * 100)) : null,
      tokens, cached: row.cached || 0, jobs: row.tasks || 0, readingAt: l.at || null,
    };
  });
}

export function lowestPercent(rows) {
  const values = rows.filter((r) => r.status !== 'paused').flatMap((r) => r.windows.map((w) => w.left));
  return values.length ? Math.min(...values) : null;
}

export { DAY };
