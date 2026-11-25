import AppFrame from '@/components/AppFrame';
import { isOpenSite, requireSignIn } from '@/lib/auth';
import { loadAll } from '@/lib/data';
import { sidebarChats } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }) {
  await requireSignIn();
  const { chats, tasks } = await loadAll();
  return <AppFrame chats={sidebarChats(chats, tasks)} signOut={!isOpenSite()}>{children}</AppFrame>;
}
