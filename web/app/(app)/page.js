import Chat from '@/components/Chat';
import { supervisorAvailable } from '@/lib/supervisor';
import { chatState } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { state, agents, models, recommended } = await chatState('');
  return <Chat key="new" chatId={null} initial={state} agents={agents} models={models} recommended={recommended} supervisor={supervisorAvailable()?.provider || ''} />;
}
