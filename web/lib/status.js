// Connection status as shown on the models page and team map: a tone (ok / warn / bad) plus a word,
// so status is never shown by colour alone. Shared by server pages and client components.
export function statusOf(agent) {
  if (agent.status === 'paused' && agent.note) return { key: 'bad', word: 'Not connected' };
  if (agent.status === 'paused') return { key: 'warn', word: 'Paused' };
  return { key: 'ok', word: 'Connected' };
}
