import { NextResponse } from 'next/server';
import { isSignedIn } from '@/lib/auth';
import { wakeAgents } from '@/lib/store';
import { chatState } from '@/lib/view';

export const dynamic = 'force-dynamic';

// Safety net that does not depend on GitHub's timers (which can skip runs for hours): while a project is
// open, if some of its work has been ready for 5+ minutes and no agent is on it, start the agents. The
// workflow itself decides who (if anyone) runs, so a needless wake costs only a few seconds of CI.
let lastWake = 0;
const READY_FOR_MS = 5 * 60 * 1000;
const WAKE_EVERY_MS = 10 * 60 * 1000;

function stalled(tasks, all) {
  const done = new Set(all.filter((t) => t.status === 'done').map((t) => t.id));
  if (tasks.some((t) => ['claimed', 'reviewing'].includes(t.status))) return false;
  const ready = tasks.filter((t) => t.status === 'review' || (t.status === 'queued' && (t.after || []).every((id) => done.has(id))));
  const since = (t) => new Date(t.review_queued_at || t.queued_at || t.updated_at || 0).getTime();
  return ready.some((t) => Date.now() - since(t) > READY_FOR_MS);
}

// Polled by the open chat every few seconds while agents work (every 20 s otherwise).
export async function GET(request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const chat = new URL(request.url).searchParams.get('chat') || '';
  const { state, all } = await chatState(chat);
  if (state.chat && Date.now() - lastWake > WAKE_EVERY_MS && stalled(state.tasks, all.tasks)) {
    lastWake = Date.now();
    await wakeAgents(`safety net: work waiting in ${state.chat.id}`).catch(() => {});
  }
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
