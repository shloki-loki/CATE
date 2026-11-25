import { notFound } from 'next/navigation';
import Chat from '@/components/Chat';
import { supervisorAvailable } from '@/lib/supervisor';
import { chatState } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }) {
  const { id } = await params;
  const { state, agents, models, recommended } = await chatState(id);
  if (!state.chat) notFound();
  return <Chat key={id} chatId={id} initial={state} agents={agents} models={models} recommended={recommended} supervisor={supervisorAvailable()?.provider || ''} />;
}
