import { NextResponse } from 'next/server';
import { isSignedIn } from '@/lib/auth';
import { chatState } from '@/lib/view';

export const dynamic = 'force-dynamic';

// Polled by the open chat every few seconds while agents work (every 20 s otherwise).
export async function GET(request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const chat = new URL(request.url).searchParams.get('chat') || '';
  const { state } = await chatState(chat);
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
