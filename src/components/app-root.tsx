import { useMessageListener } from '@/useMessageListener';
import { AppSidebar } from './app-sidebar';
export function AppRoot({
  children,
  extraSidebarContent: extraContent,
}: {
  children: React.ReactNode;
  extraSidebarContent?: React.ReactNode;
}) {
  useMessageListener();
  return (
    <>
      <AppSidebar extraContent={extraContent} />
      {children}
    </>
  );
}
