import Chat from '@/components/Chat';
import { supervisorAvailable } from '@/lib/supervisor';
import { chatState, sidebarChats } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { all, state, agents, models, recommended } = await chatState('');
  const recent = sidebarChats(all.chats, all.tasks).filter((c) => !c.archived)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 5);
  return <Chat key="new" chatId={null} initial={state} agents={agents} models={models} recommended={recommended} supervisor={supervisorAvailable()?.provider || ''} recent={recent} />;
}
